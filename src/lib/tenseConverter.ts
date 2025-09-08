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

export type MorphologicalType = 'base' | 'past' | 'participle' | 'present_3rd' | 'comparative' | 'superlative' | 'plural';

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

  /**
   * Convert a word to the specified morphological form
   */
  async convertWord(lemma: string, pos: string, targetMorph: MorphologicalType): Promise<string> {
    try {
      await initializeNLP();
    } catch (error) {
      console.warn('winkNLP not available, using fallback rules:', error);
      return this.getFallbackMorph(lemma, pos, targetMorph);
    }

    try {
      // Create context sentence based on POS
      const contextSentence = this.createContextSentence(lemma, pos);
      const doc = nlp.readDoc(contextSentence);
      
      // Find the token by lemma
      const token = this.findTokenByLemma(doc, lemma);
      if (!token) {
        console.warn(`Token not found for lemma "${lemma}", using fallback`);
        return this.getFallbackMorph(lemma, pos, targetMorph);
      }
      
      // Get morphological form
      const morphForm = await this.getMorphologicalForm(token, lemma, pos, targetMorph);
      return morphForm;
    } catch (error) {
      console.warn(`Morphological conversion failed for "${lemma}" (${pos}) to ${targetMorph}:`, error);
      return this.getFallbackMorph(lemma, pos, targetMorph);
    }
  }

  /**
   * Create a context sentence for morphological analysis
   */
  private createContextSentence(lemma: string, pos: string): string {
    switch (pos) {
      case 'VERB':
        return `I ${lemma} the ball`;
      case 'ADJ':
        return `The ${lemma} cat`;
      case 'NOUN':
        return `The ${lemma} is here`;
      case 'ADV':
        return `I run ${lemma}`;
      default:
        return `The ${lemma} word`;
    }
  }

  /**
   * Find token by lemma in document
   */
  private findTokenByLemma(doc: any, lemma: string): any {
    const tokens = doc.tokens();
    if (!tokens || !tokens.filter) {
      return null;
    }
    const filtered = tokens.filter((t: any) => t.out(its().lemma) === lemma);
    return filtered && filtered.length > 0 ? filtered[0] : null;
  }

  /**
   * Get morphological form from token
   */
  private async getMorphologicalForm(token: any, lemma: string, pos: string, targetMorph: MorphologicalType): Promise<string> {
    try {
      const morph = token.out(its().morph);
      
      // Check if token already has the target morphological feature
      if (this.hasTargetMorph(morph, targetMorph)) {
        return token.out(its().value);
      }
    } catch (error) {
      console.warn('Error getting morphological features from winkNLP:', error);
    }
    
    // For adjectives, try comparative/superlative conversion
    if (pos === 'ADJ' && (targetMorph === 'comparative' || targetMorph === 'superlative')) {
      return this.convertAdjective(lemma, targetMorph);
    }
    
    // For verbs, use existing tense conversion
    if (pos === 'VERB' && ['past', 'participle', 'present_3rd'].includes(targetMorph)) {
      return await this.convertVerb(lemma, targetMorph as TenseType);
    }
    
    // For nouns, try plural conversion
    if (pos === 'NOUN' && targetMorph === 'plural') {
      return this.convertNounToPlural(lemma);
    }
    
    return lemma;
  }

  /**
   * Check if morphological features contain target form
   */
  private hasTargetMorph(morph: string, targetMorph: MorphologicalType): boolean {
    if (!morph) return false;
    
    switch (targetMorph) {
      case 'past':
        return morph.includes('past');
      case 'participle':
        return morph.includes('participle');
      case 'present_3rd':
        return morph.includes('present_3rd');
      case 'comparative':
        return morph.includes('comparative');
      case 'superlative':
        return morph.includes('superlative');
      case 'plural':
        return morph.includes('plural');
      case 'base':
      default:
        return true;
    }
  }

  /**
   * Convert adjective to comparative or superlative
   */
  private convertAdjective(lemma: string, targetMorph: MorphologicalType): string {
    if (targetMorph === 'comparative') {
      return this.simpleComparative(lemma);
    } else if (targetMorph === 'superlative') {
      return this.simpleSuperlative(lemma);
    }
    return lemma;
  }

  /**
   * Simple comparative form generation
   */
  private simpleComparative(lemma: string): string {
    // Handle irregular adjectives
    const irregulars: Record<string, string> = {
      'good': 'better',
      'bad': 'worse',
      'far': 'farther',
      'little': 'less',
      'many': 'more',
      'much': 'more'
    };

    if (irregulars[lemma]) {
      return irregulars[lemma];
    }

    // Regular rules
    if (lemma.endsWith('y') && !/[aeiou]y$/.test(lemma)) {
      return lemma.slice(0, -1) + 'ier';
    }
    if (lemma.endsWith('e')) {
      return lemma + 'r';
    }
    if (lemma.length > 2 && !lemma.endsWith('er')) {
      return lemma + 'er';
    }
    return lemma;
  }

  /**
   * Simple superlative form generation
   */
  private simpleSuperlative(lemma: string): string {
    // Handle irregular adjectives
    const irregulars: Record<string, string> = {
      'good': 'best',
      'bad': 'worst',
      'far': 'farthest',
      'little': 'least',
      'many': 'most',
      'much': 'most'
    };

    if (irregulars[lemma]) {
      return irregulars[lemma];
    }

    // Regular rules
    if (lemma.endsWith('y') && !/[aeiou]y$/.test(lemma)) {
      return lemma.slice(0, -1) + 'iest';
    }
    if (lemma.endsWith('e')) {
      return lemma + 'st';
    }
    if (lemma.length > 2 && !lemma.endsWith('est')) {
      return lemma + 'est';
    }
    return lemma;
  }

  /**
   * Convert noun to plural form
   */
  private convertNounToPlural(lemma: string): string {
    // Handle irregular plurals
    const irregulars: Record<string, string> = {
      'child': 'children',
      'man': 'men',
      'woman': 'women',
      'person': 'people',
      'foot': 'feet',
      'tooth': 'teeth',
      'mouse': 'mice',
      'goose': 'geese',
      'ox': 'oxen',
      'sheep': 'sheep',
      'deer': 'deer',
      'fish': 'fish',
      'moose': 'moose',
      'series': 'series',
      'species': 'species'
    };

    if (irregulars[lemma]) {
      return irregulars[lemma];
    }

    // Regular plural rules
    if (lemma.endsWith('y') && !/[aeiou]y$/.test(lemma)) {
      return lemma.slice(0, -1) + 'ies';
    }
    if (lemma.endsWith('s') || lemma.endsWith('sh') || lemma.endsWith('ch') || lemma.endsWith('x') || lemma.endsWith('z')) {
      return lemma + 'es';
    }
    if (lemma.endsWith('f')) {
      return lemma.slice(0, -1) + 'ves';
    }
    if (lemma.endsWith('fe')) {
      return lemma.slice(0, -2) + 'ves';
    }
    return lemma + 's';
  }

  /**
   * Fallback morphological conversion
   */
  private getFallbackMorph(lemma: string, pos: string, targetMorph: MorphologicalType): string {
    if (pos === 'ADJ' && (targetMorph === 'comparative' || targetMorph === 'superlative')) {
      return this.convertAdjective(lemma, targetMorph);
    }
    
    if (pos === 'VERB' && ['past', 'participle', 'present_3rd'].includes(targetMorph)) {
      return this.getFallbackTense(lemma, targetMorph as TenseType);
    }
    
    if (pos === 'NOUN' && targetMorph === 'plural') {
      return this.convertNounToPlural(lemma);
    }
    
    return lemma;
  }

  private getPastTense(verb: any, lemma: string): string {
    try {
      // Try to get past tense from winkNLP
      const morph = verb.out(its().morph);
      if (morph && morph.includes('past')) {
        return verb.out(its().value);
      }
    } catch (error) {
      console.warn('Error getting past tense from winkNLP:', error);
    }
    
    // Fallback: simple rule-based conversion
    return this.simplePastTense(lemma);
  }

  private getParticiple(verb: any, lemma: string): string {
    try {
      const morph = verb.out(its().morph);
      if (morph && morph.includes('participle')) {
        return verb.out(its().value);
      }
    } catch (error) {
      console.warn('Error getting participle from winkNLP:', error);
    }
    
    // Fallback: simple rule-based conversion
    return this.simpleParticiple(lemma);
  }

  private getPresent3rd(verb: any, lemma: string): string {
    try {
      const morph = verb.out(its().morph);
      if (morph && morph.includes('present_3rd')) {
        return verb.out(its().value);
      }
    } catch (error) {
      console.warn('Error getting present_3rd from winkNLP:', error);
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
