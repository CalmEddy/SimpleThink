// src/lib/patternReplacer.ts
// Global pattern replacement utility to catch and replace ad-hoc POS:Word pattern creation

import { buildDebugPosWordPattern, buildDebugPosLemmaPattern, type POS } from './patterns.js';

/**
 * Global pattern replacement utility
 * This will replace any manual POS:Word pattern creation with our centralized utility
 */
export class PatternReplacer {
  private static instance: PatternReplacer;
  private originalConsole: any;

  private constructor() {
    this.originalConsole = { ...console };
  }

  static getInstance(): PatternReplacer {
    if (!PatternReplacer.instance) {
      PatternReplacer.instance = new PatternReplacer();
    }
    return PatternReplacer.instance;
  }

  /**
   * Replace any manual pattern creation with centralized utility
   */
  replacePatternCreation(pos: string[], words: string[]): string {
    console.warn('🔧 Pattern Replacer: Manual pattern creation detected!');
    console.warn('🔧 Original POS array:', pos);
    console.warn('🔧 Original words array:', words);
    console.warn('🔧 Replacing with centralized utility...');
    
    const result = buildDebugPosWordPattern(pos as POS[], words);
    console.warn('🔧 Replaced pattern:', result);
    return result;
  }

  /**
   * Replace pattern creation with lemmas
   */
  replacePatternCreationWithLemmas(pos: string[], lemmas: string[]): string {
    console.warn('🔧 Pattern Replacer: Manual lemma pattern creation detected!');
    console.warn('🔧 Original POS array:', pos);
    console.warn('🔧 Original lemmas array:', lemmas);
    console.warn('🔧 Replacing with centralized utility...');
    
    const result = buildDebugPosLemmaPattern(pos as POS[], lemmas);
    console.warn('🔧 Replaced pattern:', result);
    return result;
  }
}

// Global instance
export const patternReplacer = PatternReplacer.getInstance();

/**
 * Monkey patch Array.prototype.join to catch manual pattern creation
 */
export function patchArrayJoin() {
  const originalJoin = Array.prototype.join;
  
  Array.prototype.join = function(separator: string) {
    // Check if this looks like a POS:Word pattern
    if (separator === '-' && this.length > 1) {
      const firstItem = this[0];
      if (typeof firstItem === 'string' && firstItem.includes(':')) {
        // This might be a manual pattern creation
        console.warn('🔧 Pattern Replacer: Potential manual pattern creation detected!');
        console.warn('🔧 Array:', this);
        console.warn('🔧 Separator:', separator);
        console.warn('🔧 Call stack:', new Error().stack);
      }
    }
    
    return originalJoin.call(this, separator);
  };
}

/**
 * Monkey patch String.prototype methods to catch manual pattern creation
 */
export function patchStringMethods() {
  const originalReplace = String.prototype.replace;
  
  String.prototype.replace = function(searchValue: string | RegExp, replaceValue: string | ((substring: string, ...args: any[]) => string)) {
    const result = originalReplace.call(this, searchValue, replaceValue);
    
    // Check if the result looks like a POS:Word pattern
    if (typeof result === 'string' && /\b(?:ADJ|ADV|DET|NOUN|PROPN|PRON|VERB|ADP|CCONJ|SCONJ|PART|NUM|INTJ|PUNCT|SYM|X|AUX)\s*:\s*[^\s-]+(?:-(?:ADJ|ADV|DET|NOUN|PROPN|PRON|VERB|ADP|CCONJ|SCONJ|PART|NUM|INTJ|PUNCT|SYM|X|AUX)\s*:\s*[^\s-]+)+\b/.test(result)) {
      console.warn('🔧 Pattern Replacer: POS:Word pattern created via string replacement!');
      console.warn('🔧 Original string:', this);
      console.warn('🔧 Search value:', searchValue);
      console.warn('🔧 Replace value:', replaceValue);
      console.warn('🔧 Result:', result);
      console.warn('🔧 Call stack:', new Error().stack);
    }
    
    return result;
  };
}
