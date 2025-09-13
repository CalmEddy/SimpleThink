import type { POS, WordNode } from '../../../types/index.js';
import type { RNG, SelectionContext } from '../UnifiedRandomizationService.js';

// ===== WORD SELECTION STRATEGIES =====

export interface WordSelectionStrategy {
  select(candidates: WordNode[], pos: POS, context: SelectionContext, rng?: RNG): WordNode;
}

export class ContextAwareWordSelection implements WordSelectionStrategy {
  select(candidates: WordNode[], pos: POS, context: SelectionContext, rng?: RNG): WordNode {
    const rngInstance = rng || { next: () => Math.random() };
    
    if (!candidates.length) {
      // Fallback to word bank
      return this.selectFromWordBank(pos, context, rngInstance);
    }

    // Filter candidates by POS compatibility
    const compatibleCandidates = candidates.filter(word => 
      this.isPOSCompatible(word.pos, pos)
    );

    if (compatibleCandidates.length === 0) {
      return this.selectFromWordBank(pos, context, rngInstance);
    }

    // Prefer locked words if available
    const lockedCandidates = compatibleCandidates.filter(word => 
      context.lockedSet.has(word.id)
    );

    if (lockedCandidates.length > 0) {
      return lockedCandidates[Math.floor(rngInstance.next() * lockedCandidates.length)];
    }

    // Select from compatible candidates
    return compatibleCandidates[Math.floor(rngInstance.next() * compatibleCandidates.length)];
  }

  private selectFromWordBank(pos: POS, context: SelectionContext, rng: RNG): WordNode {
    const rngInstance = rng || { next: () => Math.random() };
    const wordBank = context.wordBank;
    const words = wordBank[pos] || wordBank[this.getBasePOS(pos)] || [];
    
    if (words.length === 0) {
      // Create a fallback word
      return {
        id: `fallback_${pos}_${Date.now()}`,
        text: pos.toLowerCase(),
        lemma: pos.toLowerCase(),
        pos: [pos],
        primaryPOS: pos,
        posPotential: [pos],
        posObserved: {},
        isPolysemousPOS: false,
        originalForm: pos.toLowerCase(),
        morphFeature: undefined
      } as WordNode;
    }

    const selectedWord = words[Math.floor(rngInstance.next() * words.length)];
    return {
      id: `bank_${pos}_${Date.now()}`,
      text: selectedWord,
      lemma: selectedWord.toLowerCase(),
      pos: [pos],
      primaryPOS: pos,
      posPotential: [pos],
      posObserved: {},
      isPolysemousPOS: false,
      originalForm: selectedWord,
      morphFeature: undefined
    } as WordNode;
  }

  private isPOSCompatible(wordPos: POS[] | string[] | undefined, targetPos: POS): boolean {
    if (!wordPos || !Array.isArray(wordPos)) return false;
    
    const targetBase = this.getBasePOS(targetPos);
    
    return wordPos.some(pos => {
      const posStr = String(pos).toUpperCase();
      const posBase = this.getBasePOS(posStr as POS);
      
      // Exact match
      if (posStr === targetPos.toUpperCase()) return true;
      
      // Base category match (e.g., VERB matches VERB:past)
      if (posBase === targetBase) return true;
      
      // Special cases
      if (targetPos === 'PROPN') return posStr === 'PROPN';
      if (targetPos === 'NOUN') return posStr !== 'PROPN' && posBase === 'NOUN';
      
      return false;
    });
  }

  private getBasePOS(pos: POS): string {
    return String(pos).split(':')[0].toUpperCase();
  }
}

export class FrequencyBasedWordSelection implements WordSelectionStrategy {
  select(candidates: WordNode[], pos: POS, context: SelectionContext, rng?: RNG): WordNode {
    const rngInstance = rng || { next: () => Math.random() };
    
    if (!candidates.length) {
      return new ContextAwareWordSelection().select(candidates, pos, context, rng);
    }

    // Calculate weights based on observed frequency
    const weights = candidates.map(word => {
      const observedCount = word.posObserved?.[pos] || 0;
      const totalObserved = Object.values(word.posObserved || {}).reduce((a, b) => a + b, 0);
      return totalObserved > 0 ? (observedCount / totalObserved) + 0.1 : 0.1; // Minimum weight
    });

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight <= 0) {
      return candidates[Math.floor(rngInstance.next() * candidates.length)];
    }

    const target = rngInstance.next() * totalWeight;
    let acc = 0;

    for (let i = 0; i < candidates.length; i++) {
      acc += weights[i];
      if (target <= acc) return candidates[i];
    }

    return candidates[candidates.length - 1];
  }
}

export class RandomWordSelection implements WordSelectionStrategy {
  select(candidates: WordNode[], pos: POS, context: SelectionContext, rng?: RNG): WordNode {
    const rngInstance = rng || { next: () => Math.random() };
    
    if (!candidates.length) {
      return new ContextAwareWordSelection().select(candidates, pos, context, rngInstance);
    }

    return candidates[Math.floor(rngInstance.next() * candidates.length)];
  }
}
