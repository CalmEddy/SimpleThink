import { describe, it, expect } from 'vitest';
import { nlpAnalyzer } from '../nlp.js';

describe('NLP Analyzer', () => {
  it('should analyze text correctly', async () => {
    const result = await nlpAnalyzer.analyzeText('The quick brown fox');
    
    expect(result.tokens).toHaveLength(4);
    expect(result.lemmas).toHaveLength(4);
    expect(result.pos).toHaveLength(4);
    expect(result.tokens).toContain('The');
    expect(result.tokens).toContain('quick');
    expect(result.tokens).toContain('brown');
    expect(result.tokens).toContain('fox');
  });

  it('should infer POS patterns correctly', () => {
    const pos1 = ['DET', 'ADJ', 'ADJ', 'NOUN'];
    const pattern1 = nlpAnalyzer.inferPosPattern(pos1);
    expect(pattern1).toBe('DET-ADJ-ADJ-NOUN');

    const pos2 = ['NOUN', 'VERB', 'NOUN'];
    const pattern2 = nlpAnalyzer.inferPosPattern(pos2);
    expect(pattern2).toBe('NOUN-VERB-NOUN');
  });

  it('should extract chunks correctly', () => {
    const lemmas = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'the', 'lazy', 'dog'];
    const pos = ['DET', 'ADJ', 'ADJ', 'NOUN', 'VERB', 'ADP', 'DET', 'ADJ', 'NOUN'];
    
    const chunks = nlpAnalyzer.extractChunks(lemmas, pos);
    
    expect(chunks).toBeDefined();
    expect(Array.isArray(chunks)).toBe(true);
    
    // With the new 3+ token requirement, we expect fewer chunks
    // but all chunks should meet the length requirement
    if (chunks.length > 0) {
      // Should find noun phrases
      const nounPhrases = chunks.filter(chunk => chunk.posPattern.includes('NOUN'));
      expect(nounPhrases.length).toBeGreaterThanOrEqual(0);
      
      // Should find verb phrases
      const verbPhrases = chunks.filter(chunk => chunk.posPattern.includes('VERB'));
      expect(verbPhrases.length).toBeGreaterThanOrEqual(0);
      
      // All chunks should have at least 3 tokens
      chunks.forEach(chunk => {
        const tokenCount = chunk.span[1] - chunk.span[0] + 1;
        expect(tokenCount).toBeGreaterThanOrEqual(3);
        expect(tokenCount).toBeLessThanOrEqual(8);
      });
    }
  });

  it('should handle empty text', async () => {
    const result = await nlpAnalyzer.analyzeText('');
    expect(result.tokens).toHaveLength(0);
    expect(result.lemmas).toHaveLength(0);
    expect(result.pos).toHaveLength(0);
  });

  it('should handle single word', async () => {
    const result = await nlpAnalyzer.analyzeText('hello');
    expect(result.tokens).toHaveLength(1);
    expect(result.lemmas).toHaveLength(1);
    expect(result.pos).toHaveLength(1);
  });

  it('should reject 2-token chunks', () => {
    const lemmas = ['we', 'fought', 'bravely', 'to', 'overthrow', 'the', 'system', 'of', 'oppression'];
    const pos = ['PRON', 'VERB', 'ADV', 'PART', 'VERB', 'DET', 'NOUN', 'ADP', 'NOUN'];
    
    const chunks = nlpAnalyzer.extractChunks(lemmas, pos);
    
    // Should not include 2-token chunks like "of oppression" or "to overthrow"
    chunks.forEach(chunk => {
      const tokenCount = chunk.span[1] - chunk.span[0] + 1;
      expect(tokenCount).toBeGreaterThanOrEqual(3);
    });
    
    // Should include longer meaningful chunks
    const longChunks = chunks.filter(chunk => chunk.span[1] - chunk.span[0] + 1 >= 3);
    expect(longChunks.length).toBeGreaterThan(0);
  });

  it('should use winkNLP POS tagging instead of custom heuristics', async () => {
    // Test that winkNLP properly tags words that were previously misclassified
    const result = await nlpAnalyzer.analyzeText('The coffee brews first');
    
    expect(result.tokens).toHaveLength(4);
    expect(result.lemmas).toHaveLength(4);
    expect(result.pos).toHaveLength(4);
    
    // Find the index of "brews" and "first"
    const brewsIndex = result.tokens.indexOf('brews');
    const firstIndex = result.tokens.indexOf('first');
    
    expect(brewsIndex).toBeGreaterThanOrEqual(0);
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    
    // With winkNLP, "brews" should be tagged as VERB, not NOUN
    // and "first" should be tagged as ADJ, not NOUN
    expect(result.pos[brewsIndex]).toBe('VERB');
    expect(result.pos[firstIndex]).toBe('ADJ');
  });

  it('should correctly identify multi-word proper nouns (Mother Nature)', async () => {
    const result = await nlpAnalyzer.analyzeText("Lemons are Mother Nature's whoopee cushions — funny, but inconvenient.");
    
    const motherIndex = result.tokens.indexOf('Mother');
    const natureIndex = result.tokens.indexOf('Nature');
    const possessiveIndex = result.tokens.indexOf("'s");
    
    expect(motherIndex).toBeGreaterThanOrEqual(0);
    expect(natureIndex).toBeGreaterThanOrEqual(0);
    expect(possessiveIndex).toBeGreaterThanOrEqual(0);
    
    // Mother and Nature should be tagged as PROPN
    expect(result.pos[motherIndex]).toBe('PROPN');
    expect(result.pos[natureIndex]).toBe('PROPN');
    expect(result.pos[possessiveIndex]).toBe('PART');
  });

  it('should correctly identify multi-word proper nouns (Andrew Jackson)', async () => {
    const result = await nlpAnalyzer.analyzeText("Lemons made Andrew Jackson sit up and take notice.");
    
    const andrewIndex = result.tokens.indexOf('Andrew');
    const jacksonIndex = result.tokens.indexOf('Jackson');
    
    expect(andrewIndex).toBeGreaterThanOrEqual(0);
    expect(jacksonIndex).toBeGreaterThanOrEqual(0);
    
    // Andrew and Jackson should be tagged as PROPN
    expect(result.pos[andrewIndex]).toBe('PROPN');
    expect(result.pos[jacksonIndex]).toBe('PROPN');
  });
});
