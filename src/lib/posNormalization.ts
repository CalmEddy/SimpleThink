/**
 * Centralized POS tag normalization utility
 * This is the single source of truth for mapping winkNLP POS tags to our canonical format
 */

/**
 * Normalize a POS tag from winkNLP to our canonical format
 * @param pos - The POS tag from winkNLP
 * @returns The normalized POS tag
 */
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

/**
 * Normalize an array of POS tags
 * @param posArray - Array of POS tags from winkNLP
 * @returns Array of normalized POS tags
 */
export function normalizePosTags(posArray: string[]): string[] {
  return posArray.map(pos => normalizePosTag(pos));
}

/**
 * Generate a POS pattern from an array of POS tags
 * @param posArray - Array of POS tags from winkNLP
 * @returns POS pattern string (e.g., "NOUN-VERB-ADJ")
 */
export function generatePosPattern(posArray: string[]): string {
  return normalizePosTags(posArray).join('-');
}

/**
 * Utility for detecting possessive PART tokens
 */
export function isPossessivePart(v: string): boolean {
  return v === "'s" || v === "'s";
}

/**
 * Process tokens with PROPN span collapsing logic.
 * This ensures multi-word proper nouns are handled consistently across the codebase.
 * 
 * @param tokens - Array of token strings
 * @param lemmas - Array of lemmatized strings
 * @param pos - Array of POS tags
 * @param morphFeatures - Array of morphological features
 * @param processWordCallback - Callback function to process individual words
 * @returns Object containing processed word IDs and compound spans
 */
export function processPropnSpans(
  tokens: string[],
  lemmas: string[],
  pos: string[],
  morphFeatures: string[],
  processWordCallback: (token: string, lemma: string, pos: string, morphFeature?: string, index?: number) => string
): { wordIds: string[]; compoundSpans: Array<{ text: string; start: number; end: number; pos: string }> } {
  const wordIds: string[] = [];
  const compoundSpans: Array<{ text: string; start: number; end: number; pos: string }> = [];

  // Step 1: Detect multi-word PROPN spans
  type Tok = { value: string; lemma: string; pos: string; index: number };
  const toks: Tok[] = tokens.map((token, index) => ({
    value: token,
    lemma: lemmas[index],
    pos: pos[index],
    index
  }));

  const skip = new Set<number>();
  const spans: Array<{ start: number; end: number; text: string; lemma: string }> = [];
  let runStart = -1;

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.pos === 'PROPN') {
      if (runStart === -1) runStart = i;
      continue;
    }
    if (runStart !== -1 && t.pos === 'PART' && isPossessivePart(t.value)) {
      // Flush the run before the possessive PART
      const end = i - 1;
      if (end - runStart + 1 >= 2) {
        const text = toks.slice(runStart, end + 1).map(x => x.value).join(' ');
        spans.push({ start: runStart, end, text, lemma: text.toLowerCase() });
      }
      runStart = -1;
      continue;
    }
    if (runStart !== -1) {
      const end = i - 1;
      if (end - runStart + 1 >= 2) {
        const text = toks.slice(runStart, end + 1).map(x => x.value).join(' ');
        spans.push({ start: runStart, end, text, lemma: text.toLowerCase() });
      }
      runStart = -1;
    }
  }
  if (runStart !== -1) {
    const end = toks.length - 1;
    if (end - runStart + 1 >= 2) {
      const text = toks.slice(runStart, end + 1).map(x => x.value).join(' ');
      spans.push({ start: runStart, end, text, lemma: text.toLowerCase() });
    }
  }

  // Create compound nodes for PROPN spans
  for (const s of spans) {
    const wordId = processWordCallback(s.text, s.lemma, 'PROPN', undefined, s.start);
    for (let i = s.start; i <= s.end; i++) {
      skip.add(i);
      wordIds[i] = wordId;
    }
    // Also skip an immediate possessive PART token right after the span
    if (s.end + 1 < toks.length && toks[s.end + 1].pos === 'PART' && isPossessivePart(toks[s.end + 1].value)) {
      skip.add(s.end + 1);
      wordIds[s.end + 1] = ''; // Placeholder for skipped PART
    }
    
    compoundSpans.push({ text: s.text, start: s.start, end: s.end, pos: 'PROPN' });
  }

  // Step 2: Process individual tokens (excluding those in multi-word PROPN spans)
  for (let i = 0; i < toks.length; i++) {
    if (skip.has(i)) continue;
    const t = toks[i];
    if (t.pos === 'PART') continue; // do not store "'s" as nodes
    
    const morphFeature = morphFeatures[i] ? `${t.pos}:${morphFeatures[i]}` : t.pos;
    const wordId = processWordCallback(t.value, t.lemma, t.pos, morphFeature, i);
    wordIds[i] = wordId;
  }

  return { wordIds, compoundSpans };
}