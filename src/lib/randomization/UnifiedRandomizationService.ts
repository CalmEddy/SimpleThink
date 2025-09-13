import type { POS, TemplateDoc, PhraseToken, WordNode, PhraseNode } from '../../types/index.js';
import type { SemanticGraphLite } from '../semanticGraphLite.js';

// ===== CORE INTERFACES =====

export interface RNG {
  next(): number; // Returns [0, 1)
  seed?: string;
}

export interface RandomizationConfig {
  seed?: string;
  enableLogging?: boolean;
  strategies: {
    templateSelection: TemplateSelectionStrategy;
    wordSelection: WordSelectionStrategy;
    slotRandomization: SlotRandomizationStrategy;
    mutatorApplication: MutatorApplicationStrategy;
  };
}

export interface RandomizationResult<T> {
  result: T;
  debug: {
    strategy: string;
    seed?: string;
    timestamp: number;
    context: any;
  };
}

export interface RandomizationLog {
  operation: string;
  timestamp: number;
  duration: number;
  result: string;
  context?: any;
}

// ===== STRATEGY INTERFACES =====

export interface TemplateSelectionStrategy {
  select(templates: TemplateDoc[], weights?: number[], rng: RNG): TemplateDoc;
}

export interface WordSelectionStrategy {
  select(candidates: WordNode[], pos: POS, context: SelectionContext, rng: RNG): WordNode;
}

export interface SlotRandomizationStrategy {
  randomize(tokens: PhraseToken[], config: SlotRandomizationConfig, rng: RNG): PhraseToken[];
}

export interface MutatorApplicationStrategy {
  apply(template: TemplateDoc, mutators: any[], rng: RNG): TemplateDoc;
}

export interface SelectionContext {
  lockedSet: Set<string>;
  wordBank: Record<string, string[]>;
  graph?: SemanticGraphLite;
}

export interface SlotRandomizationConfig {
  jitterP: number;
  posRandomP: Record<POS, number>;
  maxRandomSlots: number;
  usePositionBasedRandom: boolean;
  targetPOS: POS;
  targetPosition: number;
  useClickableSelection: boolean;
  selectedWordIndices: Set<number>;
  regexText: string;
  regexRandomizeP: number;
}

// ===== RNG IMPLEMENTATIONS =====

export class DefaultRNG implements RNG {
  next(): number {
    return Math.random();
  }
}

export class SeededRNG implements RNG {
  private state: number;
  public seed: string;

  constructor(seed: string) {
    this.seed = seed;
    this.state = this.hashString(seed);
  }

  next(): number {
    // Simple linear congruential generator
    this.state = (this.state * 1664525 + 1013904223) % 4294967296;
    return this.state / 4294967296;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}

// ===== LOGGING SYSTEM =====

export class RandomizationLogger {
  private enabled: boolean;
  private logs: RandomizationLog[] = [];

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  log<T>(operation: string, fn: () => T, context?: any): RandomizationResult<T> {
    const startTime = Date.now();
    const result = fn();
    const endTime = Date.now();

    if (this.enabled) {
      const logEntry: RandomizationLog = {
        operation,
        timestamp: startTime,
        duration: endTime - startTime,
        result: typeof result === 'object' ? JSON.stringify(result) : String(result),
        context
      };
      this.logs.push(logEntry);
    }

    return {
      result,
      debug: {
        strategy: operation,
        seed: context?.seed,
        timestamp: startTime,
        context: { duration: endTime - startTime, ...context }
      }
    };
  }

  getLogs(): RandomizationLog[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
  }
}

// ===== MAIN UNIFIED SERVICE =====

export class UnifiedRandomizationService {
  private rng: RNG;
  private config: RandomizationConfig;
  private logger: RandomizationLogger;

  constructor(config: RandomizationConfig) {
    this.config = config;
    this.rng = config.seed ? new SeededRNG(config.seed) : new DefaultRNG();
    this.logger = new RandomizationLogger(config.enableLogging || false);
  }

  // Unified template selection
  selectTemplate(templates: TemplateDoc[], weights?: number[]): RandomizationResult<TemplateDoc> {
    return this.logger.log('templateSelection', () => {
      return this.config.strategies.templateSelection.select(templates, weights, this.rng);
    }, { templateCount: templates.length, weights });
  }

  // Unified word selection
  selectWord(candidates: WordNode[], pos: POS, context: SelectionContext): RandomizationResult<WordNode> {
    return this.logger.log('wordSelection', () => {
      return this.config.strategies.wordSelection.select(candidates, pos, context, this.rng);
    }, { candidateCount: candidates.length, pos });
  }

  // Unified slot randomization
  randomizeSlots(tokens: PhraseToken[], config: SlotRandomizationConfig): RandomizationResult<PhraseToken[]> {
    return this.logger.log('slotRandomization', () => {
      return this.config.strategies.slotRandomization.randomize(tokens, config, this.rng);
    }, { tokenCount: tokens.length, config });
  }

  // Unified mutator application
  applyMutators(template: TemplateDoc, mutators: any[]): RandomizationResult<TemplateDoc> {
    return this.logger.log('mutatorApplication', () => {
      return this.config.strategies.mutatorApplication.apply(template, mutators, this.rng);
    }, { mutatorCount: mutators.length });
  }

  // Utility methods for common operations
  pickFromArray<T>(array: T[]): T | null {
    if (!array.length) return null;
    return array[Math.floor(this.rng.next() * array.length)];
  }

  pickFromArrayWithWeights<T>(array: T[], weights: number[]): T | null {
    if (!array.length) return null;
    if (weights.length !== array.length) {
      return this.pickFromArray(array);
    }
    
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return this.pickFromArray(array);
    
    const target = this.rng.next() * total;
    let acc = 0;
    
    for (let i = 0; i < array.length; i++) {
      acc += weights[i];
      if (target <= acc) return array[i];
    }
    
    return array[array.length - 1];
  }

  // Configuration management
  updateConfig(newConfig: Partial<RandomizationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (newConfig.seed) {
      this.rng = new SeededRNG(newConfig.seed);
    }
  }

  getConfig(): RandomizationConfig {
    return { ...this.config };
  }

  // Logging access
  getLogs(): RandomizationLog[] {
    return this.logger.getLogs();
  }

  clearLogs(): void {
    this.logger.clearLogs();
  }
}
