/**
 * Closed-class words that should be restricted to specific POS categories
 * These words are overwhelmingly used as specific parts of speech and should
 * not be forced into other categories through aggressive context testing.
 */

export const CLOSED_CLASS_ALLOWED_POS: Record<string, Set<string>> = {
  // Indefinite pronouns & negatives
  'nothing': new Set(['PRON', 'NOUN']), // allow NOUN for idioms like "a big nothing"
  'something': new Set(['PRON', 'NOUN']),
  'anything': new Set(['PRON', 'NOUN']),
  'everything': new Set(['PRON', 'NOUN']),
  'nobody': new Set(['PRON', 'NOUN']),
  'somebody': new Set(['PRON', 'NOUN']),
  'anybody': new Set(['PRON', 'NOUN']),
  'everybody': new Set(['PRON', 'NOUN']),
  'none': new Set(['PRON', 'NOUN']),
  
  // Demonstrative pronouns
  'this': new Set(['PRON', 'DET']),
  'that': new Set(['PRON', 'DET']),
  'these': new Set(['PRON', 'DET']),
  'those': new Set(['PRON', 'DET']),
  
  // Personal pronouns
  'i': new Set(['PRON']),
  'you': new Set(['PRON']),
  'he': new Set(['PRON']),
  'she': new Set(['PRON']),
  'it': new Set(['PRON']),
  'we': new Set(['PRON']),
  'they': new Set(['PRON']),
  'me': new Set(['PRON']),
  'him': new Set(['PRON']),
  'her': new Set(['PRON']),
  'us': new Set(['PRON']),
  'them': new Set(['PRON']),
  
  // Possessive pronouns
  'my': new Set(['PRON', 'DET']),
  'your': new Set(['PRON', 'DET']),
  'his': new Set(['PRON', 'DET']),
  'its': new Set(['PRON', 'DET']),
  'our': new Set(['PRON', 'DET']),
  'their': new Set(['PRON', 'DET']),
  
  // Articles
  'a': new Set(['DET']),
  'an': new Set(['DET']),
  'the': new Set(['DET']),
  
  // Common prepositions
  'of': new Set(['ADP']),
  'in': new Set(['ADP']),
  'on': new Set(['ADP']),
  'at': new Set(['ADP']),
  'to': new Set(['ADP', 'PART']),
  'for': new Set(['ADP']),
  'with': new Set(['ADP']),
  'by': new Set(['ADP']),
  'from': new Set(['ADP']),
  'about': new Set(['ADP']),
  'against': new Set(['ADP']),
  'between': new Set(['ADP']),
  'among': new Set(['ADP']),
  
  // Auxiliary verbs (these can be verbs, but shouldn't be forced into other categories)
  'is': new Set(['AUX', 'VERB']),
  'are': new Set(['AUX', 'VERB']),
  'was': new Set(['AUX', 'VERB']),
  'were': new Set(['AUX', 'VERB']),
  'be': new Set(['AUX', 'VERB']),
  'been': new Set(['AUX', 'VERB']),
  'being': new Set(['AUX', 'VERB']),
  'have': new Set(['AUX', 'VERB']),
  'has': new Set(['AUX', 'VERB']),
  'had': new Set(['AUX', 'VERB']),
  'do': new Set(['AUX', 'VERB']),
  'does': new Set(['AUX', 'VERB']),
  'did': new Set(['AUX', 'VERB']),
  'will': new Set(['AUX', 'VERB']),
  'would': new Set(['AUX', 'VERB']),
  'can': new Set(['AUX', 'VERB']),
  'could': new Set(['AUX', 'VERB']),
  'may': new Set(['AUX', 'VERB']),
  'might': new Set(['AUX', 'VERB']),
  'must': new Set(['AUX', 'VERB']),
  'should': new Set(['AUX', 'VERB']),
};

/**
 * Check if a lemma is a closed-class word and return its allowed POS categories
 */
export function allowedPosForLemma(lemma: string): Set<string> | null {
  const l = lemma.toLowerCase();
  return CLOSED_CLASS_ALLOWED_POS[l] ?? null; // null = open-class, no restriction
}

/**
 * Check if a lemma is closed-class (has restrictions)
 */
export function isClosedClass(lemma: string): boolean {
  return allowedPosForLemma(lemma) !== null;
}
