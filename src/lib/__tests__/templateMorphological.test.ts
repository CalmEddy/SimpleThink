import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticGraphLite } from '../semanticGraphLite.js';
import { realizeTemplate } from '../fillTemplate.js';
import type { ContextualNodeSets, SessionLocks } from '../../types/index.js';

describe('Tense-Aware Templates', () => {
  let graph: SemanticGraphLite;

  beforeEach(() => {
    graph = new SemanticGraphLite();
  });

  it('should demonstrate morphological template matching', async () => {
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
    const participleUnifiedTemplate = {
      id: participleTemplate.id,
      text: participleTemplate.text,
      createdInSessionId: participleTemplate.createdInSessionId,
      tokens: participleTemplate.slots.map(slot => ({
        kind: 'slot' as const,
        pos: slot.pos as any,
        index: undefined
      }))
    };
    const participleResult = await realizeTemplate({
      tpl: participleUnifiedTemplate,
      ctx: { words: mockContext.words },
      lockedSet: new Set(),
      wordBank: {}
    });
    expect(participleResult).toBeDefined();
    expect(participleResult?.surface).toBe('Cat eating mouse');

    // Test past tense template
    const pastUnifiedTemplate = {
      id: pastTemplate.id,
      text: pastTemplate.text,
      createdInSessionId: pastTemplate.createdInSessionId,
      tokens: pastTemplate.slots.map(slot => ({
        kind: 'slot' as const,
        pos: slot.pos as any,
        index: undefined
      }))
    };
    const pastResult = await realizeTemplate({
      tpl: pastUnifiedTemplate,
      ctx: { words: mockContext.words },
      lockedSet: new Set(),
      wordBank: {}
    });
    expect(pastResult).toBeDefined();
    expect(pastResult?.surface).toBe('Cat ate mouse');
  });

  it('should demonstrate adjective morphological matching', async () => {
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
    const comparativeUnifiedTemplate = {
      id: comparativeTemplate.id,
      text: comparativeTemplate.text,
      createdInSessionId: comparativeTemplate.createdInSessionId,
      tokens: comparativeTemplate.slots.map(slot => ({
        kind: 'slot' as const,
        pos: slot.pos as any,
        index: undefined
      }))
    };
    const comparativeResult = await realizeTemplate({
      tpl: comparativeUnifiedTemplate,
      ctx: { words: mockContext.words },
      lockedSet: new Set(),
      wordBank: {}
    });
    expect(comparativeResult).toBeDefined();
    expect(comparativeResult?.surface).toBe('Bigger cat');

    // Test superlative template
    const superlativeUnifiedTemplate = {
      id: superlativeTemplate.id,
      text: superlativeTemplate.text,
      createdInSessionId: superlativeTemplate.createdInSessionId,
      tokens: superlativeTemplate.slots.map(slot => ({
        kind: 'slot' as const,
        pos: slot.pos as any,
        index: undefined
      }))
    };
    const superlativeResult = await realizeTemplate({
      tpl: superlativeUnifiedTemplate,
      ctx: { words: mockContext.words },
      lockedSet: new Set(),
      wordBank: {}
    });
    expect(superlativeResult).toBeDefined();
    expect(superlativeResult?.surface).toBe('Biggest cat');
  });
});
