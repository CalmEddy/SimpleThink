// Common English stop words that should not be ingested as individual words
export const STOP_WORDS = new Set([
  // Articles
  'a', 'an', 'the',
  
  // Pronouns
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  
  // Prepositions
  'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'at', 'before', 'behind', 'below', 'beneath', 'beside', 'between', 'beyond', 'by', 'down', 'during', 'except', 'for', 'from', 'in', 'inside', 'into', 'like', 'near', 'of', 'off', 'on', 'onto', 'out', 'outside', 'over', 'past', 'since', 'through', 'throughout', 'to', 'toward', 'towards', 'under', 'underneath', 'until', 'up', 'upon', 'with', 'within', 'without',
  
  // Conjunctions
  'and', 'but', 'or', 'nor', 'for', 'yet', 'so', 'because', 'if', 'when', 'where', 'while', 'although', 'though', 'unless', 'until', 'whether',
  
  // Auxiliary verbs
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  
  // Common adverbs
  'very', 'really', 'quite', 'just', 'only', 'also', 'too', 'well', 'much', 'more', 'most', 'less', 'least', 'so', 'such', 'here', 'there', 'where', 'when', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'many', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'than', 'then', 'once',
  
  // Common determiners
  'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
  
  // Numbers (common ones)
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'first', 'second', 'third', 'last', 'next', 'other', 'another',
  
  // Common interjections
  'oh', 'ah', 'well', 'yes', 'no', 'ok', 'okay', 'hi', 'hello', 'hey', 'bye', 'goodbye',
  
  // Common contractions
  'don\'t', 'doesn\'t', 'didn\'t', 'won\'t', 'wouldn\'t', 'shouldn\'t', 'couldn\'t', 'can\'t', 'isn\'t', 'aren\'t', 'wasn\'t', 'weren\'t', 'hasn\'t', 'haven\'t', 'hadn\'t', 'i\'m', 'you\'re', 'he\'s', 'she\'s', 'it\'s', 'we\'re', 'they\'re', 'i\'ve', 'you\'ve', 'we\'ve', 'they\'ve', 'i\'ll', 'you\'ll', 'he\'ll', 'she\'ll', 'it\'ll', 'we\'ll', 'they\'ll', 'i\'d', 'you\'d', 'he\'d', 'she\'d', 'it\'d', 'we\'d', 'they\'d'
]);

/**
 * Check if a word should be filtered out as a stop word
 * @param s The string to check (can be undefined or null)
 * @returns true if the string is a stop word and should be filtered
 */
export function isStopWord(s: string | undefined | null): boolean {
  if (!s) return false;
  return STOP_WORDS.has(s.toLowerCase());
}

/**
 * Filter out stop words from a list of words
 * @param words Array of words to filter
 * @returns Array with stop words removed
 */
export function filterStopWords(words: string[]): string[] {
  return words.filter(word => !isStopWord(word));
}

/**
 * Check if a phrase consists only of stop words
 * @param words Array of words in the phrase
 * @returns true if all words are stop words
 */
export function isOnlyStopWords(words: string[]): boolean {
  return words.length > 0 && words.every(word => isStopWord(word));
}

/**
 * Get the ratio of stop words in a phrase
 * @param words Array of words in the phrase
 * @returns Ratio of stop words (0.0 to 1.0)
 */
export function getStopWordRatio(words: string[]): number {
  if (words.length === 0) return 0;
  const stopWordCount = words.filter(word => isStopWord(word)).length;
  return stopWordCount / words.length;
}
