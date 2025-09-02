import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticGraphLite } from '../semanticGraphLite.js';

describe('SemanticGraphLite', () => {
  let graph: SemanticGraphLite;

  beforeEach(() => {
    graph = new SemanticGraphLite();
  });

  it('should create a new graph', () => {
    expect(graph.getNodeCount()).toBe(0);
    expect(graph.getEdgeCount()).toBe(0);
  });

  it('should upsert words correctly', () => {
    const word1 = graph.upsertWord('fox', 'fox', ['NOUN']);
    const word2 = graph.upsertWord('foxes', 'fox', ['NOUN']);
    
    expect(word1.id).toBe(word2.id); // Should be the same word
    expect(word1.lemma).toBe('fox');
    expect(word1.pos).toContain('NOUN');
  });

  it('should upsert phrases correctly', () => {
    const word1 = graph.upsertWord('quick', 'quick', ['ADJ']);
    const word2 = graph.upsertWord('fox', 'fox', ['NOUN']);
    
    const phrase = graph.upsertPhrase(
      'quick fox',
      ['quick', 'fox'],
      'ADJ-NOUN',
      [word1.id, word2.id]
    );
    
    expect(phrase.text).toBe('quick fox');
    expect(phrase.lemmas).toEqual(['quick', 'fox']);
    expect(phrase.posPattern).toBe('ADJ-NOUN');
    expect(phrase.wordIds).toHaveLength(2);
  });

  it('should add edges correctly', () => {
    const word = graph.upsertWord('fox', 'fox', ['NOUN']);
    const phrase = graph.upsertPhrase('fox', ['fox'], 'NOUN', [word.id]);
    
    const edges = Array.from(graph['edges'].values());
    expect(edges).toHaveLength(1);
    expect(edges[0].type).toBe('PHRASE_CONTAINS_WORD');
    expect(edges[0].from).toBe(phrase.id);
    expect(edges[0].to).toBe(word.id);
  });

  it('should record prompts correctly', () => {
    const word = graph.upsertWord('fox', 'fox', ['NOUN']);
    
    const prompt = graph.recordPrompt(
      'NVN',
      '[NOUN] [VERB] [NOUN]',
      [{ slot: 'NOUN', fillerNodeId: word.id }]
    );
    
    expect(prompt.templateId).toBe('NVN');
    expect(prompt.templateText).toBe('[NOUN] [VERB] [NOUN]');
    expect(prompt.bindings).toHaveLength(1);
  });

  it('should record responses correctly', () => {
    const word = graph.upsertWord('fox', 'fox', ['NOUN']);
    const prompt = graph.recordPrompt('NVN', '[NOUN] [VERB] [NOUN]', []);
    
    const response = graph.recordResponse(
      prompt.id,
      'fox runs',
      ['fox', 'runs'],
      'NOUN-VERB',
      [word.id],
      'like'
    );
    
    expect(response.text).toBe('fox runs');
    expect(response.promptId).toBe(prompt.id);
    expect(response.rating).toBe('like');
  });

  it('should get word neighbors correctly', () => {
    const word = graph.upsertWord('fox', 'fox', ['NOUN']);
    const phrase1 = graph.upsertPhrase('quick fox', ['quick', 'fox'], 'ADJ-NOUN', [word.id]);
    const phrase2 = graph.upsertPhrase('red fox', ['red', 'fox'], 'ADJ-NOUN', [word.id]);
    
    const neighbors = graph.getWordNeighbors(word.id);
    expect(neighbors).toHaveLength(2);
    expect(neighbors.map(p => p.id)).toContain(phrase1.id);
    expect(neighbors.map(p => p.id)).toContain(phrase2.id);
  });

  it('should get phrases by word lemma correctly', () => {
    const word = graph.upsertWord('fox', 'fox', ['NOUN']);
    const phrase1 = graph.upsertPhrase('quick fox', ['quick', 'fox'], 'ADJ-NOUN', [word.id]);
    const phrase2 = graph.upsertPhrase('red fox', ['red', 'fox'], 'ADJ-NOUN', [word.id]);
    
    const phrases = graph.getPhrasesByWordLemma('fox');
    expect(phrases).toHaveLength(2);
    expect(phrases.map(p => p.id)).toContain(phrase1.id);
    expect(phrases.map(p => p.id)).toContain(phrase2.id);
  });

  it('should update stats correctly', () => {
    const word = graph.upsertWord('fox', 'fox', ['NOUN']);
    
    graph.likeNode(word.id);
    graph.useNode(word.id);
    
    const updatedWord = graph.getNodesByType('WORD')[0] as any;
    expect(updatedWord.stats?.likes).toBe(1);
    expect(updatedWord.stats?.uses).toBe(1);
  });

  it('should serialize and deserialize correctly', () => {
    const word = graph.upsertWord('fox', 'fox', ['NOUN']);
    const phrase = graph.upsertPhrase('quick fox', ['quick', 'fox'], 'ADJ-NOUN', [word.id]);
    
    const json = graph.toJSON();
    expect(json.nodes).toHaveLength(2);
    expect(json.edges).toHaveLength(1);
    expect(json.version).toBe(1);
    
    const newGraph = new SemanticGraphLite();
    newGraph.fromJSON(json);
    
    expect(newGraph.getNodeCount()).toBe(2);
    expect(newGraph.getEdgeCount()).toBe(1);
  });
});
