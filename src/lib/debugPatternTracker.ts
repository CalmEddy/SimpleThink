// src/lib/debugPatternTracker.ts
// Enhanced debugging to track down the rogue POS:Word pattern

import { buildDebugPosWordPattern, buildDebugPosLemmaPattern, type POS } from './patterns.js';

/**
 * Debug tracker to find where POS:Word patterns are being created
 */
export class PatternTracker {
  private static instance: PatternTracker;
  private patterns: Set<string> = new Set();
  private callStack: Map<string, string[]> = new Map();
  private isTracking = false;

  private constructor() {}

  static getInstance(): PatternTracker {
    if (!PatternTracker.instance) {
      PatternTracker.instance = new PatternTracker();
    }
    return PatternTracker.instance;
  }

  /**
   * Track a pattern creation with call stack
   */
  trackPattern(pattern: string, source: string) {
    // Avoid infinite loops
    if (this.isTracking) return;
    
    this.isTracking = true;
    this.patterns.add(pattern);
    const stack = new Error().stack?.split('\n').slice(2, 10) || [];
    this.callStack.set(pattern, stack);
    
    console.group(`🔍 Pattern Tracker: ${source}`);
    console.log('Pattern:', pattern);
    console.log('Call Stack:', stack);
    console.groupEnd();
    
    this.isTracking = false;
  }

  /**
   * Check if a string looks like a POS:Word pattern
   */
  isPosWordPattern(str: string): boolean {
    const regex = /\b(?:ADJ|ADV|DET|NOUN|PROPN|PRON|VERB|ADP|CCONJ|SCONJ|PART|NUM|INTJ|PUNCT|SYM|X|AUX)\s*:\s*[^\s-]+(?:-(?:ADJ|ADV|DET|NOUN|PROPN|PRON|VERB|ADP|CCONJ|SCONJ|PART|NUM|INTJ|PUNCT|SYM|X|AUX)\s*:\s*[^\s-]+)+\b/;
    return regex.test(str);
  }

  /**
   * Get all tracked patterns
   */
  getTrackedPatterns(): string[] {
    return Array.from(this.patterns);
  }

  /**
   * Get call stack for a specific pattern
   */
  getCallStack(pattern: string): string[] {
    return this.callStack.get(pattern) || [];
  }

  /**
   * Clear all tracked patterns
   */
  clear() {
    this.patterns.clear();
    this.callStack.clear();
  }
}

// Global instance
export const patternTracker = PatternTracker.getInstance();

/**
 * Enhanced console wrapper that tracks POS:Word patterns
 */
export function wrapConsoleForPatternTracking() {
  const tracker = PatternTracker.getInstance();
  
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;

  const wrap = (orig: any) => (...args: any[]) => {
    // Check each argument for POS:Word patterns
    args.forEach(arg => {
      if (typeof arg === 'string' && tracker.isPosWordPattern(arg)) {
        // Skip if this is our own debug output
        if (!arg.includes('Pattern Tracker') && !arg.includes('🔍')) {
          tracker.trackPattern(arg, 'Console Output');
        }
      }
    });
    return orig(...args);
  };

  console.log = wrap(originalLog);
  console.info = wrap(originalInfo);
  console.warn = wrap(originalWarn);
  console.error = wrap(originalError);
}

/**
 * Monitor DOM for POS:Word patterns
 */
export function monitorDOMForPatterns() {
  const tracker = PatternTracker.getInstance();
  
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList' || mutation.type === 'characterData') {
        const target = mutation.target as Node;
        if (target.textContent && tracker.isPosWordPattern(target.textContent)) {
          tracker.trackPattern(target.textContent, 'DOM Mutation');
        }
      }
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  return observer;
}

/**
 * Create a debug pattern for testing
 */
export function createTestPattern(): string {
  const pos: POS[] = ['NOUN', 'AUX', 'DET', 'NOUN', 'ADV', 'DET', 'NOUN', 'ADV', 'VERB', 'PRON', 'ADP'];
  const tokens = ['Life', 'is', 'a', 'parade', 'where', 'the', 'tuba', 'always', 'drowns', 'you', 'out'];
  
  const pattern = buildDebugPosWordPattern(pos, tokens);
  // Don't track the test pattern to avoid infinite loops
  return pattern;
}