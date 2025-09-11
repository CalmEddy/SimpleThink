import { parseTextPatternsToUTA } from "../../components/ComposerEditor";
import { convertTemplateDocToUnified } from "../composer";
import { realizeTemplate } from "../fillTemplate";
import { wordBank } from "../templates.js";
import type { UnifiedTemplate, POS, MorphFeature } from '../types/index.js';
import type { TemplateDoc, TemplateBlock, PhraseBlock, PhraseToken } from '../types/index.js';
import type { SemanticGraphLite, WordNode, PhraseNode } from '../semanticGraphLite.js';

/**
 * Prompter — a thin orchestrator that:
 * 1) Selects a TemplateDoc (random or weighted)
 * 2) Applies "on-the-fly" template mutations (optional)
 * 3) Runs the *existing* UTA pipeline (parse -> convert -> realize)
 * 4) Returns the final surface string + debug info
 *
 * Important: No duplicate processing center. We only call the same functions the Composer uses.
 */

// ---------------------------
// Types
// ---------------------------

export type TemplateSource =
  | TemplateDoc[]
  | (() => Promise<TemplateDoc[]>)
  | (() => TemplateDoc[]);

export interface PrompterContext {
  graph?: SemanticGraphLite;
  /** Optional override/additions for the word bank used by realizeTemplate */
  bank?: Record<string, string[]>;
  /** Optional context override for words and phrases */
  ctxOverride?: {
    words?: any[];
    phrases?: any[];
  };
}

export interface RNG {
  next(): number; // [0,1)
}

export interface PrompterConfig {
  source: TemplateSource;
  /**
   * Optional deterministic RNG (e.g., seedrandom wrapper).
   * If not provided, Math.random() is used.
   */
  rng?: RNG;
  /**
   * Mutators run in order on the *TemplateDoc* before conversion to UnifiedTemplate.
   * Keep them pure and minimal—no side effects beyond the returned doc.
   */
  mutators?: TemplateMutator[];
  /**
   * Optional filter to exclude templates (return false to skip).
   */
  filter?: (tpl: TemplateDoc) => boolean;
  /**
   * Optional weighting function for random selection. Must return >= 0.
   * Default is uniform.
   */
  weight?: (tpl: TemplateDoc) => number;
}

export type TemplateMutator = (doc: TemplateDoc, utils: MutatorUtils) => TemplateDoc;

export interface MutatorUtils {
  rng: RNG;
  /** Randomly toggles some randomizable tokens to slots (or back) */
  jitterSlots: (doc: TemplateDoc, p: number) => TemplateDoc;
  /** Assigns bind labels 1..k across a phrase to encourage slot reuse */
  autoBind: (doc: TemplateDoc, maxGroups?: number) => TemplateDoc;
  /** Ensures at least N randomized tokens exist */
  ensureRandomizedMin: (doc: TemplateDoc, min: number) => TemplateDoc;
}

export interface PromptResult {
  prompt: string;
  templateId: string;
  templateText: string;
  debug: {
    chosenIndex: number;
    mutatorsApplied: string[];
    tokenCount: number;
  };
}

// ---------------------------
// Default RNG
// ---------------------------
class DefaultRNG implements RNG {
  next() { return Math.random(); }
}

// ---------------------------
// Utility — random selection with optional weights
// ---------------------------
function pickIndex(rng: RNG, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return Math.floor(rng.next() * weights.length);
  const target = rng.next() * total;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (target <= acc) return i;
  }
  return weights.length - 1;
}

// ---------------------------
// Built-in simple mutator utils
// ---------------------------
const utilsFactory = (rng: RNG): MutatorUtils => ({
  rng,
  jitterSlots(doc, p) {
    // One-way enable: with probability p, turn randomization ON for eligible tokens.
    // Never turn randomized tokens OFF, to avoid leaking "[POS]" into final output.
    const blocks: TemplateBlock[] = doc.blocks.map(b => {
      if (b.kind !== "phrase") return b;
      const pb = b as PhraseBlock;
      const tokens = pb.tokens.map(t => {
        // Eligible if it already has a POS (slot-capable) and looks like a word.
        const hasPOS = !!(t as any).pos || !!((t as any).posSet && (t as any).posSet.length);
        const looksLikeWord = typeof t.text === "string" && /[A-Za-z]/.test(t.text);
        if (!hasPOS || !looksLikeWord) return t;
        if (t.randomize) return t; // do NOT disable existing slots
        // Randomly enable randomization
        return (rng.next() < p) ? { ...t, randomize: true } : t;
      });
      return { ...pb, tokens };
    });
    return { ...doc, blocks };
  },
  autoBind(doc, maxGroups = 2) {
    // Assign simple numeric bind groups across randomized tokens inside each phrase
    const blocks: TemplateBlock[] = doc.blocks.map(b => {
      if (b.kind !== "phrase") return b;
      const pb = b as PhraseBlock;
      let current = 1;
      const tokens = pb.tokens.map(t => {
        if (!t.randomize) return t;
        // 50% chance to assign a bind label, up to maxGroups
        if (rng.next() < 0.5) {
          const label = String(1 + Math.floor(rng.next() * Math.max(1, maxGroups)));
          return { ...t, slotLabel: label };
        }
        return t;
      });
      return { ...pb, tokens };
    });
    return { ...doc, blocks };
  },
  ensureRandomizedMin(doc, min) {
    const blocks: TemplateBlock[] = doc.blocks.map(b => {
      if (b.kind !== "phrase") return b;
      const pb = b as PhraseBlock;
      const idxs = pb.tokens.map((t, i) => ({ i, can: /[A-Za-z]/.test(t.text) })).filter(x => x.can);
      const already = pb.tokens.filter(t => t.randomize).length;
      if (already >= min) return pb;
      const need = Math.min(min - already, idxs.length);
      const chosen = new Set<number>();
      while (chosen.size < need && chosen.size < idxs.length) {
        const pick = idxs[Math.floor(rng.next() * idxs.length)].i;
        chosen.add(pick);
      }
      const tokens = pb.tokens.map((t, i) => chosen.has(i) ? { ...t, randomize: true } : t);
      return { ...pb, tokens };
    });
    return { ...doc, blocks };
  }
});

// ---------------------------
// Prompter
// ---------------------------
export class Prompter {
  private cfg: PrompterConfig;
  private rng: RNG;

  constructor(cfg: PrompterConfig) {
    this.cfg = cfg;
    this.rng = cfg.rng ?? new DefaultRNG();
  }

  /**
   * Update the Prompter configuration without recreating the instance
   */
  updateConfig(newCfg: Partial<PrompterConfig>): void {
    this.cfg = { ...this.cfg, ...newCfg };
    if (newCfg.rng) {
      this.rng = newCfg.rng;
    }
  }

  /**
   * Get current configuration (for debugging/inspection)
   */
  getConfig(): PrompterConfig {
    return { ...this.cfg };
  }

  // NOTE: Binds are *per prompt*, not persisted across runs. The Composer's
  // realizeTemplate already creates a fresh binds map on each call. We rely on that.

  /** Strict check: if any randomized token lacks POS, fail fast. */
  private assertNoRandomWithoutPOS(doc: TemplateDoc): void {
    for (const b of doc.blocks) {
      if (b.kind !== "phrase") continue;
      const pb = b as PhraseBlock;
      for (const t of pb.tokens as PhraseToken[]) {
        if (t.randomize && !(t.pos || (t.posSet && t.posSet.length))) {
          throw new Error(
            "Prompter invariant failed: randomized token lacks POS. " +
            "Templates must be derived from phrase/chunk nodes (with POS)."
          );
        }
      }
    }
  }

  private async loadTemplates(): Promise<TemplateDoc[]> {
    const { source, filter } = this.cfg;
    const raw = typeof source === "function" ? await source() : source;
    return filter ? raw.filter(filter) : raw;
  }

  private pickTemplate(templates: TemplateDoc[]): { index: number; tpl: TemplateDoc } {
    const { weight } = this.cfg;
    const weights = weight ? templates.map(weight) : templates.map(() => 1);
    const index = pickIndex(this.rng, weights);
    return { index, tpl: templates[index] };
    }

  /**
   * Generate one prompt using current config and context.
   * Mutators are applied *before* parse/convert/realize, so they work "on the fly".
   */
  async generate(ctx: PrompterContext = {}): Promise<PromptResult> {
    const list = await this.loadTemplates();
    if (!list.length) throw new Error("Prompter: no templates available.");

    const { index, tpl } = this.pickTemplate(list);
    const mutUtils = utilsFactory(this.rng);
    const mutators = this.cfg.mutators ?? [];
    let working: TemplateDoc = tpl;
    const applied: string[] = [];

    for (const m of mutators) {
      const before = working;
      working = m(working, mutUtils);
      applied.push(m.name || "anonymousMutator");
      // Optional sanity: keep id and createdInSessionId stable
      working = { ...working, id: before.id, createdInSessionId: before.createdInSessionId };
    }

    // Fail fast if any randomized token lacks POS
    this.assertNoRandomWithoutPOS(working);

    // Use original parseTextPatternsToUTA pipeline for TemplateDoc
    const parsed = await parseTextPatternsToUTA(working, ctx.graph);
    const unified: UnifiedTemplate = convertTemplateDocToUnified(parsed);

    // Build context identical to Composer's generation step:
    // Use ctxOverride if provided, otherwise fall back to graph-based context
    const contextWords = ctx.ctxOverride?.words ?? (ctx.graph ? (ctx.graph.getNodesByType('WORD') as WordNode[]) : []);
    const contextPhrases = ctx.ctxOverride?.phrases ?? (ctx.graph ? (ctx.graph.getNodesByType('PHRASE') as PhraseNode[]) : []);

    const sub = await realizeTemplate({
      tpl: unified,
      ctx: { words: contextWords, phrases: contextPhrases },
      lockedSet: new Set(),
      wordBank: { ...wordBank, ...(ctx.bank ?? {}) }
    } as any); // typed to your FillInput

    return {
      prompt: sub.surface,
      templateId: unified.id,
      templateText: unified.text ?? "",
      debug: {
        chosenIndex: index,
        mutatorsApplied: applied,
        tokenCount: unified.tokens?.length ?? 0
      }
    };
  }
}

// ---------------------------
// Handy ready-made mutators
// ---------------------------

/** Light randomization: flip ~30% of tokens to/from randomized slots */
export function mutatorJitter30(doc: TemplateDoc, u: MutatorUtils): TemplateDoc {
  return u.jitterSlots(doc, 0.3);
}

/** Encourage slot reuse by sprinkling bind labels (1..2) */
export function mutatorAutoBind(doc: TemplateDoc, u: MutatorUtils): TemplateDoc {
  return u.autoBind(doc, 2);
}

/** Guarantee at least 2 randomized tokens exist */
export function mutatorEnsure2Random(doc: TemplateDoc, u: MutatorUtils): TemplateDoc {
  return u.ensureRandomizedMin(doc, 2);
}

// Re-export helper for convenience
export { templateDocsFromGraph } from "./unifiedSource";

// Example advanced mutator: make every NOUN token randomized (non-destructive)
export function mutatorRandomizeNouns(doc: TemplateDoc): TemplateDoc {
  const blocks = doc.blocks.map(b => {
    if (b.kind !== "phrase") return b;
    const pb = b as PhraseBlock;
    const tokens = pb.tokens.map(t => {
      const isNoun = (t.pos === 'NOUN') || (t.posSet?.includes('NOUN'));
      return isNoun ? { ...t, randomize: true } : t;
    });
    return { ...pb, tokens };
  });
  return { ...doc, blocks };
}
