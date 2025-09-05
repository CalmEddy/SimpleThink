// src/lib/patterns.ts
export type POS =
  | 'ADJ'|'ADV'|'DET'|'NOUN'|'PROPN'|'PRON'|'VERB'|'ADP'
  | 'CCONJ'|'SCONJ'|'PART'|'NUM'|'INTJ'|'PUNCT'|'SYM'|'X'|'AUX';

/**
 * Build canonical POS pattern for storage (POS ± morph joined by -)
 * This is the format used for storing patterns in the graph
 * Uses | for morphological features: VERB|past, ADJ|comparative
 */
export function buildPosPattern(pos: POS[], morph: (string | undefined)[] = []): string {
  return pos.map((p, i) => {
    const m = morph[i];
    return m && m !== 'base' ? `${p}|${m}` : p;
  }).join('-');
}

/**
 * Build debug/human-readable display pattern (UI only): "POS:Word-POS:Word-..."
 * This should ONLY be used for display purposes, never for storage
 */
export function buildDebugPosWordPattern(pos: POS[], words: string[]): string {
  const n = Math.min(pos.length, words.length);
  const out: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = `${pos[i]}:${words[i]}`;
  }
  return out.join('-');
}

/**
 * Build debug pattern with lemmas instead of tokens
 */
export function buildDebugPosLemmaPattern(pos: POS[], lemmas: string[]): string {
  const n = Math.min(pos.length, lemmas.length);
  const out: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = `${pos[i]}:${lemmas[i]}`;
  }
  return out.join('-');
}
