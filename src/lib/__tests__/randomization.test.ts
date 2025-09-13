import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnifiedRandomizationService,
  RandomizationConfigManager,
  DefaultRNG,
  SeededRNG,
  WeightedRandomSelection,
  ContextAwareWordSelection,
  ConfigurableSlotRandomization,
  SequentialMutatorApplication,
  type RandomizationConfig,
  type SlotRandomizationConfig
} from '../randomization/index.js';
import type { TemplateDoc, PhraseToken, WordNode, POS } from '../../types/index.js';

describe('Unified Randomization Service', () => {
  let service: UnifiedRandomizationService;
  let config: RandomizationConfig;

  beforeEach(() => {
    config = {
      seed: 'test-seed',
      enableLogging: true,
      strategies: {
        templateSelection: new WeightedRandomSelection(),
        wordSelection: new ContextAwareWordSelection(),
        slotRandomization: new ConfigurableSlotRandomization(),
        mutatorApplication: new SequentialMutatorApplication()
      }
    };
    service = new UnifiedRandomizationService(config);
  });

  describe('RNG Implementations', () => {
    it('should generate different numbers with DefaultRNG', () => {
      const rng = new DefaultRNG();
      const numbers = Array.from({ length: 10 }, () => rng.next());
      
      // Should have some variation (very unlikely all same)
      const uniqueNumbers = new Set(numbers);
      expect(uniqueNumbers.size).toBeGreaterThan(1);
      
      // All numbers should be in [0, 1) range
      numbers.forEach(num => {
        expect(num).toBeGreaterThanOrEqual(0);
        expect(num).toBeLessThan(1);
      });
    });

    it('should generate consistent numbers with SeededRNG', () => {
      const rng1 = new SeededRNG('test-seed');
      const rng2 = new SeededRNG('test-seed');
      
      const numbers1 = Array.from({ length: 10 }, () => rng1.next());
      const numbers2 = Array.from({ length: 10 }, () => rng2.next());
      
      expect(numbers1).toEqual(numbers2);
    });

    it('should generate different numbers with different seeds', () => {
      const rng1 = new SeededRNG('seed1');
      const rng2 = new SeededRNG('seed2');
      
      const numbers1 = Array.from({ length: 10 }, () => rng1.next());
      const numbers2 = Array.from({ length: 10 }, () => rng2.next());
      
      expect(numbers1).not.toEqual(numbers2);
    });
  });

  describe('Template Selection', () => {
    it('should select templates with equal probability', () => {
      const templates: TemplateDoc[] = [
        { id: '1', createdInSessionId: 'test', blocks: [] },
        { id: '2', createdInSessionId: 'test', blocks: [] },
        { id: '3', createdInSessionId: 'test', blocks: [] }
      ];

      const results = new Set();
      for (let i = 0; i < 100; i++) {
        const result = service.selectTemplate(templates);
        results.add(result.result.id);
      }

      // Should have selected all templates at least once
      expect(results.size).toBe(3);
    });

    it('should select templates with weighted probability', () => {
      const templates: TemplateDoc[] = [
        { id: '1', createdInSessionId: 'test', blocks: [] },
        { id: '2', createdInSessionId: 'test', blocks: [] },
        { id: '3', createdInSessionId: 'test', blocks: [] }
      ];
      const weights = [10, 1, 1]; // First template should be selected much more often

      const results = new Map();
      for (let i = 0; i < 1000; i++) {
        const result = service.selectTemplate(templates, weights);
        const id = result.result.id;
        results.set(id, (results.get(id) || 0) + 1);
      }

      // First template should be selected much more often
      expect(results.get('1')).toBeGreaterThan(results.get('2') * 5);
      expect(results.get('1')).toBeGreaterThan(results.get('3') * 5);
    });
  });

  describe('Word Selection', () => {
    it('should select from candidates with POS compatibility', () => {
      const candidates: WordNode[] = [
        {
          id: '1',
          text: 'cat',
          lemma: 'cat',
          pos: ['NOUN'],
          primaryPOS: 'NOUN',
          posPotential: ['NOUN'],
          posObserved: {},
          isPolysemousPOS: false,
          originalForm: 'cat',
          morphFeature: undefined
        },
        {
          id: '2',
          text: 'run',
          lemma: 'run',
          pos: ['VERB'],
          primaryPOS: 'VERB',
          posPotential: ['VERB'],
          posObserved: {},
          isPolysemousPOS: false,
          originalForm: 'run',
          morphFeature: undefined
        }
      ];

      const context = {
        lockedSet: new Set(),
        wordBank: { NOUN: ['dog', 'house'] }
      };

      const result = service.selectWord(candidates, 'NOUN', context);
      
      // Should select the NOUN candidate
      expect(result.result.text).toBe('cat');
    });

    it('should fallback to word bank when no compatible candidates', () => {
      const candidates: WordNode[] = [
        {
          id: '1',
          text: 'run',
          lemma: 'run',
          pos: ['VERB'],
          primaryPOS: 'VERB',
          posPotential: ['VERB'],
          posObserved: {},
          isPolysemousPOS: false,
          originalForm: 'run',
          morphFeature: undefined
        }
      ];

      const context = {
        lockedSet: new Set(),
        wordBank: { NOUN: ['dog', 'house'] }
      };

      const result = service.selectWord(candidates, 'NOUN', context);
      
      // Should fallback to word bank
      expect(['dog', 'house']).toContain(result.result.text);
    });
  });

  describe('Slot Randomization', () => {
    it('should randomize slots based on configuration', () => {
      const tokens: PhraseToken[] = [
        { text: 'the', pos: 'DET', posSet: ['DET'], randomize: false, slotLabel: null, morph: null },
        { text: 'cat', pos: 'NOUN', posSet: ['NOUN'], randomize: false, slotLabel: null, morph: null },
        { text: 'runs', pos: 'VERB', posSet: ['VERB'], randomize: false, slotLabel: null, morph: null }
      ];

      const slotConfig: SlotRandomizationConfig = {
        jitterP: 1.0, // 100% probability
        posRandomP: { NOUN: 100 }, // 100% for NOUNs
        maxRandomSlots: 2,
        usePositionBasedRandom: false,
        targetPOS: 'NOUN',
        targetPosition: 1,
        useClickableSelection: false,
        selectedWordIndices: new Set(),
        regexText: '',
        regexRandomizeP: 0
      };

      const result = service.randomizeSlots(tokens, slotConfig);
      
      // Should have randomized some tokens
      const randomizedCount = result.result.filter(t => t.randomize).length;
      expect(randomizedCount).toBeGreaterThan(0);
    });

    it('should respect max randomization slots', () => {
      const tokens: PhraseToken[] = [
        { text: 'the', pos: 'DET', posSet: ['DET'], randomize: false, slotLabel: null, morph: null },
        { text: 'cat', pos: 'NOUN', posSet: ['NOUN'], randomize: false, slotLabel: null, morph: null },
        { text: 'runs', pos: 'VERB', posSet: ['VERB'], randomize: false, slotLabel: null, morph: null },
        { text: 'fast', pos: 'ADJ', posSet: ['ADJ'], randomize: false, slotLabel: null, morph: null }
      ];

      const slotConfig: SlotRandomizationConfig = {
        jitterP: 1.0, // 100% probability
        posRandomP: {},
        maxRandomSlots: 2, // Max 2 slots
        usePositionBasedRandom: false,
        targetPOS: 'NOUN',
        targetPosition: 1,
        useClickableSelection: false,
        selectedWordIndices: new Set(),
        regexText: '',
        regexRandomizeP: 0
      };

      const result = service.randomizeSlots(tokens, slotConfig);
      
      // Should not exceed max randomization slots
      const randomizedCount = result.result.filter(t => t.randomize).length;
      expect(randomizedCount).toBeLessThanOrEqual(2);
    });
  });

  describe('Utility Methods', () => {
    it('should pick from array with equal probability', () => {
      const array = ['a', 'b', 'c'];
      const results = new Set();
      
      for (let i = 0; i < 100; i++) {
        const result = service.pickFromArray(array);
        if (result) results.add(result);
      }
      
      // Should have picked all items at least once
      expect(results.size).toBe(3);
    });

    it('should pick from array with weights', () => {
      const array = ['a', 'b', 'c'];
      const weights = [10, 1, 1];
      
      const results = new Map();
      for (let i = 0; i < 1000; i++) {
        const result = service.pickFromArrayWithWeights(array, weights);
        if (result) {
          results.set(result, (results.get(result) || 0) + 1);
        }
      }
      
      // 'a' should be selected much more often
      expect(results.get('a')).toBeGreaterThan(results.get('b') * 5);
      expect(results.get('a')).toBeGreaterThan(results.get('c') * 5);
    });
  });

  describe('Logging', () => {
    it('should log operations when enabled', () => {
      const templates: TemplateDoc[] = [
        { id: '1', createdInSessionId: 'test', blocks: [] }
      ];

      service.selectTemplate(templates);
      
      const logs = service.getLogs();
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].operation).toBe('templateSelection');
    });

    it('should not log when disabled', () => {
      const noLogService = new UnifiedRandomizationService({
        ...config,
        enableLogging: false
      });

      const templates: TemplateDoc[] = [
        { id: '1', createdInSessionId: 'test', blocks: [] }
      ];

      noLogService.selectTemplate(templates);
      
      const logs = noLogService.getLogs();
      expect(logs.length).toBe(0);
    });
  });

  describe('Configuration Management', () => {
    it('should update configuration', () => {
      const newConfig = {
        seed: 'new-seed',
        enableLogging: false
      };

      service.updateConfig(newConfig);
      const updatedConfig = service.getConfig();
      
      expect(updatedConfig.seed).toBe('new-seed');
      expect(updatedConfig.enableLogging).toBe(false);
    });
  });
});

describe('RandomizationConfigManager', () => {
  let manager: RandomizationConfigManager;

  beforeEach(() => {
    manager = RandomizationConfigManager.getInstance();
  });

  it('should create singleton instance', () => {
    const instance1 = RandomizationConfigManager.getInstance();
    const instance2 = RandomizationConfigManager.getInstance();
    
    expect(instance1).toBe(instance2);
  });

  it('should create service with default config', () => {
    const service = manager.createService();
    expect(service).toBeInstanceOf(UnifiedRandomizationService);
  });

  it('should update configuration', () => {
    manager.setSeed('test-seed');
    manager.setLoggingEnabled(true);
    
    const config = manager.getConfig();
    expect(config.seed).toBe('test-seed');
    expect(config.enableLogging).toBe(true);
  });
});
