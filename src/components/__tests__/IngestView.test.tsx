import { describe, it, expect } from 'vitest';
import { WordNode } from '../../types/index.js';

// Test the word organization logic
describe('IngestView Word Organization', () => {
  // Helper function to organize words by POS based on potential POS (copied from IngestView)
  const organizeWordsByPOS = (words: WordNode[]) => {
    const organized = {
      nouns: [] as WordNode[],
      verbs: [] as WordNode[],
      adjectives: [] as WordNode[],
      adverbs: [] as WordNode[],
      multiPOS: [] as WordNode[],
    };

    words.forEach(word => {
      // Get all potential POS tags from the word
      const potentialPOS = word.posPotential || [];
      
      // Add to Multi-POS column if word has multiple potential POS tags
      if (potentialPOS.length > 1) {
        organized.multiPOS.push(word);
      }
      
      // Add to individual POS columns based on what potential POS tags the word has
      if (potentialPOS.includes('NOUN')) {
        organized.nouns.push(word);
      }
      if (potentialPOS.includes('VERB')) {
        organized.verbs.push(word);
      }
      if (potentialPOS.includes('ADJ')) {
        organized.adjectives.push(word);
      }
      if (potentialPOS.includes('ADV')) {
        organized.adverbs.push(word);
      }
      
      // If word has no potential POS tags or unknown POS, put in Multi-POS as fallback
      if (potentialPOS.length === 0 || !potentialPOS.some(pos => ['NOUN', 'VERB', 'ADJ', 'ADV'].includes(pos))) {
        organized.multiPOS.push(word);
      }
    });

    // Sort all arrays alphabetically by word text
    Object.keys(organized).forEach(key => {
      organized[key as keyof typeof organized].sort((a, b) => a.text.localeCompare(b.text));
    });

    return organized;
  };

  it('should organize words based on potential POS', () => {
    const words: WordNode[] = [
      {
        id: '1',
        type: 'WORD',
        text: 'filling',
        lemma: 'filling',
        pos: ['NOUN'], // Current POS
        posPotential: ['NOUN', 'VERB'], // Potential POS
        posObserved: { 'NOUN': 1 },
        primaryPOS: 'NOUN',
        isPolysemousPOS: true,
      },
      {
        id: '2',
        type: 'WORD',
        text: 'run',
        lemma: 'run',
        pos: ['VERB'], // Current POS
        posPotential: ['NOUN', 'VERB'], // Potential POS
        posObserved: { 'VERB': 2 },
        primaryPOS: 'VERB',
        isPolysemousPOS: true,
      },
      {
        id: '3',
        type: 'WORD',
        text: 'table',
        lemma: 'table',
        pos: ['NOUN'], // Current POS
        posPotential: ['NOUN'], // Only one potential POS
        posObserved: { 'NOUN': 3 },
        primaryPOS: 'NOUN',
        isPolysemousPOS: false,
      },
      {
        id: '4',
        type: 'WORD',
        text: 'quickly',
        lemma: 'quickly',
        pos: ['ADV'], // Current POS
        posPotential: ['ADV'], // Only one potential POS
        posObserved: { 'ADV': 1 },
        primaryPOS: 'ADV',
        isPolysemousPOS: false,
      },
    ];

    const organized = organizeWordsByPOS(words);

    // Words with potential NOUN should appear in nouns column
    expect(organized.nouns).toHaveLength(3); // filling, run, table
    expect(organized.nouns.map(w => w.text)).toEqual(['filling', 'run', 'table']);

    // Words with potential VERB should appear in verbs column
    expect(organized.verbs).toHaveLength(2); // filling, run
    expect(organized.verbs.map(w => w.text)).toEqual(['filling', 'run']);

    // Words with potential ADV should appear in adverbs column
    expect(organized.adverbs).toHaveLength(1); // quickly
    expect(organized.adverbs.map(w => w.text)).toEqual(['quickly']);

    // Words with multiple potential POS should appear in multiPOS column
    expect(organized.multiPOS).toHaveLength(2); // filling, run
    expect(organized.multiPOS.map(w => w.text)).toEqual(['filling', 'run']);

    // Words with only one potential POS should not appear in multiPOS column
    expect(organized.multiPOS.map(w => w.text)).not.toContain('table');
    expect(organized.multiPOS.map(w => w.text)).not.toContain('quickly');
  });

  it('should handle words with no potential POS', () => {
    const words: WordNode[] = [
      {
        id: '1',
        type: 'WORD',
        text: 'unknown',
        lemma: 'unknown',
        pos: ['X'],
        posPotential: [], // No potential POS
        posObserved: {},
        primaryPOS: 'NOUN',
        isPolysemousPOS: false,
      },
    ];

    const organized = organizeWordsByPOS(words);

    // Words with no potential POS should go to multiPOS as fallback
    expect(organized.multiPOS).toHaveLength(1);
    expect(organized.multiPOS[0].text).toBe('unknown');
    expect(organized.nouns).toHaveLength(0);
    expect(organized.verbs).toHaveLength(0);
    expect(organized.adjectives).toHaveLength(0);
    expect(organized.adverbs).toHaveLength(0);
  });
});
