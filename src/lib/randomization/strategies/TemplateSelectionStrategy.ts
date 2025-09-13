import type { TemplateDoc } from '../../../types/index.js';
import type { RNG } from '../UnifiedRandomizationService.js';

// ===== TEMPLATE SELECTION STRATEGIES =====

export interface TemplateSelectionStrategy {
  select(templates: TemplateDoc[], weights?: number[], rng?: RNG): TemplateDoc;
}

export class WeightedRandomSelection implements TemplateSelectionStrategy {
  select(templates: TemplateDoc[], weights?: number[], rng?: RNG): TemplateDoc {
    const rngInstance = rng || { next: () => Math.random() };
    
    if (!weights || weights.length !== templates.length) {
      return templates[Math.floor(rngInstance.next() * templates.length)];
    }
    
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) {
      return templates[Math.floor(rngInstance.next() * templates.length)];
    }
    
    const target = rngInstance.next() * total;
    let acc = 0;
    
    for (let i = 0; i < templates.length; i++) {
      acc += weights[i];
      if (target <= acc) return templates[i];
    }
    
    return templates[templates.length - 1];
  }
}

export class ShuffledSelection implements TemplateSelectionStrategy {
  select(templates: TemplateDoc[], weights?: number[], rng?: RNG): TemplateDoc {
    const rngInstance = rng || { next: () => Math.random() };
    const shuffled = [...templates].sort(() => rngInstance.next() - 0.5);
    return shuffled[0];
  }
}

export class RoundRobinSelection implements TemplateSelectionStrategy {
  private currentIndex = 0;

  select(templates: TemplateDoc[], weights?: number[], rng?: RNG): TemplateDoc {
    const selected = templates[this.currentIndex % templates.length];
    this.currentIndex++;
    return selected;
  }
}

export class WeightedShuffledSelection implements TemplateSelectionStrategy {
  select(templates: TemplateDoc[], weights?: number[], rng?: RNG): TemplateDoc {
    if (!weights || weights.length !== templates.length) {
      const rngInstance = rng || { next: () => Math.random() };
      const shuffled = [...templates].sort(() => rngInstance.next() - 0.5);
      return shuffled[0];
    }
    
    // Create weighted array where each template appears according to its weight
    const weightedArray: TemplateDoc[] = [];
    const maxWeight = Math.max(...weights);
    
    for (let i = 0; i < templates.length; i++) {
      const normalizedWeight = Math.ceil((weights[i] / maxWeight) * 10); // Scale to 1-10
      for (let j = 0; j < normalizedWeight; j++) {
        weightedArray.push(templates[i]);
      }
    }
    
    if (weightedArray.length === 0) {
      const rngInstance = rng || { next: () => Math.random() };
      return templates[Math.floor(rngInstance.next() * templates.length)];
    }
    
    const rngInstance = rng || { next: () => Math.random() };
    return weightedArray[Math.floor(rngInstance.next() * weightedArray.length)];
  }
}
