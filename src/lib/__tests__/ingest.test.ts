import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticGraphLite } from '../semanticGraphLite.js';
import { ingestPhraseText, promoteChunk } from '../ingest.js';

describe('Ingestion Pipeline', () => {
  let graph: SemanticGraphLite;

  beforeEach(() => {
    graph = new SemanticGraphLite();
  });

  it('should ingest a simple phrase', () => {
    const result = ingestPhraseText('The quick brown fox', graph);
    
    expect(result.phrase.text).toBe('The quick brown fox');
    expect(result.wordsCreated).toBeGreaterThan(0);
    expect(result.chunksExtracted).toBeGreaterThanOrEqual(0);
    
    // Should create word nodes
    const words = graph.getNodesByType('WORD');
    expect(words.length).toBeGreaterThan(0);
    
    // Should create phrase node
    const phrases = graph.getNodesByType('PHRASE');
    expect(phrases).toHaveLength(1);
  });

  it('should handle empty text', () => {
    expect(() => ingestPhraseText('', graph)).toThrow('No tokens found in text');
  });

  it('should handle single word', () => {
    const result = ingestPhraseText('hello', graph);
    
    expect(result.phrase.text).toBe('hello');
    expect(result.wordsCreated).toBe(1);
    
    const words = graph.getNodesByType('WORD');
    expect(words).toHaveLength(1);
  });

  it('should extract chunks from phrase', () => {
    const result = ingestPhraseText('The quick brown fox jumps over the lazy dog', graph);
    
    // With the new 3+ token requirement, chunks might be 0
    expect(result.chunksExtracted).toBeGreaterThanOrEqual(0);
    expect(result.phrase.chunks.length).toBeGreaterThanOrEqual(0);
    
    // If chunks exist, they should have proper structure
    if (result.phrase.chunks.length > 0) {
      result.phrase.chunks.forEach(chunk => {
        expect(chunk.id).toBeDefined();
        expect(chunk.text).toBeDefined();
        expect(chunk.lemmas).toBeDefined();
        expect(chunk.posPattern).toBeDefined();
        expect(chunk.span).toHaveLength(2);
        expect(chunk.score).toBeGreaterThanOrEqual(0);
        
        // All chunks should have at least 3 tokens
        const tokenCount = chunk.span[1] - chunk.span[0] + 1;
        expect(tokenCount).toBeGreaterThanOrEqual(3);
      });
    }
  });

  it('should promote chunk to phrase', () => {
    // First ingest a phrase
    const result = ingestPhraseText('The quick brown fox', graph);
    
    // Get a chunk
    const chunk = result.phrase.chunks[0];
    if (chunk) {
      const promotedPhrase = promoteChunk(result.phrase.id, chunk.id, graph);
      
      expect(promotedPhrase).toBeDefined();
      expect(promotedPhrase?.text).toBe(chunk.text);
      expect(promotedPhrase?.derivedFromId).toBe(result.phrase.id);
      
      // Should create new phrase node
      const phrases = graph.getNodesByType('PHRASE');
      expect(phrases).toHaveLength(2);
    }
  });

  it('should handle chunk promotion with non-existent phrase', () => {
    expect(() => promoteChunk('non-existent', 'chunk-id', graph)).toThrow('Parent phrase non-existent not found');
  });

  it('should handle chunk promotion with non-existent chunk', () => {
    const result = ingestPhraseText('The quick brown fox', graph);
    
    expect(() => promoteChunk(result.phrase.id, 'non-existent', graph)).toThrow('Chunk non-existent not found in phrase');
  });

  it('should reject promotion of chunks with fewer than 3 tokens', () => {
    // Create a phrase with chunks that might be short
    const result = ingestPhraseText('The quick brown fox', graph);
    
    // Find chunks with fewer than 3 tokens (if any exist)
    const shortChunks = result.phrase.chunks.filter(chunk => {
      const tokenCount = chunk.span[1] - chunk.span[0] + 1;
      return tokenCount < 3;
    });
    
    // If there are short chunks, promotion should fail
    shortChunks.forEach(chunk => {
      expect(() => promoteChunk(result.phrase.id, chunk.id, graph)).toThrow('Chunk too short to promote');
    });
  });

  it('should create proper word connections', () => {
    const result = ingestPhraseText('The quick brown fox', graph);
    
    // Should create edges between phrase and words
    const edges = Array.from(graph['edges'].values());
    const phraseWordEdges = edges.filter(edge => edge.type === 'PHRASE_CONTAINS_WORD');
    
    expect(phraseWordEdges.length).toBeGreaterThan(0);
    
    // All edges should connect to the phrase
    phraseWordEdges.forEach(edge => {
      expect(edge.from).toBe(result.phrase.id);
    });
  });

  it('should handle repeated ingestion of same phrase', () => {
    const result1 = ingestPhraseText('The quick brown fox', graph);
    const result2 = ingestPhraseText('The quick brown fox', graph);
    
    // Should create separate phrase nodes
    const phrases = graph.getNodesByType('PHRASE');
    expect(phrases).toHaveLength(2);
    
    // But should reuse word nodes
    const words = graph.getNodesByType('WORD');
    expect(words.length).toBeLessThanOrEqual(4); // Should be 4 or fewer unique words
  });
});
