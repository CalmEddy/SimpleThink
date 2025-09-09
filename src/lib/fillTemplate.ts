import { TemplateToken, UnifiedTemplate, SelectionSource, POS, MorphFeature } from '../types/index.js';

// Reuse your existing morphology util
import { tenseConverter, type MorphologicalType } from './tenseConverter.js';

type ContextWord = {
  id: string;
  text: string;
  lemma?: string;
  pos?: POS[] | string[];
};

type Context = {
  words: ContextWord[];
  // keep whatever else you already have; not used here
};

export interface FillInput {
  tpl: UnifiedTemplate;
  ctx: Context;
  lockedSet: Set<string>;
  wordBank: Record<string, string[]>;
}

export interface FillResult {
  surface: string;
  chosen: string[];
}

const POLICY_STANDARD: SelectionSource[] = ['LOCKED', 'CONTEXT', 'BANK'];
const POLICY_PHRASE: SelectionSource[]   = ['LOCKED', 'CONTEXT', 'LITERAL', 'BANK'];

export async function realizeTemplate(input: FillInput): Promise<FillResult> {
  const { tpl } = input;
  const binds = new Map<string, { surface: string; lemma?: string; pos: POS }>();
  const out: string[] = [];

  function posCompatible(requested: POS | undefined, got: POS | undefined): boolean {
    if (!requested || !got) return true;
    if (requested === "PROPN") return got === "PROPN";        // PROPN only swaps with PROPN
    if (requested === "NOUN")  return got !== "PROPN";        // NOUN must not receive PROPN
    return requested === got;                                 // others must match exactly
  }

  async function repickStrict(input: FillInput, token: any): Promise<{ surface:string; lemma?:string; pos:POS }> {
    // Try re-picking up to a few times via the existing policy
    for (let i = 0; i < 5; i++) {
      const attempt = await pickByPolicy(input, token.pos, token.selectionPolicy ?? POLICY_STANDARD, token.fallbackLiteral);
      if (posCompatible(token.pos, attempt.pos)) return attempt;
    }
    // As a last resort, filter context by POS and pick a random compatible word
    const pool = (input.ctx?.words ?? []).filter((w:any) => posCompatible(token.pos, w.pos));
    if (pool.length) {
      const w = pool[Math.floor(Math.random() * pool.length)];
      return { surface: w.surface ?? w.text ?? w.lemma ?? "", lemma: w.lemma, pos: w.pos };
    }
    // If absolutely nothing compatible exists, fall back to original attempt (let caller render literal)
    return { surface: token.fallbackLiteral ?? "", lemma: undefined, pos: token.pos };
  }

  console.log('🔍 UTA DEBUG: Starting realizeTemplate');
  console.log('🔍 UTA DEBUG: Template tokens:', tpl.tokens);
  console.log('🔍 UTA DEBUG: Context words count:', input.ctx.words.length);
  console.log('🔍 UTA DEBUG: Locked set size:', input.lockedSet.size);

  for (const token of tpl.tokens) {
    if (token.kind === 'literal') {
      console.log('🔍 UTA DEBUG: Processing literal token:', token.surface);
      out.push(token.surface);
      continue;
    }

    if (token.kind === 'subtemplate') {
      console.log('🔍 UTA DEBUG: Processing subtemplate token');
      // Inline recursive realization
      const subTpl: UnifiedTemplate = {
        id: `${tpl.id}::sub`,
        text: '', tokens: token.tokens, createdInSessionId: tpl.createdInSessionId,
      };
      const sub = await realizeTemplate({ ...input, tpl: subTpl });
      out.push(sub.surface);
      continue;
    }

    // Slot
    const policy = token.selectionPolicy ?? POLICY_STANDARD;
    console.log('🔍 UTA DEBUG: Processing slot token:', {
      pos: token.pos,
      policy: policy,
      fallbackLiteral: token.fallbackLiteral,
      bindId: token.bindId
    });

    // Binding reuse
    if (token.bindId && binds.has(token.bindId)) {
      console.log('🔍 UTA DEBUG: Reusing bound word for', token.bindId);
      const prev = binds.get(token.bindId)!;
      const rendered = await morphRender(prev.surface, prev.lemma, prev.pos, token.morph);
      out.push(rendered);
      continue;
    }

    // Choose by policy
    let choice = await pickByPolicy(input, token.pos, policy, token.fallbackLiteral);
    if (!posCompatible(token.pos, choice.pos)) {
      choice = await repickStrict(input, token);
    }
    console.log('🔍 UTA DEBUG: Selected choice:', choice);
    const rendered = await morphRender(choice.surface, choice.lemma, token.pos, token.morph);
    console.log('🔍 UTA DEBUG: Rendered word:', rendered);

    if (token.bindId) {
      binds.set(token.bindId, { surface: rendered, lemma: choice.lemma, pos: token.pos });
    }
    out.push(rendered);
  }

  console.log('🔍 UTA DEBUG: Final result:', { surface: tidySpacing(out.join(' ')), chosen: out });
  return { surface: tidySpacing(out.join(' ')), chosen: out };
}

async function pickByPolicy(
  input: FillInput,
  pos: POS,
  policy: SelectionSource[],
  fallbackLiteral?: string
): Promise<{ surface: string; lemma?: string; pos: POS }> {
  console.log('🔍 UTA DEBUG: pickByPolicy called with:', { pos, policy, fallbackLiteral });
  
  for (const src of policy) {
    console.log('🔍 UTA DEBUG: Trying source:', src);
    const picked = selectFromSource(src, input, pos, fallbackLiteral);
    console.log('🔍 UTA DEBUG: Source result:', { src, picked });
    if (picked) {
      console.log('🔍 UTA DEBUG: SUCCESS with source:', src);
      return picked;
    }
  }
  
  console.log('🔍 UTA DEBUG: All sources failed, returning empty');
  return { surface: '', pos: pos };
}

function selectFromSource(
  src: SelectionSource,
  input: FillInput,
  pos: POS,
  fallbackLiteral?: string
): { surface: string; lemma?: string; pos: POS } | null {
  const { ctx, lockedSet, wordBank } = input;

  if (src === 'LOCKED') {
    console.log('🔍 UTA DEBUG: LOCKED source - checking locked words');
    const pool = ctx.words.filter(w => includesPOS(w.pos, pos) && lockedSet.has(w.id));
    console.log('🔍 UTA DEBUG: LOCKED pool size:', pool.length);
    const w = pickWord(pool);
    if (w) {
      console.log('🔍 UTA DEBUG: LOCKED found word:', w.text);
      return { surface: w.text, lemma: w.lemma, pos: pos };
    }
    console.log('🔍 UTA DEBUG: LOCKED no matches');
    return null;
  }

  if (src === 'CONTEXT') {
    console.log('🔍 UTA DEBUG: CONTEXT source - checking context words');
    console.log('🔍 UTA DEBUG: Total context words:', ctx.words.length);
    
    // Debug: Show first few words and their POS
    console.log('🔍 UTA DEBUG: First 5 context words:', ctx.words.slice(0, 5).map(w => ({
      text: w.text,
      pos: w.pos,
      posType: typeof w.pos,
      posIsArray: Array.isArray(w.pos)
    })));
    
    const pool = ctx.words.filter(w => {
      const matches = includesPOS(w.pos, pos);
      console.log('🔍 UTA DEBUG: Word check:', {
        text: w.text,
        pos: w.pos,
        wanted: pos,
        matches: matches
      });
      return matches;
    });
    console.log('🔍 UTA DEBUG: CONTEXT pool size after filtering:', pool.length);
    console.log('🔍 UTA DEBUG: CONTEXT pool words:', pool.map(w => w.text));
    
    const w = pickWord(pool);
    if (w) {
      console.log('🔍 UTA DEBUG: CONTEXT found word:', w.text);
      return { surface: w.text, lemma: w.lemma, pos: pos };
    }
    console.log('🔍 UTA DEBUG: CONTEXT no matches');
    return null;
  }

  if (src === 'LITERAL') {
    console.log('🔍 UTA DEBUG: LITERAL source - fallbackLiteral:', fallbackLiteral);
    if (fallbackLiteral) {
      console.log('🔍 UTA DEBUG: LITERAL using fallback:', fallbackLiteral);
      return { surface: fallbackLiteral, pos: pos };
    }
    console.log('🔍 UTA DEBUG: LITERAL no fallback available');
    return null;
  }

  // BANK (try exact key, then base POS)
  console.log('🔍 UTA DEBUG: BANK source - looking for POS:', pos);
  const exact = (wordBank as any)[pos] as string[] | undefined;
  const base = (wordBank as any)[basePOS(pos)] as string[] | undefined;
  console.log('🔍 UTA DEBUG: BANK exact match:', { pos, exact: exact?.length || 0 });
  console.log('🔍 UTA DEBUG: BANK base match:', { basePos: basePOS(pos), base: base?.length || 0 });
  
  const fb = exact && exact.length ? exact : base;
  if (fb && fb.length) {
    const selected = pickString(fb);
    console.log('🔍 UTA DEBUG: BANK selected word:', selected);
    return { surface: selected, pos: pos };
  }
  console.log('🔍 UTA DEBUG: BANK no words available');
  return null;
}

function basePOS(tag: string): string {
  // Normalize case, strip any morphology suffix after the first colon
  return String(tag).toUpperCase().split(':', 1)[0];
}

function toArray<T>(v: T[] | T | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Returns true if the word's POS list is compatible with the slot POS.
 * Compatible means base categories match (e.g., VERB == VERB:past and vice versa).
 */
function includesPOS(posList: POS[] | string[] | undefined, wanted: POS): boolean {
  console.log('🔍 UTA DEBUG: includesPOS called with:', { posList, wanted });
  
  const arr = toArray(posList);
  console.log('🔍 UTA DEBUG: toArray result:', arr);
  
  if (!arr.length) {
    console.log('🔍 UTA DEBUG: includesPOS returning false - empty array');
    return false;
  }

  const wantedBase = basePOS(wanted);
  console.log('🔍 UTA DEBUG: wanted base POS:', wantedBase);
  
  for (const p of arr) {
    const pStr = String(p).toUpperCase();
    const pBase = basePOS(pStr);
    console.log('🔍 UTA DEBUG: checking POS:', { p, pStr, pBase, wanted, wantedBase });
    
    if (pStr === wanted.toUpperCase()) {
      console.log('🔍 UTA DEBUG: includesPOS returning true - exact match');
      return true;             // exact match
    }
    if (pBase === wantedBase) {
      console.log('🔍 UTA DEBUG: includesPOS returning true - base match');
      return true;              // base-category match
    }
  }
  
  console.log('🔍 UTA DEBUG: includesPOS returning false - no matches');
  return false;
}

async function morphRender(surface: string, lemma: string | undefined, pos: POS, morph?: MorphFeature): Promise<string> {
  if (!morph) return surface;
  // Reuse your existing morphology function; signature may be different in your project.
  // If your applyMorphIfNeeded expects (surface, lemma, pos, morph) keep it:
  return applyMorphIfNeeded(surface, lemma, pos, morph);
}

// Reuse the existing morphology function from promptEngine
async function applyMorphIfNeeded(
  surface: string,
  lemma: string | undefined,
  basePos: string,
  morph: MorphFeature | null
): Promise<string> {
  if (!morph || morph === 'base') return surface;
  // Prefer lemma when available; fall back to surface for regular forms.
  const seed = lemma && lemma.length ? lemma : surface;
  try {
    const converted = await tenseConverter.convertWord(seed, basePos, morph as MorphologicalType);
    // Keep capitalization if the original token was capitalized (sentence start, etc.)
    if (!converted || converted === seed) return surface;

    const isCapitalized = /^[A-Z]/.test(surface);
    return isCapitalized ? converted.charAt(0).toUpperCase() + converted.slice(1) : converted;
  } catch {
    return surface;
  }
}

function pickWord<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickString(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

function tidySpacing(s: string): string {
  return s.replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
}
