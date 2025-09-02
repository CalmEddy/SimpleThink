export type UniversalPOS =
  | 'NOUN' | 'VERB' | 'ADJ' | 'ADV'
  | 'ADP' | 'AUX' | 'DET' | 'PRON'
  | 'PROPN' | 'PART' | 'CCONJ' | 'SCONJ'
  | 'NUM' | 'PUNCT' | 'SYM' | 'INTJ';

const NOUN_SUFFIX = [/tion$/, /ment$/, /ness$/, /ity$/, /ship$/, /(er|or)$/, /ter$/];
const VERB_SUFFIX = [/ize$/, /ise$/, /ify$/, /ate$/, /er$/];
const ADJ_SUFFIX  = [/al$/, /ive$/, /ous$/, /(able|ible)$/, /ic$/, /ish$/, /less$/, /ful$/, /est$/];
const ADV_SUFFIX  = [/ly$/];

// Some determiners/pronouns/adpositions (for shape hints, not exhaustive)
// const STOPLIKE = new Set(['the','a','an','this','that','these','those']);

function guessPOSBySuffix(lemma: string): Set<UniversalPOS> {
  const s = new Set<UniversalPOS>();
  if (NOUN_SUFFIX.some(rx => rx.test(lemma))) s.add('NOUN');
  if (VERB_SUFFIX.some(rx => rx.test(lemma))) s.add('VERB');
  if (ADJ_SUFFIX.some(rx => rx.test(lemma)))  s.add('ADJ');
  if (ADV_SUFFIX.some(rx => rx.test(lemma)))  s.add('ADV');
  return s;
}

// If you have a way to retrieve the very first winkNLP POS for this lemma,
// expose it via an existing helper. Otherwise skip this hint gracefully.
export function getInitialWinkHintForLemma(_lemma: string): UniversalPOS | undefined {
  // Implement using your existing caches if present; otherwise return undefined.
  // For now, we'll skip this since we don't have a persistent cache of initial POS tags
  return undefined;
}

// Optional WordNet probe ONLY if already integrated.
export async function wordnetPOSProbeIfAvailable(lemma: string): Promise<Set<UniversalPOS> | null> {
  try {
    // Use existing wordnet/wordpos utilities if they exist; else return null.
    // Map synset POS → UniversalPOS: n→NOUN, v→VERB, a/s→ADJ, r→ADV
    // For now, we don't have WordNet integrated, so return null
    return null;
  } catch {
    return null;
  }
}

export async function auditPosPotentialForLemma(lemma: string): Promise<{ pos: UniversalPOS[], sources: string[] }> {
  const sources: string[] = [];
  const pot = new Set<UniversalPOS>();

  // 1) Heuristics by suffix/shape
  const h = guessPOSBySuffix(lemma);
  if (h.size) { h.forEach(p => pot.add(p)); sources.push('heuristic'); }

  // 2) winkNLP initial hint (if accessible)
  const wink = getInitialWinkHintForLemma(lemma);
  if (wink) { pot.add(wink); sources.push('wink'); }

  // 3) Optional WordNet/wordpos probe (only if already present)
  const wn = await wordnetPOSProbeIfAvailable(lemma);
  if (wn && wn.size) { wn.forEach(p => pot.add(p)); sources.push('wordnet'); }

  // 4) Fallback: if nothing matched, default to NOUN (common-case anchor)
  if (pot.size === 0) {
    pot.add('NOUN');
    sources.push('heuristic'); // Add heuristic source for fallback
  }

  // Normalize stable order: NOUN, VERB, ADJ, ADV, then others
  const order: UniversalPOS[] = ['NOUN','VERB','ADJ','ADV','PROPN','PRON','DET','ADP','AUX','PART','CCONJ','SCONJ','NUM','PUNCT','SYM','INTJ'];
  const arr = Array.from(pot).sort((a,b) => order.indexOf(a) - order.indexOf(b));
  return { pos: arr, sources };
}
