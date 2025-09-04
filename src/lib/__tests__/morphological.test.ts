import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticGraphLite } from '../semanticGraphLite.js';
import { ingestPhraseText } from '../ingest.js';

describe('Morphological Features', () => {
  let graph: SemanticGraphLite;

  beforeEach(() => {
    graph = new SemanticGraphLite();
  });

  it('should store morphological features for verbs', async () => {
    // Test with a phrase containing different verb forms
    const result = await ingestPhraseText('cat eating mouse', graph);
    
    // Get the word nodes
    const words = graph.getNodesByType('WORD');
    const eatingWord = words.find(w => w.type === 'WORD' && (w as any).lemma === 'eat');
    
    expect(eatingWord).toBeDefined();
    expect((eatingWord as any).morphFeature).toBe('participle');
    expect((eatingWord as any).originalForm).toBe('eating');
  });

  it('should store morphological features for past tense verbs', async () => {
    const result = await ingestPhraseText('cat ate mouse', graph);
    
    const words = graph.getNodesByType('WORD');
    const ateWord = words.find(w => w.type === 'WORD' && (w as any).lemma === 'eat');
    
    expect(ateWord).toBeDefined();
    expect((ateWord as any).morphFeature).toBe('past');
    expect((ateWord as any).originalForm).toBe('ate');
  });

  it('should store morphological features for adjectives', async () => {
    const result = await ingestPhraseText('bigger cat', graph);
    
    const words = graph.getNodesByType('WORD');
    const biggerWord = words.find(w => w.type === 'WORD' && (w as any).lemma === 'big');
    
    expect(biggerWord).toBeDefined();
    expect((biggerWord as any).morphFeature).toBe('comparative');
    expect((biggerWord as any).originalForm).toBe('bigger');
  });

  it('should handle multiple morphological forms of the same word', async () => {
    // First ingest with participle form
    await ingestPhraseText('cat eating mouse', graph);
    
    // Then ingest with past tense form
    await ingestPhraseText('cat ate mouse', graph);
    
    const words = graph.getNodesByType('WORD');
    const eatWords = words.filter(w => w.type === 'WORD' && (w as any).lemma === 'eat');
    
    // Should have two different word nodes for the same lemma with different morphological features
    expect(eatWords).toHaveLength(2);
    
    const participleWord = eatWords.find(w => (w as any).morphFeature === 'participle');
    const pastWord = eatWords.find(w => (w as any).morphFeature === 'past');
    
    expect(participleWord).toBeDefined();
    expect(pastWord).toBeDefined();
    expect((participleWord as any).originalForm).toBe('eating');
    expect((pastWord as any).originalForm).toBe('ate');
  });
});
