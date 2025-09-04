import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticGraphLite } from '../semanticGraphLite.js';
import { fillTemplateSlotsRandom } from '../promptEngine.js';
import type { ContextualNodeSets, SessionLocks } from '../../types/index.js';

describe('Tense-Aware Templates', () => {
  let graph: SemanticGraphLite;

  beforeEach(() => {
    graph = new SemanticGraphLite();
  });

  it('should demonstrate morphological template matching', () => {
    // Create a mock context with words that have morphological features
    const mockContext: ContextualNodeSets = {
      words: [
        {
          id: 'word1',
          type: 'WORD',
          text: 'cat',
          lemma: 'cat',
          pos: ['NOUN'],
          originalForm: 'cat',
          morphFeature: undefined,
          posPotential: ['NOUN'],
          posObserved: { 'NOUN': 1 },
          primaryPOS: 'NOUN',
          isPolysemousPOS: false,
          stats: { uses: 0, likes: 0 }
        },
        {
          id: 'word2',
          type: 'WORD',
          text: 'eating',
          lemma: 'eat',
          pos: ['VERB'],
          originalForm: 'eating',
          morphFeature: 'participle',
          posPotential: ['VERB'],
          posObserved: { 'VERB': 1 },
          primaryPOS: 'VERB',
          isPolysemousPOS: false,
          stats: { uses: 0, likes: 0 }
        },
        {
          id: 'word3',
          type: 'WORD',
          text: 'ate',
          lemma: 'eat',
          pos: ['VERB'],
          originalForm: 'ate',
          morphFeature: 'past',
          posPotential: ['VERB'],
          posObserved: { 'VERB': 1 },
          primaryPOS: 'VERB',
          isPolysemousPOS: false,
          stats: { uses: 0, likes: 0 }
        },
        {
          id: 'word4',
          type: 'WORD',
          text: 'mouse',
          lemma: 'mouse',
          pos: ['NOUN'],
          originalForm: 'mouse',
          morphFeature: undefined,
          posPotential: ['NOUN'],
          posObserved: { 'NOUN': 1 },
          primaryPOS: 'NOUN',
          isPolysemousPOS: false,
          stats: { uses: 0, likes: 0 }
        }
      ],
      phrases: [],
      chunks: []
    };

    const mockLocks: SessionLocks = {
      lockedWordIds: [],
      lockedChunkIds: [],
      lockedTemplateIds: []
    };

    // Test template with participle form
    const participleTemplate = {
      id: 'test1',
      text: '[NOUN VERB:participle NOUN]',
      slots: [
        { kind: 'slot', pos: 'NOUN' },
        { kind: 'slot', pos: 'VERB:participle' },
        { kind: 'slot', pos: 'NOUN' }
      ],
      source: 'user' as const,
      createdInSessionId: 'test-session',
      baseText: 'cat eating mouse'
    };

    // Test template with past tense form
    const pastTemplate = {
      id: 'test2',
      text: '[NOUN VERB:past NOUN]',
      slots: [
        { kind: 'slot', pos: 'NOUN' },
        { kind: 'slot', pos: 'VERB:past' },
        { kind: 'slot', pos: 'NOUN' }
      ],
      source: 'user' as const,
      createdInSessionId: 'test-session',
      baseText: 'cat ate mouse'
    };

    // Mock RNG that always returns 0 (first item)
    const mockRng = () => 0;

    // Test participle template
    const participleResult = fillTemplateSlotsRandom(participleTemplate, mockContext, mockLocks, mockRng);
    expect(participleResult).toBeDefined();
    expect(participleResult?.text).toBe('Cat eating mouse');

    // Test past tense template
    const pastResult = fillTemplateSlotsRandom(pastTemplate, mockContext, mockLocks, mockRng);
    expect(pastResult).toBeDefined();
    expect(pastResult?.text).toBe('Cat ate mouse');
  });

  it('should demonstrate adjective morphological matching', () => {
    const mockContext: ContextualNodeSets = {
      words: [
        {
          id: 'word1',
          type: 'WORD',
          text: 'big',
          lemma: 'big',
          pos: ['ADJ'],
          originalForm: 'big',
          morphFeature: 'base',
          posPotential: ['ADJ'],
          posObserved: { 'ADJ': 1 },
          primaryPOS: 'ADJ',
          isPolysemousPOS: false,
          stats: { uses: 0, likes: 0 }
        },
        {
          id: 'word2',
          type: 'WORD',
          text: 'bigger',
          lemma: 'big',
          pos: ['ADJ'],
          originalForm: 'bigger',
          morphFeature: 'comparative',
          posPotential: ['ADJ'],
          posObserved: { 'ADJ': 1 },
          primaryPOS: 'ADJ',
          isPolysemousPOS: false,
          stats: { uses: 0, likes: 0 }
        },
        {
          id: 'word3',
          type: 'WORD',
          text: 'biggest',
          lemma: 'big',
          pos: ['ADJ'],
          originalForm: 'biggest',
          morphFeature: 'superlative',
          posPotential: ['ADJ'],
          posObserved: { 'ADJ': 1 },
          primaryPOS: 'ADJ',
          isPolysemousPOS: false,
          stats: { uses: 0, likes: 0 }
        },
        {
          id: 'word4',
          type: 'WORD',
          text: 'cat',
          lemma: 'cat',
          pos: ['NOUN'],
          originalForm: 'cat',
          morphFeature: undefined,
          posPotential: ['NOUN'],
          posObserved: { 'NOUN': 1 },
          primaryPOS: 'NOUN',
          isPolysemousPOS: false,
          stats: { uses: 0, likes: 0 }
        }
      ],
      phrases: [],
      chunks: []
    };

    const mockLocks: SessionLocks = {
      lockedWordIds: [],
      lockedChunkIds: [],
      lockedTemplateIds: []
    };

    // Test comparative template
    const comparativeTemplate = {
      id: 'test3',
      text: '[ADJ:comparative NOUN]',
      slots: [
        { kind: 'slot', pos: 'ADJ:comparative' },
        { kind: 'slot', pos: 'NOUN' }
      ],
      source: 'user' as const,
      createdInSessionId: 'test-session',
      baseText: 'bigger cat'
    };

    // Test superlative template
    const superlativeTemplate = {
      id: 'test4',
      text: '[ADJ:superlative NOUN]',
      slots: [
        { kind: 'slot', pos: 'ADJ:superlative' },
        { kind: 'slot', pos: 'NOUN' }
      ],
      source: 'user' as const,
      createdInSessionId: 'test-session',
      baseText: 'biggest cat'
    };

    const mockRng = () => 0;

    // Test comparative template
    const comparativeResult = fillTemplateSlotsRandom(comparativeTemplate, mockContext, mockLocks, mockRng);
    expect(comparativeResult).toBeDefined();
    expect(comparativeResult?.text).toBe('Bigger cat');

    // Test superlative template
    const superlativeResult = fillTemplateSlotsRandom(superlativeTemplate, mockContext, mockLocks, mockRng);
    expect(superlativeResult).toBeDefined();
    expect(superlativeResult?.text).toBe('Biggest cat');
  });
});
