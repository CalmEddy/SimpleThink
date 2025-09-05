import { describe, it, expect } from 'vitest';
import { buildPosPattern, buildDebugPosWordPattern, buildDebugPosLemmaPattern, type POS } from '../patterns.js';

describe('Pattern Utilities', () => {
  describe('buildPosPattern', () => {
    it('should build basic POS pattern', () => {
      const pos: POS[] = ['NOUN', 'VERB', 'NOUN'];
      const result = buildPosPattern(pos);
      expect(result).toBe('NOUN-VERB-NOUN');
    });

    it('should include morphological features', () => {
      const pos: POS[] = ['NOUN', 'VERB', 'NOUN'];
      const morph = ['base', 'past', 'base'];
      const result = buildPosPattern(pos, morph);
      expect(result).toBe('NOUN-VERB:past-NOUN');
    });

    it('should skip base morphological features', () => {
      const pos: POS[] = ['NOUN', 'VERB', 'NOUN'];
      const morph = ['base', 'base', 'base'];
      const result = buildPosPattern(pos, morph);
      expect(result).toBe('NOUN-VERB-NOUN');
    });
  });

  describe('buildDebugPosWordPattern', () => {
    it('should build debug pattern with words', () => {
      const pos: POS[] = ['NOUN', 'VERB', 'NOUN'];
      const words = ['cat', 'eats', 'mouse'];
      const result = buildDebugPosWordPattern(pos, words);
      expect(result).toBe('NOUN:cat-VERB:eats-NOUN:mouse');
    });

    it('should handle mismatched array lengths', () => {
      const pos: POS[] = ['NOUN', 'VERB'];
      const words = ['cat', 'eats', 'mouse'];
      const result = buildDebugPosWordPattern(pos, words);
      expect(result).toBe('NOUN:cat-VERB:eats');
    });
  });

  describe('buildDebugPosLemmaPattern', () => {
    it('should build debug pattern with lemmas', () => {
      const pos: POS[] = ['NOUN', 'VERB', 'NOUN'];
      const lemmas = ['cat', 'eat', 'mouse'];
      const result = buildDebugPosLemmaPattern(pos, lemmas);
      expect(result).toBe('NOUN:cat-VERB:eat-NOUN:mouse');
    });
  });
});
