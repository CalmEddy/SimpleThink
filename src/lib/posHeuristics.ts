/**
 * POS Heuristics for detecting potential parts of speech
 * Used during word creation to make initial POS guesses
 */

export interface POSGuess {
  pos: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'suffix' | 'capitalization' | 'common_word';
}

/**
 * Analyze a word to guess potential POS tags based on heuristics
 */
export function analyzePotentialPOS(word: string, winkNLPPOS?: string): string[] {
  const guesses: POSGuess[] = [];
  const lower = word.toLowerCase();
  
  // Add winkNLP POS if available
  if (winkNLPPOS) {
    guesses.push({
      pos: normalizePOS(winkNLPPOS),
      confidence: 'high',
      source: 'wink'
    });
  }
  
  // Analyze suffixes
  const suffixGuesses = analyzeSuffixes(word);
  guesses.push(...suffixGuesses);
  
  // Analyze capitalization (proper nouns)
  if (isProperNoun(word)) {
    guesses.push({
      pos: 'NOUN',
      confidence: 'medium',
      source: 'capitalization'
    });
  }
  
  // Common word patterns
  const commonGuesses = analyzeCommonWords(word);
  guesses.push(...commonGuesses);
  
  // Special case: words that commonly function as both nouns and verbs
  const nounVerbWords = ['water', 'run', 'walk', 'talk', 'play', 'work', 'book', 'light', 'fire', 'time', 'space', 'place', 'face', 'hand', 'head', 'eye', 'ear', 'mouth', 'nose', 'foot', 'leg', 'arm', 'back', 'side', 'top', 'bottom', 'front', 'end', 'start', 'begin', 'finish', 'stop', 'move', 'turn', 'change', 'help', 'use', 'make', 'take', 'give', 'get', 'put', 'set', 'let', 'keep', 'hold', 'open', 'close'];
  if (nounVerbWords.includes(lower)) {
    guesses.push({
      pos: 'NOUN',
      confidence: 'medium',
      source: 'common_word'
    });
    guesses.push({
      pos: 'VERB',
      confidence: 'medium',
      source: 'common_word'
    });
  }
  
  // Deduplicate and return unique POS tags
  const uniquePOS = [...new Set(guesses.map(g => g.pos))];
  return uniquePOS;
}

/**
 * Analyze word suffixes to guess POS
 */
function analyzeSuffixes(word: string): POSGuess[] {
  const guesses: POSGuess[] = [];
  const lower = word.toLowerCase();
  
  // Noun suffixes
  const nounSuffixes = ['tion', 'sion', 'ment', 'ness', 'ity', 'ship', 'er', 'or', 'ist', 'ism', 'ance', 'ence'];
  for (const suffix of nounSuffixes) {
    if (lower.endsWith(suffix)) {
      guesses.push({
        pos: 'NOUN',
        confidence: 'high',
        source: 'suffix'
      });
      break;
    }
  }
  
  // Verb suffixes
  const verbSuffixes = ['ize', 'ise', 'ify', 'ate', 'en', 'ed', 'ing'];
  for (const suffix of verbSuffixes) {
    if (lower.endsWith(suffix)) {
      guesses.push({
        pos: 'VERB',
        confidence: 'high',
        source: 'suffix'
      });
      break;
    }
  }
  
  // Adjective suffixes
  const adjSuffixes = ['al', 'ive', 'ous', 'able', 'ible', 'ic', 'ish', 'less', 'ful', 'y', 'ary', 'ory'];
  for (const suffix of adjSuffixes) {
    if (lower.endsWith(suffix)) {
      guesses.push({
        pos: 'ADJ',
        confidence: 'high',
        source: 'suffix'
      });
      break;
    }
  }
  
  // Adverb suffix
  if (lower.endsWith('ly')) {
    guesses.push({
      pos: 'ADV',
      confidence: 'high',
      source: 'suffix'
    });
  }
  
  return guesses;
}

/**
 * Check if word appears to be a proper noun
 */
function isProperNoun(word: string): boolean {
  // Capitalized but not sentence-initial
  if (word.length > 1 && word[0] === word[0].toUpperCase() && word[1] === word[1].toLowerCase()) {
    return true;
  }
  
  // All caps (acronyms)
  if (word === word.toUpperCase() && word.length > 1) {
    return true;
  }
  
  return false;
}

/**
 * Analyze common word patterns
 */
function analyzeCommonWords(word: string): POSGuess[] {
  const guesses: POSGuess[] = [];
  const lower = word.toLowerCase();
  
  // Common determiners
  if (['a', 'an', 'the', 'this', 'that', 'these', 'those'].includes(lower)) {
    guesses.push({
      pos: 'DET',
      confidence: 'high',
      source: 'common_word'
    });
  }
  
  // Common prepositions
  if (['of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'about', 'against', 'between', 'among'].includes(lower)) {
    guesses.push({
      pos: 'ADP',
      confidence: 'high',
      source: 'common_word'
    });
  }
  
  // Common auxiliary verbs
  if (['is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'may', 'might', 'must', 'should'].includes(lower)) {
    guesses.push({
      pos: 'AUX',
      confidence: 'high',
      source: 'common_word'
    });
  }
  
  // Common pronouns
  if (['i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'her', 'its', 'our', 'their'].includes(lower)) {
    guesses.push({
      pos: 'PRON',
      confidence: 'high',
      source: 'common_word'
    });
  }
  
  return guesses;
}

/**
 * Normalize POS tag to canonical format
 */
function normalizePOS(pos: string): string {
  const posMap: Record<string, string> = {
    'NOUN': 'NOUN',
    'PROPN': 'NOUN',
    'VERB': 'VERB',
    'ADJ': 'ADJ',
    'ADV': 'ADV',
    'ADP': 'ADP',
    'DET': 'DET',
    'AUX': 'AUX',
    'PART': 'PART',
    'PRON': 'PRON',
    'NUM': 'NUM',
    'PUNCT': 'PUNCT',
    'SYM': 'SYM',
    'X': 'X',
  };
  
  return posMap[pos] || 'NOUN';
}

/**
 * Get sources for POS guesses
 */
export function getPOSGuessSources(word: string, winkNLPPOS?: string): string[] {
  const sources: string[] = [];
  
  if (winkNLPPOS) {
    sources.push('wink');
  }
  
  // Check if we have suffix-based guesses
  const suffixGuesses = analyzeSuffixes(word);
  if (suffixGuesses.length > 0) {
    sources.push('suffix');
  }
  
  // Check if we have capitalization-based guesses
  if (isProperNoun(word)) {
    sources.push('capitalization');
  }
  
  // Check if we have common word-based guesses
  const commonGuesses = analyzeCommonWords(word);
  if (commonGuesses.length > 0) {
    sources.push('common_word');
  }
  
  return sources;
}
