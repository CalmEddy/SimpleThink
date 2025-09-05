/**
 * POS validation guards to prevent false positive classifications
 */

import { allowedPosForLemma } from './closedClass.js';

/**
 * Map coarse POS tags to WordNet POS keys
 */
const POS_TO_WN_KEY: Record<string, string> = {
  'NOUN': 'n',
  'VERB': 'v', 
  'ADJ': 'a',
  'ADV': 'r',
  'PRON': 'n', // Pronouns often map to noun entries in WordNet
  'DET': 'n',  // Determiners often map to noun entries
  'ADP': 'n',  // Prepositions often map to noun entries
  'AUX': 'v',  // Auxiliary verbs map to verb entries
};

/**
 * Check if a lemma is supported by WordNet for a given POS
 * This is a lightweight check that can be enhanced with actual WordNet integration
 */
export function isSupportedByWordNet(lemma: string, pos: string): boolean {
  // For now, we'll use a simple heuristic approach
  // In a full implementation, this would query WordNet directly
  
  const wnKey = POS_TO_WN_KEY[pos];
  if (!wnKey) return false;
  
  // Simple heuristics based on common patterns
  const lower = lemma.toLowerCase();
  
  // Words ending in -ing are likely verbs (present participle/gerund)
  if (pos === 'VERB' && lower.endsWith('ing')) return true;
  
  // Words ending in -ed are likely verbs (past tense)
  if (pos === 'VERB' && lower.endsWith('ed')) return true;
  
  // Words ending in -ly are likely adverbs
  if (pos === 'ADV' && lower.endsWith('ly')) return true;
  
  // Words ending in -tion, -sion, -ment are likely nouns
  if (pos === 'NOUN' && (lower.endsWith('tion') || lower.endsWith('sion') || lower.endsWith('ment'))) return true;
  
  // Words ending in -able, -ible are likely adjectives
  if (pos === 'ADJ' && (lower.endsWith('able') || lower.endsWith('ible'))) return true;
  
  // For closed-class words, be more permissive
  if (allowedPosForLemma(lemma)?.has(pos)) return true;
  
  // Default: assume support for common words, reject for obviously wrong combinations
  const obviouslyWrong = (
    (pos === 'VERB' && lower === 'nothing') ||
    (pos === 'VERB' && lower === 'something') ||
    (pos === 'VERB' && lower === 'anything') ||
    (pos === 'VERB' && lower === 'everything') ||
    (pos === 'VERB' && lower === 'nobody') ||
    (pos === 'VERB' && lower === 'somebody') ||
    (pos === 'VERB' && lower === 'anybody') ||
    (pos === 'VERB' && lower === 'everybody')
  );
  
  return !obviouslyWrong;
}

/**
 * Check if a POS should be considered for a given lemma based on closed-class restrictions
 */
export function isPosAllowedForLemma(lemma: string, pos: string): boolean {
  const allowed = allowedPosForLemma(lemma);
  if (!allowed) return true; // Open-class word, no restrictions
  return allowed.has(pos);
}

/**
 * Get the confidence level for a POS classification based on multiple factors
 */
export function getPosConfidence(lemma: string, pos: string, voteCount: number, totalTemplates: number): 'high' | 'medium' | 'low' {
  const voteRatio = voteCount / totalTemplates;
  
  // High confidence: strong evidence + lexical support
  if (voteRatio >= 0.8 && isSupportedByWordNet(lemma, pos)) return 'high';
  
  // Medium confidence: moderate evidence + lexical support
  if (voteRatio >= 0.5 && isSupportedByWordNet(lemma, pos)) return 'medium';
  
  // Low confidence: weak evidence or no lexical support
  return 'low';
}
