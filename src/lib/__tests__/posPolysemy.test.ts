import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticGraphLite } from '../semanticGraphLite.js';
import { analyzePotentialPOS, getPOSGuessSources } from '../posHeuristics.js';

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
      expect(word.isPolysemousPOS).toBe(false); // Starts as false until we have observed evidence
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
      expect(word1.isPolysemousPOS).toBe(false); // Only one observed POS

      // Second occurrence as VERB
      const word2 = graph.upsertWord('water', 'water', [], 'VERB');
      expect(word2.posObserved).toEqual({ 'NOUN': 1, 'VERB': 1 });
      expect(word2.primaryPOS).toBe('NOUN'); // Still NOUN as primary
      expect(word2.isPolysemousPOS).toBe(false); // Not enough evidence yet

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

    it('should not detect polysemy when secondary POS lacks sufficient evidence', () => {
      // Create word with multiple potential POS
      const word = graph.upsertWord('book', 'book', ['NOUN', 'VERB']);
      
      // Add 5 NOUN occurrences
      for (let i = 0; i < 5; i++) {
        graph.upsertWord('book', 'book', [], 'NOUN');
      }
      
      // Add only 1 VERB occurrence (less than 2 required)
      graph.upsertWord('book', 'book', [], 'VERB');
      
      const finalWord = graph.findWordByLemma('book')!;
      expect(finalWord.posObserved).toEqual({ 'NOUN': 5, 'VERB': 1 });
      expect(finalWord.primaryPOS).toBe('NOUN');
      expect(finalWord.isPolysemousPOS).toBe(false); // VERB count < 2
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

  describe('POS Heuristics', () => {
    it('should analyze potential POS from word suffixes', () => {
      const nounPOS = analyzePotentialPOS('creation');
      expect(nounPOS).toContain('NOUN');
      
      const verbPOS = analyzePotentialPOS('create');
      expect(verbPOS).toContain('VERB');
      
      const adjPOS = analyzePotentialPOS('creative');
      expect(adjPOS).toContain('ADJ');
      
      const advPOS = analyzePotentialPOS('creatively');
      expect(advPOS).toContain('ADV');
    });

    it('should detect proper nouns from capitalization', () => {
      const properNounPOS = analyzePotentialPOS('London');
      expect(properNounPOS).toContain('NOUN');
      
      const acronymPOS = analyzePotentialPOS('NASA');
      expect(acronymPOS).toContain('NOUN');
    });

    it('should identify common function words', () => {
      const detPOS = analyzePotentialPOS('the');
      expect(detPOS).toContain('DET');
      
      const prepPOS = analyzePotentialPOS('in');
      expect(prepPOS).toContain('ADP');
      
      const auxPOS = analyzePotentialPOS('is');
      expect(auxPOS).toContain('AUX');
    });

    it('should combine winkNLP POS with heuristics', () => {
      const combinedPOS = analyzePotentialPOS('water', 'NOUN');
      expect(combinedPOS).toContain('NOUN');
      expect(combinedPOS).toContain('VERB'); // From suffix analysis
    });

    it('should return sources for POS guesses', () => {
      const sources = getPOSGuessSources('water', 'NOUN');
      expect(sources).toContain('wink');
      expect(sources).toContain('suffix');
      
      const sourcesNoWink = getPOSGuessSources('water');
      expect(sourcesNoWink).toContain('suffix');
      expect(sourcesNoWink).not.toContain('wink');
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
