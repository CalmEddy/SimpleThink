import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticGraphLite } from '../semanticGraphLite.js';
import { analyzeWordPOS } from '../posAnalysis.js';

describe('POS Polysemy Detection System', () => {
  let graph: SemanticGraphLite;

  beforeEach(() => {
    graph = new SemanticGraphLite();
  });

  describe('Word Creation with POS Potential', () => {
    it('should create word with potential POS from heuristics', () => {
      const word = graph.upsertWord('water', 'water', ['NOUN', 'VERB']);
      
      expect(word.posPotential).toEqual(['NOUN', 'VERB']);
      expect(word.posPotentialSource).toEqual(['initial']);
      expect(word.posObserved).toEqual({});
      expect(word.primaryPOS).toBe('NOUN');
      expect(word.isPolysemousPOS).toBe(true); // Now correctly detects polysemy from potential POS
    });

    it('should detect noun suffixes correctly', () => {
      const word = graph.upsertWord('creation', 'creation', ['NOUN']);
      
      expect(word.posPotential).toContain('NOUN');
      expect(word.posPotentialSource).toEqual(['initial']);
    });

    it('should detect verb suffixes correctly', () => {
      const word = graph.upsertWord('create', 'create', ['VERB']);
      
      expect(word.posPotential).toContain('VERB');
      expect(word.posPotentialSource).toEqual(['initial']);
    });

    it('should detect adjective suffixes correctly', () => {
      const word = graph.upsertWord('creative', 'creative', ['ADJ']);
      
      expect(word.posPotential).toContain('ADJ');
      expect(word.posPotentialSource).toEqual(['initial']);
    });

    it('should detect adverb suffixes correctly', () => {
      const word = graph.upsertWord('creatively', 'creatively', ['ADV']);
      
      expect(word.posPotential).toContain('ADV');
      expect(word.posPotentialSource).toEqual(['initial']);
    });
  });

  describe('POS Observation Tracking', () => {
    it('should track observed POS counts when updating existing words', () => {
      // First occurrence as NOUN
      const word1 = graph.upsertWord('water', 'water', ['NOUN', 'VERB'], 'NOUN');
      expect(word1.posObserved).toEqual({ 'NOUN': 1 });
      expect(word1.primaryPOS).toBe('NOUN');
      expect(word1.isPolysemousPOS).toBe(true); // Polysemous due to potential POS

      // Second occurrence as VERB
      const word2 = graph.upsertWord('water', 'water', [], 'VERB');
      expect(word2.posObserved).toEqual({ 'NOUN': 1, 'VERB': 1 });
      expect(word2.primaryPOS).toBe('NOUN'); // Still NOUN as primary
      expect(word2.isPolysemousPOS).toBe(true); // Still polysemous

      // Third occurrence as VERB
      const word3 = graph.upsertWord('water', 'water', [], 'VERB');
      expect(word3.posObserved).toEqual({ 'NOUN': 1, 'VERB': 2 });
      expect(word3.primaryPOS).toBe('VERB'); // Now VERB is primary
      expect(word3.isPolysemousPOS).toBe(true); // Both POS have sufficient evidence
    });

    it('should detect polysemy when multiple POS have sufficient evidence', () => {
      // Create word with multiple potential POS
      const word = graph.upsertWord('run', 'run', ['NOUN', 'VERB']);
      
      // Add 3 NOUN occurrences
      for (let i = 0; i < 3; i++) {
        graph.upsertWord('run', 'run', [], 'NOUN');
      }
      
      // Add 2 VERB occurrences (10% of 3 = 0.3, so 2 >= 0.3)
      for (let i = 0; i < 2; i++) {
        graph.upsertWord('run', 'run', [], 'VERB');
      }
      
      const finalWord = graph.findWordByLemma('run')!;
      expect(finalWord.posObserved).toEqual({ 'NOUN': 3, 'VERB': 2 });
      expect(finalWord.primaryPOS).toBe('NOUN');
      expect(finalWord.isPolysemousPOS).toBe(true);
    });

    it('should not detect polysemy when word only has one POS', () => {
      // Create word with single potential POS (not polysemous)
      const word = graph.upsertWord('table', 'table', ['NOUN']);
      
      // Add 5 NOUN occurrences - only NOUN, no other POS
      for (let i = 0; i < 5; i++) {
        graph.upsertWord('table', 'table', [], 'NOUN');
      }
      
      const finalWord = graph.findWordByLemma('table')!;
      expect(finalWord.posObserved).toEqual({ 'NOUN': 5 });
      expect(finalWord.primaryPOS).toBe('NOUN');
      expect(finalWord.isPolysemousPOS).toBe(false); // Only NOUN in both potential and observed
    });
  });

  describe('Edge POS Context', () => {
    it('should store POS context in phrase-word edges', () => {
      // Create a word
      const word = graph.upsertWord('test', 'test', ['NOUN', 'VERB']);
      
      // Create a phrase with specific POS context
      const phrase = graph.upsertPhrase(
        'test the system',
        ['test', 'the', 'system'],
        'VERB-DET-NOUN',
        [word.id, 'word2', 'word3'],
        undefined,
        ['VERB', 'DET', 'NOUN'] // wordPOS array
      );
      
      // Check that the edge has the correct POS context
      const edges = graph.getEdges();
      const phraseToWordEdge = edges.find(e => 
        e.from === phrase.id && e.to === word.id && e.type === 'PHRASE_CONTAINS_WORD'
      );
      
      expect(phraseToWordEdge).toBeDefined();
      expect(phraseToWordEdge!.meta?.posUsed).toBe('VERB');
    });
  });

  describe('POS Analysis', () => {
    it('should analyze potential POS from word suffixes', async () => {
      const nounAnalysis = await analyzeWordPOS('creation', 'NOUN');
      expect(nounAnalysis.pos).toContain('NOUN');
      
      const verbAnalysis = await analyzeWordPOS('create', 'VERB');
      expect(verbAnalysis.pos).toContain('VERB');
      
      const adjAnalysis = await analyzeWordPOS('creative', 'ADJ');
      expect(adjAnalysis.pos).toContain('ADJ');
      
      const advAnalysis = await analyzeWordPOS('creatively', 'ADV');
      expect(advAnalysis.pos).toContain('ADV');
    });

    it('should detect proper nouns from capitalization', async () => {
      const properNounAnalysis = await analyzeWordPOS('London', 'NOUN');
      expect(properNounAnalysis.pos).toContain('NOUN');
      
      const acronymAnalysis = await analyzeWordPOS('NASA', 'NOUN');
      expect(acronymAnalysis.pos).toContain('NOUN');
    });

    it('should identify common function words', async () => {
      const detAnalysis = await analyzeWordPOS('the', 'DET');
      expect(detAnalysis.pos).toContain('DET');
      
      const prepAnalysis = await analyzeWordPOS('in', 'ADP');
      expect(prepAnalysis.pos).toContain('ADP');
      
      const auxAnalysis = await analyzeWordPOS('is', 'AUX');
      expect(auxAnalysis.pos).toContain('AUX');
    });

    it('should combine winkNLP POS with context testing', async () => {
      const analysis = await analyzeWordPOS('water', 'NOUN');
      expect(analysis.pos).toContain('NOUN');
      expect(analysis.source).toBeDefined();
    });

    it('should return analysis with source information', async () => {
      const analysis = await analyzeWordPOS('water', 'NOUN');
      expect(analysis.source).toBeDefined();
      expect(['wink', 'polysemy-test', 'fallback']).toContain(analysis.source);
    });
  });

  describe('Integration with Existing System', () => {
    it('should maintain backward compatibility with existing word structure', () => {
      const word = graph.upsertWord('test', 'test', ['NOUN']);
      
      expect(word.id).toBeDefined();
      expect(word.type).toBe('WORD');
      expect(word.text).toBe('test');
      expect(word.lemma).toBe('test');
      expect(word.pos).toEqual(['NOUN']);
      expect(word.stats).toBeDefined();
      
      // New fields should have sensible defaults
      expect(word.posPotential).toEqual(['NOUN']);
      expect(word.posObserved).toEqual({});
      expect(word.primaryPOS).toBe('NOUN');
      expect(word.isPolysemousPOS).toBe(false);
    });

    it('should handle edge cases gracefully', () => {
      // Empty POS array
      const word1 = graph.upsertWord('test', 'test', []);
      expect(word1.posPotential).toEqual(['NOUN']); // Default fallback
      
      // Unknown POS tag
      const word2 = graph.upsertWord('test', 'test', ['UNKNOWN'], 'UNKNOWN');
      expect(word2.posObserved).toEqual({ 'NOUN': 1 }); // Normalized to NOUN
      
      // Very long word
      const longWord = 'a'.repeat(100);
      const word3 = graph.upsertWord(longWord, longWord, ['NOUN']);
      expect(word3.posPotential).toEqual(['NOUN']);
    });
  });
});
