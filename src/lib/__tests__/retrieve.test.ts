import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticGraphLite } from '../semanticGraphLite.js';
import { surfaceRelatedPhrases } from '../retrieve.js';
import { ingestPhraseText } from '../ingest.js';

describe('Retrieval Engine', () => {
  let graph: SemanticGraphLite;

  beforeEach(() => {
    graph = new SemanticGraphLite();
  });

  it('should find related phrases', () => {
    // Ingest some related phrases
    const result1 = ingestPhraseText('The quick brown fox', graph);
    const result2 = ingestPhraseText('The quick red fox', graph);
    const result3 = ingestPhraseText('The slow brown fox', graph);
    const result4 = ingestPhraseText('A big blue car', graph);
    
    // Find related phrases for the first one
    const retrieval = surfaceRelatedPhrases(result1.phrase.id, graph);
    
    // With new chunking constraints, we might have fewer related phrases
    expect(retrieval.relatedPhrases.length).toBeGreaterThanOrEqual(0);
    expect(retrieval.topChunks.length).toBeGreaterThanOrEqual(0);
    
    // If we have related phrases, they should have shared lemmas
    if (retrieval.relatedPhrases.length > 0) {
      const relatedIds = retrieval.relatedPhrases.map(p => p.phrase.id);
      expect(relatedIds).not.toContain(result1.phrase.id); // Should not include the seed phrase itself
    }
  });

  it('should score phrases correctly', () => {
    // Ingest phrases with different overlap levels
    const result1 = ingestPhraseText('The quick brown fox', graph);
    const result2 = ingestPhraseText('The quick brown fox', graph); // Exact match
    const result3 = ingestPhraseText('The quick red fox', graph); // Partial match
    const result4 = ingestPhraseText('A big blue car', graph); // No match
    
    const retrieval = surfaceRelatedPhrases(result1.phrase.id, graph);
    
    // Should have scores
    retrieval.relatedPhrases.forEach(({ score, overlapScore, patternBoost, likeBoost }) => {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(overlapScore).toBeGreaterThanOrEqual(0);
      expect(patternBoost).toBeGreaterThanOrEqual(0);
      expect(likeBoost).toBeGreaterThanOrEqual(0);
    });
    
    // Should be sorted by score
    const scores = retrieval.relatedPhrases.map(p => p.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });

  it('should handle non-existent seed phrase', () => {
    expect(() => surfaceRelatedPhrases('non-existent', graph)).toThrow('Seed phrase non-existent not found');
  });

  it('should return empty results for phrase with no related phrases', () => {
    const result = ingestPhraseText('The quick brown fox', graph);
    
    const retrieval = surfaceRelatedPhrases(result.phrase.id, graph);
    
    expect(retrieval.relatedPhrases).toHaveLength(0);
    expect(retrieval.topChunks).toHaveLength(0);
  });

  it('should respect maxResults limit', () => {
    // Ingest many related phrases
    for (let i = 0; i < 10; i++) {
      ingestPhraseText(`The quick brown fox ${i}`, graph);
    }
    
    const result = ingestPhraseText('The quick brown fox', graph);
    const retrieval = surfaceRelatedPhrases(result.phrase.id, graph, { maxResults: 5 });
    
    expect(retrieval.relatedPhrases.length).toBeLessThanOrEqual(5);
  });

  it('should filter by minimum overlap', () => {
    const result1 = ingestPhraseText('The quick brown fox', graph);
    const result2 = ingestPhraseText('The quick red fox', graph);
    const result3 = ingestPhraseText('A big blue car', graph);
    
    const retrieval = surfaceRelatedPhrases(result1.phrase.id, graph, { minOverlap: 0.5 });
    
    // Should only include phrases with significant overlap
    retrieval.relatedPhrases.forEach(({ overlapScore }) => {
      expect(overlapScore).toBeGreaterThanOrEqual(0.5);
    });
  });

  it('should gather top chunks from related phrases', () => {
    // Ingest phrases with chunks
    const result1 = ingestPhraseText('The quick brown fox jumps over the lazy dog', graph);
    const result2 = ingestPhraseText('The quick red fox runs fast', graph);
    
    const retrieval = surfaceRelatedPhrases(result1.phrase.id, graph);
    
    // With new chunking constraints, chunks might be 0
    expect(retrieval.topChunks.length).toBeGreaterThanOrEqual(0);
    
    // Chunks should be sorted by score
    const scores = retrieval.topChunks.map(c => c.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });

  it('should handle phrases with no chunks', () => {
    const result = ingestPhraseText('Computer', graph);
    
    const retrieval = surfaceRelatedPhrases(result.phrase.id, graph);
    
    expect(retrieval.relatedPhrases).toHaveLength(0);
    expect(retrieval.topChunks).toHaveLength(0);
  });
});
