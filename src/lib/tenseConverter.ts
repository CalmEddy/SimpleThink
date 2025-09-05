import winkNLP from 'wink-nlp';

// Initialize winkNLP with error handling
let nlp: any = null;
let isInitialized = false;

// Initialize NLP asynchronously
const initializeNLP = async () => {
  if (isInitialized) return;
  
  try {
    const { default: model } = await import('wink-eng-lite-web-model');
    nlp = winkNLP(model);
    console.log('[TenseConverter] winkNLP model loaded');
  } catch (error) {
    console.error('[TenseConverter] Failed to load winkNLP model:', error);
    throw error;
  }
  
  isInitialized = true;
};

// Helper to get winkNLP its
const its = () => nlp.its;

export type TenseType = 'base' | 'past' | 'participle' | 'present_3rd';

export class TenseConverter {
  private static instance: TenseConverter;
  
  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): TenseConverter {
    if (!TenseConverter.instance) {
      TenseConverter.instance = new TenseConverter();
    }
    return TenseConverter.instance;
  }

  /**
   * Convert a verb to the specified tense
   */
  async convertVerb(lemma: string, targetTense: TenseType): Promise<string> {
    await initializeNLP();

    try {
      // Create a simple sentence with the verb to get morphological analysis
      const testSentence = `I ${lemma} the ball`;
      const doc = nlp.readDoc(testSentence);
      
      const verb = doc.tokens().filter(t => t.out(its().pos) === 'VERB').first();
      if (!verb) return lemma; // fallback
      
      // Use winkNLP's morphological features to get the target form
      switch (targetTense) {
        case 'past':
          return this.getPastTense(verb, lemma);
        case 'participle':
          return this.getParticiple(verb, lemma);
        case 'present_3rd':
          return this.getPresent3rd(verb, lemma);
        case 'base':
        default:
          return lemma;
      }
    } catch (error) {
      console.warn(`Tense conversion failed for "${lemma}" to ${targetTense}:`, error);
      return this.getFallbackTense(lemma, targetTense);
    }
  }

  private getPastTense(verb: any, lemma: string): string {
    // Try to get past tense from winkNLP
    const morph = verb.out(its().morph);
    if (morph && morph.includes('past')) {
      return verb.out(its().value);
    }
    
    // Fallback: simple rule-based conversion
    return this.simplePastTense(lemma);
  }

  private getParticiple(verb: any, lemma: string): string {
    const morph = verb.out(its().morph);
    if (morph && morph.includes('participle')) {
      return verb.out(its().value);
    }
    
    // Fallback: simple rule-based conversion
    return this.simpleParticiple(lemma);
  }

  private getPresent3rd(verb: any, lemma: string): string {
    const morph = verb.out(its().morph);
    if (morph && morph.includes('present_3rd')) {
      return verb.out(its().value);
    }
    
    // Fallback: simple rule-based conversion
    return this.simplePresent3rd(lemma);
  }

  private getFallbackTense(lemma: string, targetTense: TenseType): string {
    switch (targetTense) {
      case 'past':
        return this.simplePastTense(lemma);
      case 'participle':
        return this.simpleParticiple(lemma);
      case 'present_3rd':
        return this.simplePresent3rd(lemma);
      case 'base':
      default:
        return lemma;
    }
  }

  // Simple fallback rules for common cases
  private simplePastTense(lemma: string): string {
    // Handle irregular verbs
    const irregulars: Record<string, string> = {
      'be': 'was',
      'have': 'had',
      'do': 'did',
      'go': 'went',
      'see': 'saw',
      'come': 'came',
      'take': 'took',
      'make': 'made',
      'get': 'got',
      'know': 'knew',
      'think': 'thought',
      'say': 'said',
      'tell': 'told',
      'find': 'found',
      'give': 'gave',
      'run': 'ran',
      'eat': 'ate',
      'drink': 'drank',
      'sing': 'sang',
      'write': 'wrote',
      'read': 'read',
      'break': 'broke',
      'speak': 'spoke',
      'choose': 'chose',
      'lose': 'lost',
      'win': 'won',
      'begin': 'began',
      'swim': 'swam',
      'fly': 'flew',
      'draw': 'drew',
      'grow': 'grew',
      'throw': 'threw',
      'blow': 'blew',
      'show': 'showed',
      'teach': 'taught',
      'catch': 'caught',
      'buy': 'bought',
      'fight': 'fought',
      'bring': 'brought',
      'seek': 'sought'
    };

    if (irregulars[lemma]) {
      return irregulars[lemma];
    }

    // Regular verb rules
    if (lemma.endsWith('e')) return lemma + 'd';
    if (lemma.endsWith('y') && !/[aeiou]y$/.test(lemma)) return lemma.slice(0, -1) + 'ied';
    if (lemma.endsWith('c')) return lemma + 'ked';
    return lemma + 'ed';
  }

  private simpleParticiple(lemma: string): string {
    // Handle irregular verbs
    const irregulars: Record<string, string> = {
      'be': 'been',
      'have': 'had',
      'do': 'done',
      'go': 'gone',
      'see': 'seen',
      'come': 'come',
      'take': 'taken',
      'make': 'made',
      'get': 'gotten',
      'know': 'known',
      'think': 'thought',
      'say': 'said',
      'tell': 'told',
      'find': 'found',
      'give': 'given',
      'run': 'run',
      'eat': 'eaten',
      'drink': 'drunk',
      'sing': 'sung',
      'write': 'written',
      'read': 'read',
      'break': 'broken',
      'speak': 'spoken',
      'choose': 'chosen',
      'lose': 'lost',
      'win': 'won',
      'begin': 'begun',
      'swim': 'swum',
      'fly': 'flown',
      'draw': 'drawn',
      'grow': 'grown',
      'throw': 'thrown',
      'blow': 'blown',
      'show': 'shown',
      'teach': 'taught',
      'catch': 'caught',
      'buy': 'bought',
      'fight': 'fought',
      'bring': 'brought',
      'seek': 'sought'
    };

    if (irregulars[lemma]) {
      return irregulars[lemma];
    }

    // Regular verb rules
    if (lemma.endsWith('e')) return lemma + 'ing';
    if (lemma.endsWith('ie')) return lemma.slice(0, -2) + 'ying';
    if (lemma.endsWith('c')) return lemma + 'king';
    return lemma + 'ing';
  }

  private simplePresent3rd(lemma: string): string {
    // Handle irregular verbs
    const irregulars: Record<string, string> = {
      'be': 'is',
      'have': 'has',
      'do': 'does',
      'go': 'goes',
      'say': 'says'
    };

    if (irregulars[lemma]) {
      return irregulars[lemma];
    }

    // Regular verb rules
    if (lemma.endsWith('y') && !/[aeiou]y$/.test(lemma)) return lemma.slice(0, -1) + 'ies';
    if (lemma.endsWith('s') || lemma.endsWith('sh') || lemma.endsWith('ch') || lemma.endsWith('x') || lemma.endsWith('z')) {
      return lemma + 'es';
    }
    return lemma + 's';
  }
}

// Export singleton instance
export const tenseConverter = TenseConverter.getInstance();
