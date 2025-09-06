// src/lib/posnormalization.ts
// Single source of truth for POS normalization, fallback upgrading, demotion, and compound spans.

import { isStopWord } from './stopWords.js';

export type PosSource = 'model' | 'fallback' | 'demoted';

type UPOS = 'NOUN'|'VERB'|'ADJ'|'ADV'|'PROPN'|'ADP'|'AUX'|'DET'|'PRON'|'PART'|'CCONJ'|'SCONJ'|'NUM'|'INTJ'|'SYM'|'X'|'PUNCT';


export interface BaseTok {
  value: string;        // surface
  lemma: string;        // lemmatized (may be lowercased in your pipeline)
  pos: string;          // tagger POS before normalization
  index: number;        // stable token index
  sentenceId?: number;  // if available from your NLP
}

export interface NormalizedToken extends BaseTok {
  pos: string;               // normalized POS after fallback/demotion
  posSource: PosSource;      // where the POS came from
  keep: boolean;             // whether ingest should create a word node for this token
}

export interface CompoundSpan {
  start: number;             // token index (array position) inclusive
  end: number;               // token index inclusive
  text: string;              // joined surface text
  lemma: string;             // lowercased compound lemma ("mother nature")
  pos: 'PROPN';
}

export interface NormalizationResult {
  tokens: NormalizedToken[];
  compounds: CompoundSpan[];
}

// ---------- helpers (local; do not spread elsewhere) ----------
const isAllCapsAcronym = (v: string): boolean => /^[A-Z]{2,}$/.test(v);

// Capitalized word: Unicode-aware; allows O'Neil, Mc-Donald, Jean-Luc, etc.
const isCapitalizedWord = (v: string): boolean =>
  /^[\p{Lu}][\p{L}]+(?:[''\-][\p{L}]+)*$/u.test(v);

const isPossessivePart = (v: string): boolean => v === "'s" || v === "'s";

// cheap punctuation check; keep local to avoid cross-deps
const isPunctish = (v: string): boolean => /^[\p{P}\p{S}]+$/u.test(v);

// consider a sentence title-cased if >50% alpha tokens look capitalized
const isTitleCaseSentence = (toks: BaseTok[]): boolean => {
  let alpha = 0, caps = 0;
  for (const t of toks) {
    if (/[A-Za-z\u00C0-\u024F]/.test(t.value)) {
      alpha++;
      if (isCapitalizedWord(t.value)) caps++;
    }
  }
  return alpha > 0 && caps / alpha > 0.5;
};

// group by sentence id (or single sentence if absent)
function groupBySentence(tokens: BaseTok[]): BaseTok[][] {
  const byId = new Map<number, BaseTok[]>();
  let hasIds = false;
  for (const t of tokens) {
    const sid = t.sentenceId ?? 0;
    hasIds = hasIds || t.sentenceId != null;
    if (!byId.has(sid)) byId.set(sid, []);
    byId.get(sid)!.push(t);
  }
  if (!hasIds) return [tokens];
  return [...byId.values()];
}

// Build a mask of which indices (local to a sentence) belong to a "proper run":
// ≥2 consecutive CapitalizedWord tokens. A trailing possessive PART ('s) is allowed
// immediately after the run but is *not* part of the run.
function computeProperRunMask(sent: BaseTok[]): boolean[] {
  const n = sent.length;
  const mask = new Array<boolean>(n).fill(false);
  const cap = sent.map(t => !isPunctish(t.value) && isCapitalizedWord(t.value));
  let i = 0;
  while (i < n) {
    if (!cap[i]) { i++; continue; }
    let j = i;
    while (j < n && cap[j]) j++;
    const runLen = j - i;
    // allow a trailing possessive PART after the last capitalized token
    const after = j < n ? sent[j] : null;
    if (runLen >= 2) {
      for (let k = i; k < j; k++) mask[k] = true;
    }
    // Skip past the PART if present, but we never mark PART as part of the run
    i = (after && after.pos === 'PART' && isPossessivePart(after.value)) ? j + 1 : j;
  }
  return mask;
}

// ---------- main normalization ----------
export function normalizePOS(input: BaseTok[]): NormalizationResult {
  // Validate input
  if (!input || !Array.isArray(input)) {
    console.warn('normalizePOS: Invalid input, returning empty result');
    return { tokens: [], compounds: [] };
  }
  
  // 1) initialize from model - ensure all required fields exist
  const posSource: PosSource[] = input.map(() => 'model');
  // Track whether a token (global index in `input`) belongs to a proper multi-token capitalized run
  const inProperRun: boolean[] = new Array(input.length).fill(false);
  
  // Validate that all tokens have required fields
  for (let i = 0; i < input.length; i++) {
    const token = input[i];
    if (!token.value || typeof token.value !== 'string') {
      // Fix invalid tokens silently
      input[i] = { ...token, value: '', lemma: '', pos: 'X', index: i };
    }
    if (!token.lemma || typeof token.lemma !== 'string') {
      input[i] = { ...token, lemma: token.value || '' };
    }
  }

  // === NEW: Build arrays we can inspect
  const rawPOS = input.map(t => (t.pos || 'X') as UPOS);

  // === NEW: Find probable sentence starts (best-effort if sentenceId not available)
  const sentenceStartIdxs = new Set<number>();
  for (let i = 0; i < input.length; i++) {
    if (i === 0 || input[i-1].value === '.' || input[i-1].value === '!' || input[i-1].value === '?') {
      sentenceStartIdxs.add(i);
    }
  }

  // === Simplified normalization: trust winkNLP completely - no overrides, no heuristics
  const normalizedPOS: UPOS[] = rawPOS.map((obs) => {
    // Trust winkNLP completely - no overrides, no heuristics
    return (obs || 'NOUN') as UPOS;
  });

  // 2) NER-lite upgrading: runs of ≥2 Capitalized words inside each sentence.
  const sentences = groupBySentence(input);

  for (const sent of sentences) {
    const titleCase = isTitleCaseSentence(sent);
    const runMaskLocal = computeProperRunMask(sent);
    // Record run membership globally (used for demotion protection)
    for (let i = 0; i < sent.length; i++) {
      const globalIdx = input.indexOf(sent[i]);
      if (globalIdx !== -1 && runMaskLocal[i]) inProperRun[globalIdx] = true;
    }

    // Skip *upgrading* in title-case sentences (headings), but still compute run mask above
    if (!titleCase) {
      // Upgrade ONLY tokens inside multi-token capitalized runs
      for (let i = 0; i < sent.length; i++) {
        if (!runMaskLocal[i]) continue;
        const globalIdx = input.indexOf(sent[i]);
        if (globalIdx === -1) continue;
        if (normalizedPOS[globalIdx] === 'NOUN' || normalizedPOS[globalIdx] === 'X') {
          normalizedPOS[globalIdx] = 'PROPN';
          posSource[globalIdx] = 'fallback';
        }
      }
      // Upgrade single-token ALL-CAPS acronyms (≥2 letters)
      for (let i = 0; i < sent.length; i++) {
        const globalIdx = input.indexOf(sent[i]);
        if (globalIdx === -1) continue;
        if (isAllCapsAcronym(sent[i].value) &&
            (normalizedPOS[globalIdx] === 'NOUN' || normalizedPOS[globalIdx] === 'X')) {
          normalizedPOS[globalIdx] = 'PROPN';
          posSource[globalIdx] = 'fallback';
        }
      }
    }
  }

  // 3) Demotion: any token that is PROPN but is NOT in a multi-token run
  //    and is NOT an acronym becomes NOUN (works for both model & fallback).
  for (let i = 0; i < input.length; i++) {
    if (normalizedPOS[i] !== 'PROPN') continue;
    if (inProperRun[i]) continue;                   // keep real multi-word names (e.g., Mother Nature, Andrew Jackson)
    if (isAllCapsAcronym(input[i].value)) continue; // keep NASA, USA
    normalizedPOS[i] = 'NOUN';
    if (posSource[i] === 'model') posSource[i] = 'demoted'; // note: we demoted a model tag
    else if (posSource[i] === 'fallback') posSource[i] = 'demoted';
  }

  // 4) Build compound PROPN spans (>=2 contiguous PROPN). Allow trailing possessive PART.
  const compounds: CompoundSpan[] = [];
  let s = -1;
  for (let i = 0; i < input.length; i++) {
    if (normalizedPOS[i] === 'PROPN') {
      if (s === -1) s = i;
      continue;
    }
    if (s !== -1 && input[i].pos === 'PART' && isPossessivePart(input[i].value)) {
      // keep span open through PART but don't include PART in span
      continue;
    }
    if (s !== -1) {
      const e = i - 1;
      if (e - s + 1 >= 2) {
        const text = input.slice(s, e + 1).map(x => x.value || '').join(' ');
        compounds.push({ start: s, end: e, text, lemma: text.toLowerCase(), pos: 'PROPN' });
      }
      s = -1;
    }
  }
  if (s !== -1) {
    const e = input.length - 1;
    if (e - s + 1 >= 2) {
      const text = input.slice(s, e + 1).map(x => x.value || '').join(' ');
      compounds.push({ start: s, end: e, text, lemma: text.toLowerCase(), pos: 'PROPN' });
    }
  }

  // 5) Decide which tokens ingest should keep (skip compound members, possessive PART, and stop words)
  const skip = new Set<number>();
  for (const c of compounds) {
    for (let i = c.start; i <= c.end; i++) skip.add(i);
    const after = c.end + 1;
    if (after < input.length && input[after].pos === 'PART' && isPossessivePart(input[after].value)) {
      skip.add(after); // never store "'s" after a compound
    }
  }

  // === REPLACE the keep decision to include stop-word gating
  const tokens: NormalizedToken[] = input.map((t, i) => {
    const lemma = t.lemma || t.value || '';
    const pos = normalizedPOS[i];
    const hardStop = isStopWord(lemma) || isStopWord(t.value);
    const keep =
      !skip.has(i) &&
      !(pos === 'PART' && isPossessivePart(t.value)) &&
      !hardStop;

    return {
      ...t,
      lemma,
      pos,
      posSource: posSource[i],
      keep,
    };
  });

  return { tokens, compounds };
}

// Legacy compatibility functions
export function normalizePosTag(pos: string): string {
  // Map winkNLP POS tags to our canonical format
  const posMap: Record<string, string> = {
    'NOUN': 'NOUN',
    'PROPN': 'PROPN', // Keep proper nouns as PROPN
    'VERB': 'VERB',
    'ADJ': 'ADJ',
    'ADV': 'ADV',
    'ADP': 'ADP', // Preposition
    'DET': 'DET', // Determiner
    'AUX': 'AUX', // Auxiliary verb
    'PART': 'PART', // Particle
    'PRON': 'PRON', // Pronoun
    'NUM': 'NUM', // Number
    'PUNCT': 'PUNCT', // Punctuation
    'SYM': 'SYM', // Symbol
    'CCONJ': 'CCONJ', // Coordinating conjunctions (and, but, or)
    'SCONJ': 'SCONJ', // Subordinating conjunctions (because, although, if)
    'X': 'X', // Other
  };
  
  return posMap[pos] || 'X';
}

export function normalizePosTags(posArray: string[]): string[] {
  return posArray.map(pos => normalizePosTag(pos));
}

export function generatePosPattern(posArray: string[]): string {
  return normalizePosTags(posArray).join('-');
}

// Legacy function for backward compatibility
export function processPropnSpans(
  tokens: string[],
  lemmas: string[],
  pos: string[],
  morphFeatures: string[],
  processWordCallback: (token: string, lemma: string, pos: string, morphFeature?: string, index?: number) => string
): { wordIds: string[]; compoundSpans: Array<{ text: string; start: number; end: number; pos: string }> } {
  // Convert to BaseTok format
  const baseTokens: BaseTok[] = tokens.map((token, index) => ({
    value: token,
    lemma: lemmas[index],
    pos: pos[index],
    index
  }));

  // Use the new normalization system
  const result = normalizePOS(baseTokens);
  
  const wordIds: string[] = [];
  const compoundSpans: Array<{ text: string; start: number; end: number; pos: string }> = [];

  // Process compound spans first
  for (const compound of result.compounds) {
    const wordId = processWordCallback(compound.text, compound.lemma, compound.pos, undefined, compound.start);
    for (let i = compound.start; i <= compound.end; i++) {
      wordIds[i] = wordId;
    }
    compoundSpans.push({ text: compound.text, start: compound.start, end: compound.end, pos: compound.pos });
  }

  // Process individual tokens
  for (let i = 0; i < result.tokens.length; i++) {
    const token = result.tokens[i];
    if (!token.keep) {
      wordIds[i] = '';
      continue;
    }
    
    const morphFeature = morphFeatures[i] ? `${token.pos}:${morphFeatures[i]}` : token.pos;
    const wordId = processWordCallback(token.value, token.lemma, token.pos, morphFeature, i);
    wordIds[i] = wordId;
  }

  return { wordIds, compoundSpans };
}