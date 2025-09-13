/**
 * Robust bridge that realizes TemplateDocs through the UTA pipeline
 * 
 * This bridge properly processes user TemplateDocs by running them through
 * the same Composer pipeline (parseTextPatternsToUTA → convertTemplateDocToUnified → realizeTemplate)
 * to ensure they render with proper text content instead of empty strings.
 */

import type { SemanticGraphLite } from "./semanticGraphLite.js";
import type { TemplateDoc, PhraseBlock, PhraseToken, POS } from "../types/index.js";
import { parseTextPatternsToUTA } from "../components/ComposerEditor.js";
import { convertTemplateDocToUnified } from "./composer.js";
import { realizeTemplate } from "./fillTemplate.js";
import { TemplateStore } from "./templateStore";
import type { ContextualNodeSets } from '../contexts/ActiveNodesContext.js';


export interface EphemeralPrompt {
  templateId: string;
  templateSignature: string;
  templateText: string;
  text: string;
  bindings: Array<{ slot: { pos: POS }, nodeId?: string }>;
}

// --- helpers ---------------------------------------------------------------
function buildDocFromPhraseNode(ph: any): TemplateDoc {
  const pos = String(ph.posPattern || "").split("-").filter(Boolean);
  const words = String(ph.text || "").trim().split(/\s+/);
  const L = Math.max(pos.length, words.length);
  const tokens: PhraseToken[] = Array.from({ length: L }).map((_, i) => {
    const p = (pos[i] ?? pos[pos.length - 1] ?? "NOUN") as POS;
    const w = words[i] ?? "";
    return {
      text: w || `[${p}]`,
      lemma: "",
      pos: p,
      posSet: [p],
      randomize: false,
      slotLabel: null,
      morph: null,
    } as PhraseToken;
  });
  return {
    id: ph.id,
    createdInSessionId: "prompter",
    blocks: [{ kind: "phrase", phraseText: String(ph.text || ""), tokens } as PhraseBlock],
  } as TemplateDoc;
}

function buildDocFromChunkNode(ch: any): TemplateDoc {
  const pos = String(ch.posPattern || "").split("-").filter(Boolean);
  const words = String(ch.text || "").trim().split(/\s+/);
  const L = Math.max(pos.length, words.length);
  const tokens: PhraseToken[] = Array.from({ length: L }).map((_, i) => {
    const p = (pos[i] ?? pos[pos.length - 1] ?? "NOUN") as POS;
    const w = words[i] ?? "";
    return {
      text: w || `[${p}]`,
      lemma: "",
      pos: p,
      posSet: [p],
      randomize: false,
      slotLabel: null,
      morph: null,
    } as PhraseToken;
  });
  return {
    id: ch.id,
    createdInSessionId: "prompter",
    blocks: [{ kind: "phrase", phraseText: String(ch.text || ""), tokens } as PhraseBlock],
  } as TemplateDoc;
}

async function realizeDoc(
  doc: TemplateDoc,
  ctxFromCaller: { words: any[]; phrases: any[] } | undefined,
  graph?: SemanticGraphLite
): Promise<{ text: string; signature: string; templateText: string }> {
  // If the doc contains only text blocks, hydrate it into phrase tokens first.
  const parsed = await parseTextPatternsToUTA(doc, graph);
  const unified = convertTemplateDocToUnified(parsed);
  // Prefer the caller's active context; only fall back to graph if provided.
  const ctx = ctxFromCaller ?? {
    words: graph ? (graph.getNodesByType("WORD") as any[]) : [],
    phrases: graph ? (graph.getNodesByType("PHRASE") as any[]) : [],
  };
  const res = await realizeTemplate({
    tpl: unified,
    ctx,
    lockedSet: new Set(),
    wordBank: {},
  });
  return {
    text: (res.surface || "").replace(/\s+/g, " ").trim(),
    signature: "ENHANCED-GENERATED",
    templateText: parsed.blocks.map(b => (b as any).phraseText ?? (b as any).text ?? "").join(" ").trim(),
  };
}

// --- main API --------------------------------------------------------------
export async function generateEphemeralPrompts(
  graph: SemanticGraphLite | undefined,
  ctx: ContextualNodeSets,
  sessionId: string,
  count = 10,
  _seed?: number,
  templateMixRatio = 0.5
): Promise<EphemeralPrompt[]> {
  const out: EphemeralPrompt[] = [];
  // Do NOT require graph; we can work entirely from the provided active context & user templates.

  console.log("[PrompterBridge] generateEphemeralPrompts:start", {
    sessionId,
    ctxWords: ctx?.words?.length ?? 0,
    ctxPhrases: ctx?.phrases?.length ?? 0,
    requestedCount: count,
  });

  // 1) User TemplateDocs for this session + global pool
  const userRecords = await TemplateStore.list(sessionId, { includeGlobal: true });
  const userDocs = userRecords.map(r => r.doc);
  
  console.log("[PrompterBridge] userDocs loaded", { count: userDocs?.length ?? 0 });
  if (!userDocs || userDocs.length === 0) {
    console.warn("[PrompterBridge] No user templates available.");
  }

  // 2) Context-derived docs (phrases & chunks)
  const phraseDocs = (ctx.phrases || []).map(buildDocFromPhraseNode);
  const chunkDocs  = (ctx.chunks  || []).map(buildDocFromChunkNode);
  const generatedDocs = [...phraseDocs, ...chunkDocs];

  // 3) Mix selection
  const userTarget = Math.round(count * templateMixRatio);
  const genTarget  = Math.max(0, count - userTarget);

  const pickN = <T,>(arr: T[], n: number) => (arr.length <= n ? arr.slice(0, arr.length) : arr.slice(0, n));
  const userSel = pickN(userDocs, userTarget);
  const genSel  = pickN(generatedDocs, genTarget);
  
  // Combine all available templates
  const allTemplates = [...userSel, ...genSel].filter(Boolean);

  // Ensure we always generate the requested count by reusing templates if necessary
  let selected: TemplateDoc[] = [];
  if (allTemplates.length === 0) {
    selected = [];
  } else if (allTemplates.length >= count) {
    selected = allTemplates.slice(0, count);
  } else {
    // Round-robin reuse to reach the requested count
    for (let i = 0; i < count; i++) {
      selected.push(allTemplates[i % allTemplates.length]);
    }
  }

  // 4) Realize all selected docs through the Composer pipeline
  for (const doc of selected) {
    // Skip empty/invalid docs (phrase or text blocks are acceptable)
    const hasBlocks = Array.isArray((doc as any).blocks) && (doc as any).blocks.length > 0;
    let renderable = false;
    if (hasBlocks) {
      for (const b of (doc as any).blocks) {
        if (b?.kind === "phrase" && Array.isArray(b.tokens) && b.tokens.length > 0) {
          renderable = true; break;
        }
        if (b?.kind === "text" && typeof b.text === "string" && b.text.trim().length > 0) {
          renderable = true; break;
        }
      }
    }
    if (!renderable) continue;

    const realized = await realizeDoc(
      doc,
      { words: ctx.words || [], phrases: ctx.phrases || [] },
      graph
    );
    if (!realized.text) continue; // guard

    out.push({
      templateId: doc.id,
      templateSignature: realized.signature,
      templateText: realized.templateText || "",
      text: realized.text,
      bindings: [],
    });
  }
  
  console.log("[PrompterBridge] generateEphemeralPrompts:done", { produced: out.length });
  return out;
}
