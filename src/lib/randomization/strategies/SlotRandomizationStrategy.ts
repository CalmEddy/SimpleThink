import type { PhraseToken, POS } from '../../../types/index.js';
import type { RNG, SlotRandomizationConfig } from '../UnifiedRandomizationService.js';

// ===== SLOT RANDOMIZATION STRATEGIES =====

export interface SlotRandomizationStrategy {
  randomize(tokens: PhraseToken[], config: SlotRandomizationConfig, rng?: RNG): PhraseToken[];
}

export class ConfigurableSlotRandomization implements SlotRandomizationStrategy {
  randomize(tokens: PhraseToken[], config: SlotRandomizationConfig, rng?: RNG): PhraseToken[] {
    const rngInstance = rng || { next: () => Math.random() };
    let result = [...tokens];

    // Apply jitter randomization
    if (config.jitterP > 0) {
      result = this.applyJitterRandomization(result, config.jitterP, rngInstance);
    }

    // Apply max randomization
    if (config.maxRandomSlots > 0) {
      result = this.applyMaxRandomization(result, config.maxRandomSlots, rngInstance);
    }

    // Apply position-based randomization
    if (config.usePositionBasedRandom) {
      result = this.applyPositionBasedRandomization(result, config, rngInstance);
    }

    // Apply clickable selection
    if (config.useClickableSelection && config.selectedWordIndices.size > 0) {
      result = this.applyClickableSelection(result, config.selectedWordIndices);
    }

    // Apply POS-based randomization
    result = this.applyPOSBasedRandomization(result, config.posRandomP, rngInstance);

    // Apply regex-based randomization
    if (config.regexText && config.regexRandomizeP > 0) {
      result = this.applyRegexRandomization(result, config, rngInstance);
    }

    return result;
  }

  private applyJitterRandomization(tokens: PhraseToken[], jitterP: number, rng: RNG): PhraseToken[] {
    return tokens.map(token => {
      if (this.isRandomizable(token) && !token.randomize && rng.next() < jitterP) {
        return { ...token, randomize: true };
      }
      return token;
    });
  }

  private applyMaxRandomization(tokens: PhraseToken[], maxSlots: number, rng: RNG): PhraseToken[] {
    const randomizableTokens = tokens
      .map((token, index) => ({ token, index }))
      .filter(({ token }) => this.isRandomizable(token) && !token.randomize);

    const toRandomize = Math.min(maxSlots, randomizableTokens.length);
    const selected = new Set<number>();

    while (selected.size < toRandomize && selected.size < randomizableTokens.length) {
      const randomIndex = Math.floor(rng.next() * randomizableTokens.length);
      selected.add(randomizableTokens[randomIndex].index);
    }

    return tokens.map((token, index) => 
      selected.has(index) ? { ...token, randomize: true } : token
    );
  }

  private applyPositionBasedRandomization(
    tokens: PhraseToken[], 
    config: SlotRandomizationConfig, 
    rng: RNG
  ): PhraseToken[] {
    const matchingTokens = tokens
      .map((token, index) => ({ token, index }))
      .filter(({ token }) => 
        token.pos === config.targetPOS || 
        (token.posSet && token.posSet.includes(config.targetPOS))
      );

    if (matchingTokens.length >= config.targetPosition) {
      const targetIndex = matchingTokens[config.targetPosition - 1].index;
      return tokens.map((token, index) => 
        index === targetIndex ? { ...token, randomize: true } : token
      );
    }

    return tokens;
  }

  private applyClickableSelection(tokens: PhraseToken[], selectedIndices: Set<number>): PhraseToken[] {
    return tokens.map((token, index) => 
      selectedIndices.has(index) ? { ...token, randomize: true } : token
    );
  }

  private applyPOSBasedRandomization(
    tokens: PhraseToken[], 
    posRandomP: Record<POS, number>, 
    rng: RNG
  ): PhraseToken[] {
    return tokens.map(token => {
      const candidates: POS[] = token.pos ? [token.pos] : (token.posSet || []);
      const maxP = candidates.reduce((m, pos) => 
        Math.max(m, (posRandomP[pos] || 0) / 100), 0
      );
      
      if (maxP > 0 && this.isRandomizable(token) && rng.next() < maxP) {
        return { ...token, randomize: true };
      }
      
      return token;
    });
  }

  private applyRegexRandomization(
    tokens: PhraseToken[], 
    config: SlotRandomizationConfig, 
    rng: RNG
  ): PhraseToken[] {
    try {
      const regex = new RegExp(config.regexText, 'i');
      const phraseText = tokens.map(t => t.text).join(' ');
      
      if (!regex.test(phraseText)) {
        return tokens;
      }

      const p = Math.max(0, Math.min(100, config.regexRandomizeP)) / 100;
      return tokens.map(token => {
        if (this.isRandomizable(token) && rng.next() < p) {
          return { ...token, randomize: true };
        }
        return token;
      });
    } catch (error) {
      console.warn('Invalid regex pattern for randomization:', config.regexText);
      return tokens;
    }
  }

  private isRandomizable(token: PhraseToken): boolean {
    return typeof token.text === 'string' && /[A-Za-z]/.test(token.text);
  }
}

export class SimpleSlotRandomization implements SlotRandomizationStrategy {
  randomize(tokens: PhraseToken[], config: SlotRandomizationConfig, rng?: RNG): PhraseToken[] {
    const rngInstance = rng || { next: () => Math.random() };
    return tokens.map(token => {
      if (this.isRandomizable(token) && rngInstance.next() < 0.3) { // 30% default probability
        return { ...token, randomize: true };
      }
      return token;
    });
  }

  private isRandomizable(token: PhraseToken): boolean {
    return typeof token.text === 'string' && /[A-Za-z]/.test(token.text);
  }
}
