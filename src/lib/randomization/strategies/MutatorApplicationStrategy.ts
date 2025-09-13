import type { TemplateDoc } from '../../../types/index.js';
import type { RNG } from '../UnifiedRandomizationService.js';

// ===== MUTATOR APPLICATION STRATEGIES =====

export interface MutatorApplicationStrategy {
  apply(template: TemplateDoc, mutators: any[], rng?: RNG): TemplateDoc;
}

export class SequentialMutatorApplication implements MutatorApplicationStrategy {
  apply(template: TemplateDoc, mutators: any[], rng?: RNG): TemplateDoc {
    const rngInstance = rng || { next: () => Math.random() };
    let result = { ...template };

    for (const mutator of mutators) {
      try {
        if (typeof mutator === 'function') {
          // Create a mock utils object for backward compatibility
          const utils = {
            rng,
            jitterSlots: (doc: TemplateDoc, p: number) => this.jitterSlots(doc, p, rngInstance),
            autoBind: (doc: TemplateDoc, maxGroups = 2) => this.autoBind(doc, maxGroups, rngInstance),
            ensureRandomizedMin: (doc: TemplateDoc, min: number) => this.ensureRandomizedMin(doc, min, rngInstance)
          };
          
          result = mutator(result, utils);
        }
      } catch (error) {
        console.warn('Mutator application failed:', error);
        // Continue with other mutators
      }
    }

    return result;
  }

  private jitterSlots(doc: TemplateDoc, p: number, rng: RNG): TemplateDoc {
    const blocks = doc.blocks.map(b => {
      if (b.kind !== 'phrase') return b;
      
      const tokens = b.tokens.map(t => {
        const hasPOS = !!(t as any).pos || !!((t as any).posSet && (t as any).posSet.length);
        const looksLikeWord = typeof t.text === 'string' && /[A-Za-z]/.test(t.text);
        
        if (!hasPOS || !looksLikeWord) return t;
        if (t.randomize) return t; // Don't disable existing slots
        
        return (rng.next() < p) ? { ...t, randomize: true } : t;
      });
      
      return { ...b, tokens };
    });
    
    return { ...doc, blocks };
  }

  private autoBind(doc: TemplateDoc, maxGroups: number, rng: RNG): TemplateDoc {
    const blocks = doc.blocks.map(b => {
      if (b.kind !== 'phrase') return b;
      
      let current = 1;
      const tokens = b.tokens.map(t => {
        if (!t.randomize) return t;
        
        if (rng.next() < 0.5) {
          const label = String(1 + Math.floor(rng.next() * Math.max(1, maxGroups)));
          return { ...t, slotLabel: label };
        }
        return t;
      });
      
      return { ...b, tokens };
    });
    
    return { ...doc, blocks };
  }

  private ensureRandomizedMin(doc: TemplateDoc, min: number, rng: RNG): TemplateDoc {
    const blocks = doc.blocks.map(b => {
      if (b.kind !== 'phrase') return b;
      
      const idxs = b.tokens.map((t, i) => ({ i, can: /[A-Za-z]/.test(t.text) })).filter(x => x.can);
      const already = b.tokens.filter(t => t.randomize).length;
      
      if (already >= min) return b;
      
      const need = Math.min(min - already, idxs.length);
      const chosen = new Set<number>();
      
      while (chosen.size < need && chosen.size < idxs.length) {
        const pick = idxs[Math.floor(rng.next() * idxs.length)].i;
        chosen.add(pick);
      }
      
      const tokens = b.tokens.map((t, i) => 
        chosen.has(i) ? { ...t, randomize: true } : t
      );
      
      return { ...b, tokens };
    });
    
    return { ...doc, blocks };
  }
}

export class ParallelMutatorApplication implements MutatorApplicationStrategy {
  apply(template: TemplateDoc, mutators: any[], rng?: RNG): TemplateDoc {
    const rngInstance = rng || { next: () => Math.random() };
    // Apply all mutators in parallel and merge results
    const results = mutators.map(mutator => {
      try {
        if (typeof mutator === 'function') {
          const utils = {
            rng,
            jitterSlots: (doc: TemplateDoc, p: number) => this.jitterSlots(doc, p, rngInstance),
            autoBind: (doc: TemplateDoc, maxGroups = 2) => this.autoBind(doc, maxGroups, rngInstance),
            ensureRandomizedMin: (doc: TemplateDoc, min: number) => this.ensureRandomizedMin(doc, min, rngInstance)
          };
          
          return mutator({ ...template }, utils);
        }
        return template;
      } catch (error) {
        console.warn('Mutator application failed:', error);
        return template;
      }
    });

    // Merge results by combining all randomized tokens
    return this.mergeMutatorResults(template, results);
  }

  private mergeMutatorResults(original: TemplateDoc, results: TemplateDoc[]): TemplateDoc {
    const blocks = original.blocks.map(b => {
      if (b.kind !== 'phrase') return b;
      
      const tokens = b.tokens.map((token, index) => {
        // Check if any mutator randomized this token
        const isRandomized = results.some(result => {
          const resultBlock = result.blocks.find(block => 
            block.kind === 'phrase' && block.tokens[index]?.randomize
          );
          return resultBlock;
        });
        
        return isRandomized ? { ...token, randomize: true } : token;
      });
      
      return { ...b, tokens };
    });
    
    return { ...original, blocks };
  }

  private jitterSlots(doc: TemplateDoc, p: number, rng: RNG): TemplateDoc {
    // Same implementation as SequentialMutatorApplication
    const blocks = doc.blocks.map(b => {
      if (b.kind !== 'phrase') return b;
      
      const tokens = b.tokens.map(t => {
        const hasPOS = !!(t as any).pos || !!((t as any).posSet && (t as any).posSet.length);
        const looksLikeWord = typeof t.text === 'string' && /[A-Za-z]/.test(t.text);
        
        if (!hasPOS || !looksLikeWord) return t;
        if (t.randomize) return t;
        
        return (rng.next() < p) ? { ...t, randomize: true } : t;
      });
      
      return { ...b, tokens };
    });
    
    return { ...doc, blocks };
  }

  private autoBind(doc: TemplateDoc, maxGroups: number, rng: RNG): TemplateDoc {
    // Same implementation as SequentialMutatorApplication
    const blocks = doc.blocks.map(b => {
      if (b.kind !== 'phrase') return b;
      
      const tokens = b.tokens.map(t => {
        if (!t.randomize) return t;
        
        if (rng.next() < 0.5) {
          const label = String(1 + Math.floor(rng.next() * Math.max(1, maxGroups)));
          return { ...t, slotLabel: label };
        }
        return t;
      });
      
      return { ...b, tokens };
    });
    
    return { ...doc, blocks };
  }

  private ensureRandomizedMin(doc: TemplateDoc, min: number, rng: RNG): TemplateDoc {
    // Same implementation as SequentialMutatorApplication
    const blocks = doc.blocks.map(b => {
      if (b.kind !== 'phrase') return b;
      
      const idxs = b.tokens.map((t, i) => ({ i, can: /[A-Za-z]/.test(t.text) })).filter(x => x.can);
      const already = b.tokens.filter(t => t.randomize).length;
      
      if (already >= min) return b;
      
      const need = Math.min(min - already, idxs.length);
      const chosen = new Set<number>();
      
      while (chosen.size < need && chosen.size < idxs.length) {
        const pick = idxs[Math.floor(rng.next() * idxs.length)].i;
        chosen.add(pick);
      }
      
      const tokens = b.tokens.map((t, i) => 
        chosen.has(i) ? { ...t, randomize: true } : t
      );
      
      return { ...b, tokens };
    });
    
    return { ...doc, blocks };
  }
}
