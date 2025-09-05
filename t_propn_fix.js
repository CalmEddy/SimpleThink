[1mdiff --git a/src/lib/posHeuristics.ts b/src/lib/posHeuristics.ts[m
[1mindex 827a655..33df457 100644[m
[1m--- a/src/lib/posHeuristics.ts[m
[1m+++ b/src/lib/posHeuristics.ts[m
[36m@@ -3,10 +3,12 @@[m
  * Used during word creation to make initial POS guesses[m
  */[m
 [m
[32m+[m[32mimport { testWordInContexts } from './nlp.js';[m
[32m+[m
 export interface POSGuess {[m
   pos: string;[m
   confidence: 'high' | 'medium' | 'low';[m
[31m-  source: 'suffix' | 'capitalization' | 'common_word';[m
[32m+[m[32m  source: 'suffix' | 'capitalization' | 'common_word' | 'wink';[m
 }[m
 [m
 /**[m
[36m@@ -62,6 +64,50 @@[m [mexport function analyzePotentialPOS(word: string, winkNLPPOS?: string): string[][m
   return uniquePOS;[m
 }[m
 [m
[32m+[m[32m/**[m
[32m+[m[32m * Enhanced version that uses context testing to discover all possible POS tags[m
[32m+[m[32m */[m
[32m+[m[32mexport async function analyzePotentialPOSWithContext(word: string, winkNLPPOS?: string): Promise<string[]> {[m
[32m+[m[32m  const results = new Set<string>();[m
[32m+[m[41m  [m
[32m+[m[32m  // Add the original winkNLP result[m
[32m+[m[32m  if (winkNLPPOS) {[m
[32m+[m[32m    results.add(normalizePOS(winkNLPPOS));[m
[32m+[m[32m  }[m
[32m+[m[41m  [m
[32m+[m[32m  // Test in different contexts to discover additional POS tags[m
[32m+[m[32m  try {[m
[32m+[m[32m    const contextTest = await testWordInContexts(word);[m
[32m+[m[32m    contextTest.uniquePOS.forEach(pos => {[m
[32m+[m[32m      results.add(normalizePOS(pos));[m
[32m+[m[32m    });[m
[32m+[m[32m  } catch (error) {[m
[32m+[m[32m    console.warn(`Context testing failed for word "${word}":`, error);[m
[32m+[m[32m    // Fallback to original heuristics if context testing fails[m
[32m+[m[32m    const fallbackPOS = analyzePotentialPOS(word, winkNLPPOS);[m
[32m+[m[32m    fallbackPOS.forEach(pos => results.add(pos));[m
[32m+[m[32m  }[m
[32m+[m[41m  [m
[32m+[m[32m  // Add suffix-based guesses (existing logic)[m
[32m+[m[32m  const suffixGuesses = analyzeSuffixes(word);[m
[32m+[m[32m  suffixGuesses.forEach(guess => {[m
[32m+[m[32m    results.add(guess.pos);[m
[32m+[m[32m  });[m
[32m+[m[41m  [m
[32m+[m[32m  // Add common word patterns (existing logic)[m
[32m+[m[32m  const commonGuesses = analyzeCommonWords(word);[m
[32m+[m[32m  commonGuesses.forEach(guess => {[m
[32m+[m[32m    results.add(guess.pos);[m
[32m+[m[32m  });[m
[32m+[m[41m  [m
[32m+[m[32m  // Add capitalization-based guesses[m
[32m+[m[32m  if (isProperNoun(word)) {[m
[32m+[m[32m    results.add('NOUN');[m
[32m+[m[32m  }[m
[32m+[m[41m  [m
[32m+[m[32m  return Array.from(results);[m
[32m+[m[32m}[m
[32m+[m
 /**[m
  * Analyze word suffixes to guess POS[m
  */[m
[36m@@ -189,7 +235,7 @@[m [mfunction analyzeCommonWords(word: string): POSGuess[] {[m
 function normalizePOS(pos: string): string {[m
   const posMap: Record<string, string> = {[m
     'NOUN': 'NOUN',[m
[31m-    'PROPN': 'NOUN',[m
[32m+[m[32m    'PROPN': 'PROPN', // Keep proper nouns as PROPN[m
     'VERB': 'VERB',[m
     'ADJ': 'ADJ',[m
     'ADV': 'ADV',[m
