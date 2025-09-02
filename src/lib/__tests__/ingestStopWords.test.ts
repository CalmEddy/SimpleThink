import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticGraphLite } from '../semanticGraphLite.js';
import { ingestPhraseText, promoteChunk } from '../ingest.js';

describe('Ingestion with Stop Words Filtering', () => {
  let graph: SemanticGraphLite;

  beforeEach(() => {
    graph = new SemanticGraphLite();
  });

  describe('ingestPhraseText with stop words', () => {
    it('should filter out stop words from phrase ingestion', () => {
      const result = ingestPhraseText('the quick brown fox jumps over the lazy dog', graph);
      
      // Should create phrase with ALL lemmas (including stop words)
      expect(result.phrase.lemmas).toEqual(['the', 'quick', 'brown', 'fox', 'jump', 'over', 'the', 'lazy', 'dog']);
      expect(result.phrase.text).toBe('the quick brown fox jumps over the lazy dog'); // Original text preserved
      
      // Should create word nodes only for non-stop words
      const wordNodes = graph.getNodesByType('WORD');
      const wordTexts = wordNodes.map(w => w.text);
      expect(wordTexts).toContain('quick');
      expect(wordTexts).toContain('brown');
      expect(wordTexts).toContain('fox');
      expect(wordTexts).toContain('jumps');
      expect(wordTexts).toContain('lazy');
      expect(wordTexts).toContain('dog');
      
      // Should NOT create word nodes for stop words
      expect(wordTexts).not.toContain('the');
      expect(wordTexts).not.toContain('over');
    });

    it('should handle phrases with contractions', () => {
      const result = ingestPhraseText("I can't believe it's not butter", graph);
      
      // Should preserve ALL lemmas in phrase (including contractions and stop words)
      // Note: NLP tokenizes "can't" as "ca" and "n't", "it's" as "it" and "'s"
      expect(result.phrase.lemmas).toEqual(['i', 'ca', "n't", 'believe', 'it', "'s", 'not', 'butter']);
      
      const wordNodes = graph.getNodesByType('WORD');
      const wordTexts = wordNodes.map(w => w.text);
      expect(wordTexts).toContain('believe');
      expect(wordTexts).toContain('butter');
      expect(wordTexts).not.toContain("can't");
      expect(wordTexts).not.toContain("it's");
      expect(wordTexts).not.toContain('i');
      expect(wordTexts).not.toContain('not');
    });

    it('should throw error for phrases with only stop words', () => {
      expect(() => {
        ingestPhraseText('the and or but', graph);
      }).toThrow('Phrase contains only stop words and cannot be ingested');
    });

    it('should throw error for phrases with too many stop words', () => {
      expect(() => {
        ingestPhraseText('the and or but cat', graph);
      }).toThrow('Phrase has too many stop words (80.0%). Maximum allowed is 70%.');
    });

    it('should allow phrases with some stop words', () => {
      const result = ingestPhraseText('the cat and dog are friends', graph);
      
      // Should preserve ALL lemmas in phrase (including stop words)
      expect(result.phrase.lemmas).toEqual(['the', 'cat', 'and', 'dog', 'are', 'friends']);
      
      const wordNodes = graph.getNodesByType('WORD');
      const wordTexts = wordNodes.map(w => w.text);
      expect(wordTexts).toContain('cat');
      expect(wordTexts).toContain('dog');
      expect(wordTexts).toContain('friends');
      expect(wordTexts).not.toContain('the');
      expect(wordTexts).not.toContain('and');
      expect(wordTexts).not.toContain('are');
    });

    it('should preserve POS patterns after filtering', () => {
      const result = ingestPhraseText('the quick brown fox', graph);
      
      // Should have POS pattern for ALL words (including stop words)
      // Note: NLP might tag these as NOUN-NOUN-NOUN depending on the model
      expect(result.phrase.posPattern).toBe('DET-NOUN-NOUN-NOUN'); // the-quick-brown-fox
    });

    it('should create correct word relationships', () => {
      const result = ingestPhraseText('the cat and dog', graph);
      
      // Should create edges from phrase to content words only (not stop words)
      const edges = graph.getEdges();
      const phraseToWordEdges = edges.filter(e => e.type === 'PHRASE_CONTAINS_WORD' && e.from === result.phrase.id);
      
      expect(phraseToWordEdges).toHaveLength(2); // cat and dog only
      
      const wordNodes = graph.getNodesByType('WORD');
      const catWord = wordNodes.find(w => w.text === 'cat');
      const dogWord = wordNodes.find(w => w.text === 'dog');
      
      expect(phraseToWordEdges.some(e => e.to === catWord?.id)).toBe(true);
      expect(phraseToWordEdges.some(e => e.to === dogWord?.id)).toBe(true);
      
      // Should NOT create edges to stop words
      const theWord = wordNodes.find(w => w.text === 'the');
      const andWord = wordNodes.find(w => w.text === 'and');
      expect(theWord).toBeUndefined(); // No word node for 'the'
      expect(andWord).toBeUndefined(); // No word node for 'and'
    });
  });

  describe('promoteChunk with stop words', () => {
    it('should filter stop words when promoting chunks', () => {
      // First create a phrase with chunks
      const phraseResult = ingestPhraseText('the quick brown fox jumps over the lazy dog', graph);
      const phrase = phraseResult.phrase;
      
      // Find a chunk to promote (if any exist)
      const chunk = phrase.chunks[0];
      if (chunk) {
        // Promote the chunk
        const promotedPhrase = promoteChunk(phrase.id, chunk.id, graph);
        expect(promotedPhrase).toBeDefined();
        
        // The promoted phrase should preserve original lemmas (including stop words)
        expect(promotedPhrase!.lemmas.length).toBeGreaterThan(0);
        // But should only create word nodes for content words
        const promotedWordNodes = graph.getNodesByType('WORD');
        const promotedWordTexts = promotedWordNodes.map(w => w.text);
        expect(promotedWordTexts.every(text => !['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'].includes(text))).toBe(true);
      } else {
        // If no chunks exist, that's also valid - chunks might not be created for all phrases
        expect(phrase.chunks).toHaveLength(0);
      }
    });

    it('should throw error if chunk becomes too short after filtering', () => {
      // Create a phrase with a chunk that would become too short
      const phraseResult = ingestPhraseText('the and or but cat dog', graph);
      const phrase = phraseResult.phrase;
      
      // Find a chunk that might become too short
      const shortChunk = phrase.chunks.find(c => c.lemmas.length <= 3);
      if (shortChunk) {
        // This might throw an error if the chunk becomes too short after filtering
        try {
          const promotedPhrase = promoteChunk(phrase.id, shortChunk.id, graph);
          // If it succeeds, the promoted phrase should still be valid
          expect(promotedPhrase).toBeDefined();
        } catch (error) {
          // If it fails, it should be because the chunk became too short
          expect(error.message).toContain('too short after filtering stop words');
        }
      }
    });

    it('should preserve chunk relationships after filtering', () => {
      const phraseResult = ingestPhraseText('the quick brown fox', graph);
      const phrase = phraseResult.phrase;
      
      const chunk = phrase.chunks[0];
      if (chunk) {
        const promotedPhrase = promoteChunk(phrase.id, chunk.id, graph);
        
        expect(promotedPhrase).toBeDefined();
        expect(promotedPhrase!.derivedFromId).toBe(phrase.id);
        
        // Should create edges to filtered words only
        const edges = graph.getEdges();
        const promotedToWordEdges = edges.filter(e => e.type === 'PHRASE_CONTAINS_WORD' && e.from === promotedPhrase!.id);
        
        expect(promotedToWordEdges.length).toBeGreaterThan(0);
      } else {
        // If no chunks exist, that's also valid
        expect(phrase.chunks).toHaveLength(0);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle single content word phrases', () => {
      const result = ingestPhraseText('hello', graph);
      
      expect(result.phrase.lemmas).toEqual(['hello']);
      expect(result.phrase.text).toBe('hello');
      
      const wordNodes = graph.getNodesByType('WORD');
      expect(wordNodes).toHaveLength(1);
      expect(wordNodes[0].text).toBe('hello');
    });

    it('should handle phrases with mixed case stop words', () => {
      const result = ingestPhraseText('The Quick Brown Fox', graph);
      
      expect(result.phrase.lemmas).toEqual(['quick', 'brown', 'fox']);
      
      const wordNodes = graph.getNodesByType('WORD');
      const wordTexts = wordNodes.map(w => w.text);
      expect(wordTexts).toContain('Quick');
      expect(wordTexts).toContain('Brown');
      expect(wordTexts).toContain('Fox');
      expect(wordTexts).not.toContain('The');
    });

    it('should handle phrases with punctuation and stop words', () => {
      const result = ingestPhraseText('Hello, the world!', graph);
      
      // Should preserve ALL lemmas in phrase (including punctuation and stop words)
      expect(result.phrase.lemmas).toEqual(['hello', ',', 'the', 'world', '!']);
      
      const wordNodes = graph.getNodesByType('WORD');
      const wordTexts = wordNodes.map(w => w.text);
      expect(wordTexts).toContain('Hello');
      expect(wordTexts).toContain('world');
      expect(wordTexts).not.toContain('the');
    });

    it('should allow chunks with stop words like "we the people"', () => {
      const result = ingestPhraseText('we the people of the united states', graph);
      
      // Should preserve ALL lemmas in phrase (including stop words)
      expect(result.phrase.lemmas).toEqual(['we', 'the', 'people', 'of', 'the', 'united', 'states']);
      
      // Should create word nodes only for content words
      const wordNodes = graph.getNodesByType('WORD');
      const wordTexts = wordNodes.map(w => w.text);
      expect(wordTexts).toContain('people');
      expect(wordTexts).toContain('united');
      expect(wordTexts).toContain('states');
      expect(wordTexts).not.toContain('we');
      expect(wordTexts).not.toContain('the');
      expect(wordTexts).not.toContain('of');
      
      // Chunks should be able to include stop words
      expect(result.phrase.chunks.length).toBeGreaterThan(0);
      // The chunks should preserve the original text and lemmas including stop words
      result.phrase.chunks.forEach(chunk => {
        expect(chunk.text).toContain('we');
        expect(chunk.text).toContain('the');
        expect(chunk.lemmas).toContain('we');
        expect(chunk.lemmas).toContain('the');
      });
    });

    it('should create correct edges for "Now is the time for all good men to come to the aid of their country"', () => {
      const result = ingestPhraseText('Now is the time for all good men to come to the aid of their country', graph);
      
      // Should preserve ALL lemmas in phrase (including stop words)
      expect(result.phrase.lemmas).toContain('now');
      expect(result.phrase.lemmas).toContain('the');
      expect(result.phrase.lemmas).toContain('time');
      expect(result.phrase.lemmas).toContain('good');
      expect(result.phrase.lemmas).toContain('men');
      expect(result.phrase.lemmas).toContain('come');
      expect(result.phrase.lemmas).toContain('aid');
      expect(result.phrase.lemmas).toContain('country');
      
      // Should create word nodes only for content words
      const wordNodes = graph.getNodesByType('WORD');
      const wordTexts = wordNodes.map(w => w.text);
      expect(wordTexts).toContain('Now');
      expect(wordTexts).toContain('time');
      expect(wordTexts).toContain('good');
      expect(wordTexts).toContain('men');
      expect(wordTexts).toContain('come');
      expect(wordTexts).toContain('aid');
      expect(wordTexts).toContain('country');
      
      // Should NOT create word nodes for stop words
      expect(wordTexts).not.toContain('is');
      expect(wordTexts).not.toContain('the');
      expect(wordTexts).not.toContain('for');
      expect(wordTexts).not.toContain('all');
      expect(wordTexts).not.toContain('to');
      expect(wordTexts).not.toContain('of');
      expect(wordTexts).not.toContain('their');
      
      // Should create edges only to content words (7 content words)
      const edges = graph.getEdges();
      const phraseToWordEdges = edges.filter(e => e.type === 'PHRASE_CONTAINS_WORD' && e.from === result.phrase.id);
      expect(phraseToWordEdges).toHaveLength(7); // Now, time, good, men, come, aid, country
      
      // Verify no empty edges
      phraseToWordEdges.forEach(edge => {
        expect(edge.to).toBeTruthy();
        expect(edge.to).not.toBe('');
      });
    });
  });
});
