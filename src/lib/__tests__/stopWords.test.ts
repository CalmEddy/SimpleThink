import { describe, it, expect } from 'vitest';
import { isStopWord, filterStopWords, isOnlyStopWords, getStopWordRatio } from '../stopWords.js';

describe('Stop Words Filtering', () => {
  describe('isStopWord', () => {
    it('should identify common stop words', () => {
      expect(isStopWord('the')).toBe(true);
      expect(isStopWord('a')).toBe(true);
      expect(isStopWord('an')).toBe(true);
      expect(isStopWord('and')).toBe(true);
      expect(isStopWord('or')).toBe(true);
      expect(isStopWord('but')).toBe(true);
      expect(isStopWord('in')).toBe(true);
      expect(isStopWord('on')).toBe(true);
      expect(isStopWord('at')).toBe(true);
      expect(isStopWord('to')).toBe(true);
      expect(isStopWord('for')).toBe(true);
      expect(isStopWord('of')).toBe(true);
      expect(isStopWord('with')).toBe(true);
      expect(isStopWord('by')).toBe(true);
      expect(isStopWord('is')).toBe(true);
      expect(isStopWord('are')).toBe(true);
      expect(isStopWord('was')).toBe(true);
      expect(isStopWord('were')).toBe(true);
      expect(isStopWord('be')).toBe(true);
      expect(isStopWord('been')).toBe(true);
      expect(isStopWord('have')).toBe(true);
      expect(isStopWord('has')).toBe(true);
      expect(isStopWord('had')).toBe(true);
      expect(isStopWord('do')).toBe(true);
      expect(isStopWord('does')).toBe(true);
      expect(isStopWord('did')).toBe(true);
      expect(isStopWord('will')).toBe(true);
      expect(isStopWord('would')).toBe(true);
      expect(isStopWord('can')).toBe(true);
      expect(isStopWord('could')).toBe(true);
      expect(isStopWord('may')).toBe(true);
      expect(isStopWord('might')).toBe(true);
      expect(isStopWord('must')).toBe(true);
      expect(isStopWord('this')).toBe(true);
      expect(isStopWord('that')).toBe(true);
      expect(isStopWord('these')).toBe(true);
      expect(isStopWord('those')).toBe(true);
      expect(isStopWord('i')).toBe(true);
      expect(isStopWord('me')).toBe(true);
      expect(isStopWord('my')).toBe(true);
      expect(isStopWord('you')).toBe(true);
      expect(isStopWord('your')).toBe(true);
      expect(isStopWord('he')).toBe(true);
      expect(isStopWord('him')).toBe(true);
      expect(isStopWord('his')).toBe(true);
      expect(isStopWord('she')).toBe(true);
      expect(isStopWord('her')).toBe(true);
      expect(isStopWord('it')).toBe(true);
      expect(isStopWord('its')).toBe(true);
      expect(isStopWord('we')).toBe(true);
      expect(isStopWord('our')).toBe(true);
      expect(isStopWord('they')).toBe(true);
      expect(isStopWord('them')).toBe(true);
      expect(isStopWord('their')).toBe(true);
    });

    it('should identify contractions as stop words', () => {
      expect(isStopWord("don't")).toBe(true);
      expect(isStopWord("doesn't")).toBe(true);
      expect(isStopWord("won't")).toBe(true);
      expect(isStopWord("can't")).toBe(true);
      expect(isStopWord("i'm")).toBe(true);
      expect(isStopWord("you're")).toBe(true);
      expect(isStopWord("he's")).toBe(true);
      expect(isStopWord("she's")).toBe(true);
      expect(isStopWord("it's")).toBe(true);
      expect(isStopWord("we're")).toBe(true);
      expect(isStopWord("they're")).toBe(true);
      expect(isStopWord("i've")).toBe(true);
      expect(isStopWord("you've")).toBe(true);
      expect(isStopWord("i'll")).toBe(true);
      expect(isStopWord("you'll")).toBe(true);
      expect(isStopWord("i'd")).toBe(true);
      expect(isStopWord("you'd")).toBe(true);
    });

    it('should identify common numbers as stop words', () => {
      expect(isStopWord('one')).toBe(true);
      expect(isStopWord('two')).toBe(true);
      expect(isStopWord('three')).toBe(true);
      expect(isStopWord('first')).toBe(true);
      expect(isStopWord('second')).toBe(true);
      expect(isStopWord('third')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(isStopWord('THE')).toBe(true);
      expect(isStopWord('The')).toBe(true);
      expect(isStopWord('And')).toBe(true);
      expect(isStopWord('AND')).toBe(true);
    });

    it('should not identify content words as stop words', () => {
      expect(isStopWord('cat')).toBe(false);
      expect(isStopWord('dog')).toBe(false);
      expect(isStopWord('house')).toBe(false);
      expect(isStopWord('running')).toBe(false);
      expect(isStopWord('beautiful')).toBe(false);
      expect(isStopWord('quickly')).toBe(false);
      expect(isStopWord('computer')).toBe(false);
      expect(isStopWord('algorithm')).toBe(false);
      expect(isStopWord('machine')).toBe(false);
      expect(isStopWord('learning')).toBe(false);
    });
  });

  describe('filterStopWords', () => {
    it('should filter out stop words from a list', () => {
      const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'the', 'lazy', 'dog'];
      const filtered = filterStopWords(words);
      expect(filtered).toEqual(['quick', 'brown', 'fox', 'jumps', 'lazy', 'dog']);
    });

    it('should handle empty arrays', () => {
      expect(filterStopWords([])).toEqual([]);
    });

    it('should handle arrays with only stop words', () => {
      const words = ['the', 'and', 'or', 'but'];
      const filtered = filterStopWords(words);
      expect(filtered).toEqual([]);
    });

    it('should handle arrays with no stop words', () => {
      const words = ['quick', 'brown', 'fox', 'jumps'];
      const filtered = filterStopWords(words);
      expect(filtered).toEqual(['quick', 'brown', 'fox', 'jumps']);
    });

    it('should preserve order of non-stop words', () => {
      const words = ['the', 'cat', 'and', 'dog', 'are', 'friends'];
      const filtered = filterStopWords(words);
      expect(filtered).toEqual(['cat', 'dog', 'friends']);
    });
  });

  describe('isOnlyStopWords', () => {
    it('should return true for phrases with only stop words', () => {
      expect(isOnlyStopWords(['the', 'and', 'or'])).toBe(true);
      expect(isOnlyStopWords(['i', 'am', 'the'])).toBe(true);
      expect(isOnlyStopWords(['this', 'is', 'a'])).toBe(true);
    });

    it('should return false for phrases with content words', () => {
      expect(isOnlyStopWords(['the', 'quick', 'brown'])).toBe(false);
      expect(isOnlyStopWords(['cat', 'and', 'dog'])).toBe(false);
      expect(isOnlyStopWords(['running', 'quickly'])).toBe(false);
    });

    it('should return false for empty arrays', () => {
      expect(isOnlyStopWords([])).toBe(false);
    });

    it('should return true for single stop words', () => {
      expect(isOnlyStopWords(['the'])).toBe(true);
      expect(isOnlyStopWords(['and'])).toBe(true);
    });
  });

  describe('getStopWordRatio', () => {
    it('should calculate correct ratios', () => {
      expect(getStopWordRatio(['the', 'quick', 'brown', 'fox'])).toBe(0.25); // 1/4
      expect(getStopWordRatio(['the', 'and', 'or', 'but'])).toBe(1.0); // 4/4
      expect(getStopWordRatio(['quick', 'brown', 'fox', 'jumps'])).toBe(0.0); // 0/4
      expect(getStopWordRatio(['the', 'cat', 'and', 'dog', 'are', 'friends'])).toBe(0.5); // 3/6
    });

    it('should return 0 for empty arrays', () => {
      expect(getStopWordRatio([])).toBe(0);
    });

    it('should handle single word arrays', () => {
      expect(getStopWordRatio(['the'])).toBe(1.0);
      expect(getStopWordRatio(['cat'])).toBe(0.0);
    });
  });
});
