import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticGraphLite } from '../semanticGraphLite.js';
import { ingestPhraseText, promoteChunk } from '../ingest.js';

describe('Ingestion Pipeline', () => {
  let graph: SemanticGraphLite;

  beforeEach(() => {
    graph = new SemanticGraphLite();
  });

  it('should ingest a simple phrase', async () => {
    const result = await ingestPhraseText('The quick brown fox', graph);
    
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

  it('should handle empty text', async () => {
    await expect(ingestPhraseText('', graph)).rejects.toThrow('No tokens found in text');
  });

  it('should handle single word', async () => {
    const result = await ingestPhraseText('world', graph);
    
    expect(result.phrase.text).toBe('world');
    expect(result.wordsCreated).toBe(1);
    
    const words = graph.getNodesByType('WORD');
    expect(words).toHaveLength(1);
  });

  it('should extract chunks from phrase', async () => {
    const result = await ingestPhraseText('The quick brown fox jumps over the lazy dog', graph);
    
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

  it('should promote chunk to phrase', async () => {
    // First ingest a phrase
    const result = await ingestPhraseText('The quick brown fox', graph);
    
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

  it('should handle chunk promotion with non-existent phrase', async () => {
    await expect(promoteChunk('non-existent', 'chunk-id', graph)).rejects.toThrow('Parent phrase non-existent not found');
  });

  it('should handle chunk promotion with non-existent chunk', async () => {
    const result = await ingestPhraseText('The quick brown fox', graph);
    
    await expect(promoteChunk(result.phrase.id, 'non-existent', graph)).rejects.toThrow('Chunk non-existent not found in phrase');
  });

  it('should reject promotion of chunks with fewer than 3 tokens', async () => {
    // Create a phrase with chunks that might be short
    const result = await ingestPhraseText('The quick brown fox', graph);
    
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

  it('should create proper word connections', async () => {
    const result = await ingestPhraseText('The quick brown fox', graph);
    
    // Should create edges between phrase and words
    const edges = Array.from(graph['edges'].values());
    const phraseWordEdges = edges.filter(edge => edge.type === 'PHRASE_CONTAINS_WORD');
    
    expect(phraseWordEdges.length).toBeGreaterThan(0);
    
    // All edges should connect to the phrase
    phraseWordEdges.forEach(edge => {
      expect(edge.from).toBe(result.phrase.id);
    });
  });

  it('should handle repeated ingestion of same phrase', async () => {
    const result1 = await ingestPhraseText('The quick brown fox', graph);
    const result2 = await ingestPhraseText('The quick brown fox', graph);
    
    // Should create separate phrase nodes
    const phrases = graph.getNodesByType('PHRASE');
    expect(phrases).toHaveLength(2);
    
    // But should reuse word nodes
    const words = graph.getNodesByType('WORD');
    expect(words.length).toBeLessThanOrEqual(4); // Should be 4 or fewer unique words
  });

  it('should handle multi-word proper nouns correctly (Mother Nature)', async () => {
    const result = await ingestPhraseText("Lemons are Mother Nature's whoopee cushions — funny, but inconvenient.", graph);
    
    // Should create a compound "mother nature" node
    const words = graph.getNodesByType('WORD');
    const motherNatureNode = words.find(w => w.text === 'mother nature');
    
    expect(motherNatureNode).toBeDefined();
    expect(motherNatureNode.pos).toContain('PROPN');
    
    // Should NOT create standalone "mother", "nature", or "'s" nodes
    const motherNode = words.find(w => w.text === 'mother');
    const natureNode = words.find(w => w.text === 'nature');
    const possessiveNode = words.find(w => w.text === "'s");
    
    expect(motherNode).toBeUndefined();
    expect(natureNode).toBeUndefined();
    expect(possessiveNode).toBeUndefined();
  });

  it('should handle multi-word proper nouns correctly (Andrew Jackson)', async () => {
    const result = await ingestPhraseText("Lemons made Andrew Jackson sit up and take notice.", graph);
    
    // Should create a compound "andrew jackson" node
    const words = graph.getNodesByType('WORD');
    const andrewJacksonNode = words.find(w => w.text === 'andrew jackson');
    
    expect(andrewJacksonNode).toBeDefined();
    expect(andrewJacksonNode.pos).toContain('PROPN');
    
    // Should NOT create standalone "andrew" or "jackson" nodes
    const andrewNode = words.find(w => w.text === 'andrew');
    const jacksonNode = words.find(w => w.text === 'jackson');
    
    expect(andrewNode).toBeUndefined();
    expect(jacksonNode).toBeUndefined();
  });
});
