import type { RandomizationConfig } from './UnifiedRandomizationService.js';
import { WeightedRandomSelection } from './strategies/TemplateSelectionStrategy.js';
import { ContextAwareWordSelection } from './strategies/WordSelectionStrategy.js';
import { ConfigurableSlotRandomization } from './strategies/SlotRandomizationStrategy.js';
import { SequentialMutatorApplication } from './strategies/MutatorApplicationStrategy.js';
import type { PromptGenerationProfile } from '../../types/index.js';

export class RandomizationConfigManager {
  private static instance: RandomizationConfigManager;
  private config: RandomizationConfig;

  private constructor() {
    this.config = this.createDefaultConfig();
  }

  static getInstance(): RandomizationConfigManager {
    if (!RandomizationConfigManager.instance) {
      RandomizationConfigManager.instance = new RandomizationConfigManager();
    }
    return RandomizationConfigManager.instance;
  }

  private createDefaultConfig(): RandomizationConfig {
    return {
      seed: undefined,
      enableLogging: false,
      strategies: {
        templateSelection: new WeightedRandomSelection(),
        wordSelection: new ContextAwareWordSelection(),
        slotRandomization: new ConfigurableSlotRandomization(),
        mutatorApplication: new SequentialMutatorApplication()
      }
    };
  }

  loadFromProfile(profile: PromptGenerationProfile): void {
    this.config = {
      seed: profile.seed,
      enableLogging: true, // Enable logging when using profiles
      strategies: {
        templateSelection: new WeightedRandomSelection(),
        wordSelection: new ContextAwareWordSelection(),
        slotRandomization: new ConfigurableSlotRandomization(),
        mutatorApplication: new SequentialMutatorApplication()
      }
    };
  }

  async loadFromSessionProfile(sessionId: string): Promise<void> {
    try {
      // Import here to avoid circular dependencies
      const { ensureDefaultProfileExists } = await import('../sessionProfiles.js');
      const defaultProfile = ensureDefaultProfileExists(sessionId);
      this.loadFromProfile(defaultProfile);
    } catch (error) {
      console.warn('Failed to load session profile, using default config:', error);
      this.config = this.createDefaultConfig();
    }
  }

  updateConfig(updates: Partial<RandomizationConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getConfig(): RandomizationConfig {
    return { ...this.config };
  }

  // Convenience methods for common configuration updates
  setSeed(seed: string | undefined): void {
    this.config.seed = seed;
  }

  setLoggingEnabled(enabled: boolean): void {
    this.config.enableLogging = enabled;
  }

  // Factory method to create a new service instance with current config
  async createService(): Promise<import('./UnifiedRandomizationService.js').UnifiedRandomizationService> {
    const { UnifiedRandomizationService } = await import('./UnifiedRandomizationService.js');
    return new UnifiedRandomizationService(this.config);
  }
}
