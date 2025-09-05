// src/lib/patternExamples.ts
// Example usage of pattern utilities for debugging

import { buildDebugPosWordPattern, buildDebugPosLemmaPattern, type POS } from './patterns.js';

/**
 * Example function showing how to create debug patterns
 * This is for reference - use this pattern when you find the rogue pattern creator
 */
export function createDebugPatternExample() {
  // Example data from the UI image
  const pos: POS[] = ['NOUN', 'AUX', 'DET', 'NOUN', 'ADV', 'DET', 'NOUN', 'ADV', 'VERB', 'PRON', 'ADP'];
  const tokens = ['Life', 'is', 'a', 'parade', 'where', 'the', 'tuba', 'always', 'drowns', 'you', 'out'];
  const lemmas = ['life', 'be', 'a', 'parade', 'where', 'the', 'tuba', 'always', 'drown', 'you', 'out'];

  // This would create the pattern seen in the UI
  const debugPattern = buildDebugPosWordPattern(pos, tokens);
  console.log('Debug pattern with tokens:', debugPattern);
  // Output: NOUN:Life-AUX:is-DET:a-NOUN:parade-ADV:where-DET:the-NOUN:tuba-ADV:always-VERB:drowns-PRON:you-ADP:out

  const debugPatternWithLemmas = buildDebugPosLemmaPattern(pos, lemmas);
  console.log('Debug pattern with lemmas:', debugPatternWithLemmas);
  // Output: NOUN:life-AUX:be-DET:a-NOUN:parade-ADV:where-DET:the-NOUN:tuba-ADV:always-VERB:drown-PRON:you-ADP:out

  return { debugPattern, debugPatternWithLemmas };
}
