import winkNLP from 'wink-nlp';
import type { PhraseChunk } from '../types/index.js';

// Initialize winkNLP with error handling
let nlp: any = null;
let isInitialized = false;

// Create fallback NLP instance
const createFallbackNLP = () => ({
  readDoc: (text: string) => ({
    tokens: () => ({
      each: (callback: (token: any) => void) => {
        text.split(/\s+/).forEach((word) => {
          // Skip punctuation
          if (/^[^\w\s]+$/.test(word)) {
            return;
          }
          
          // Simple fallback - no custom heuristics
          let posTag = 'NOUN';
          
          callback({
            out: () => word,
            lemma: word.replace(/[^\w]/g, '').toLowerCase(), // Simple fallback without broken rules
            pos: posTag
          });
        });
      }
    })
  })
});

// Initialize NLP asynchronously
const initializeNLP = async () => {
  if (isInitialized) return;
  
  try {
    // Try to import the model with ES module syntax
    const model = await import('wink-eng-lite-web-model');
    nlp = winkNLP(model.default || model);
    console.log('NLP model loaded successfully');
  } catch (error) {
    console.error('Failed to load NLP model, using fallback:', error);
    nlp = createFallbackNLP();
  }
  
  isInitialized = true;
};

// Initialize with fallback immediately
nlp = createFallbackNLP();

export interface AnalysisResult {
  tokens: string[];
  lemmas: string[];
  pos: string[];
}

export class NLPAnalyzer {
  private static instance: NLPAnalyzer;
  
  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): NLPAnalyzer {
    if (!NLPAnalyzer.instance) {
      NLPAnalyzer.instance = new NLPAnalyzer();
    }
    return NLPAnalyzer.instance;
  }

  async analyzeText(text: string): Promise<AnalysisResult> {
    // Ensure NLP is initialized
    await initializeNLP();
    
    try {
      const doc = nlp.readDoc(text);

      const tokens: string[] = [];
      const lemmas: string[] = [];
      const pos: string[] = [];

      doc.tokens().each((token: any) => {
        const tokenText = token.out();
        
        // Skip punctuation tokens entirely
        if (this.isPunctuation(tokenText)) {
          return;
        }
        
        tokens.push(tokenText);

        // Use winkNLP's lemmatization with the correct API
        let lemma = tokenText; // fallback
        try {
          lemma = token.out(nlp.its.lemma);
        } catch (e) {
          console.warn('winkNLP lemma failed, using fallback:', e);
          lemma = this.normalizeWord(tokenText);
        }
        
        // Use winkNLP's POS tagging with the correct API
        let posTag = 'NOUN'; // fallback
        try {
          posTag = token.out(nlp.its.pos);
        } catch (e) {
          console.warn('winkNLP pos failed, using fallback:', e);
          posTag = 'NOUN'; // Simple fallback
        }

        lemmas.push(lemma);
        pos.push(posTag);
      });

      return { tokens, lemmas, pos };
    } catch (error) {
      console.error('Error in analyzeText:', error);
      // Return fallback result with better defaults
      const words = text.split(/\s+/).filter(word => !this.isPunctuation(word));
      return {
        tokens: words,
        lemmas: words.map(w => w.replace(/[^\w]/g, '').toLowerCase()), // Simple fallback without broken rules
        pos: words.map(() => 'NOUN') // Simple fallback - no custom heuristics
      };
    }
  }

  inferPosPattern(pos: string[]): string {
    // Convert to compact pattern format
    const pattern = pos
      .map(p => this.normalizePosTag(p))
      .join('-');
    
    return pattern;
  }

  extractChunks(lemmas: string[], pos: string[]): PhraseChunk[] {
    const normalizedPos = pos.map(p => this.normalizePosTag(p));
    
    // Extract only meaningful patterns
    const chunks = this.extractMeaningfulChunks(lemmas, normalizedPos);
    
    // Filter by length (3-8 tokens, except NOUN-NOUN which can be 2 tokens)
    const filteredChunks = chunks.filter(chunk => {
      const tokenCount = chunk.span[1] - chunk.span[0] + 1;
      const pattern = chunk.posPattern;
      
      // Allow NOUN-NOUN patterns with 2 tokens, but exclude pronouns
      if (pattern === 'NOUN-NOUN' && tokenCount === 2) {
        // Check if either word is a pronoun - if so, reject this chunk
        const startIndex = chunk.span[0];
        const endIndex = chunk.span[1];
        const actualPos = pos.slice(startIndex, endIndex + 1);
        
        // Reject if any word is a pronoun
        if (actualPos.includes('PRON')) {
          return false;
        }
        
        return true;
      }
      
      return tokenCount >= 3 && tokenCount <= 8;
    });
    
    // Deduplicate and score chunks
    return this.deduplicateAndScoreChunks(filteredChunks);
  }

  private isPunctuation(text: string): boolean {
    // Check if the text is only punctuation
    return /^[^\w\s]+$/.test(text);
  }

  private normalizeWord(word: string): string {
    // Simple cleanup only - no lemmatization
    // This should only be used as a last resort when winkNLP is unavailable
    return word.replace(/[^\w]/g, '').toLowerCase();
  }

  private normalizePosTag(pos: string): string {
    // Map winkNLP POS tags to our canonical format
    const posMap: Record<string, string> = {
      'NOUN': 'NOUN',
      'PROPN': 'NOUN', // Proper noun -> NOUN
      'VERB': 'VERB',
      'ADJ': 'ADJ',
      'ADV': 'ADV',
      'ADP': 'ADP', // Preposition
      'DET': 'DET', // Determiner
      'AUX': 'AUX', // Auxiliary verb
      'PART': 'PART', // Particle
      'PRON': 'PRON', // Pronoun
      'NUM': 'NUM', // Number
      'PUNCT': 'PUNCT', // Punctuation
      'SYM': 'SYM', // Symbol
      'X': 'X', // Other
    };
    
    return posMap[pos] || 'X';
  }

  private extractNounPhrases(lemmas: string[], pos: string[]): PhraseChunk[] {
    const chunks: PhraseChunk[] = [];
    
    for (let i = 0; i < pos.length; i++) {
      if (pos[i] === 'NOUN') {
        // Look for NP patterns: (DET|ADJ|PROPN)* NOUN (ADP (DET|ADJ|PROPN)* NOUN)?
        let start = i;
        let end = i;
        
        // Look backwards for determiners and adjectives
        while (start > 0 && (pos[start - 1] === 'DET' || pos[start - 1] === 'ADJ')) {
          start--;
        }
        
        // Look forwards for prepositional phrases
        if (i + 1 < pos.length && pos[i + 1] === 'ADP') {
          end = i + 1;
          // Look for the object of the preposition
          while (end + 1 < pos.length && 
                 (pos[end + 1] === 'DET' || pos[end + 1] === 'ADJ' || pos[end + 1] === 'NOUN')) {
            end++;
          }
        }
        
        // Only create chunk if it's 3-8 tokens
        if (end - start + 1 >= 3 && end - start + 1 <= 8) {
          const chunk = this.createChunk(lemmas, pos, start, end, 'NP');
          if (chunk) chunks.push(chunk);
        }
      }
    }
    
    return chunks;
  }

  private extractVerbPhrases(lemmas: string[], pos: string[]): PhraseChunk[] {
    const chunks: PhraseChunk[] = [];
    
    for (let i = 0; i < pos.length; i++) {
      if (pos[i] === 'VERB') {
        // Look for VP patterns: (AUX)* VERB (ADV)* (PART)? (DET|ADJ|PROPN|NOUN)*
        let start = i;
        let end = i;
        
        // Look backwards for auxiliaries
        while (start > 0 && pos[start - 1] === 'AUX') {
          start--;
        }
        
        // Look forwards for adverbs, particles, and objects
        while (end + 1 < pos.length && 
               (pos[end + 1] === 'ADV' || pos[end + 1] === 'PART' || 
                pos[end + 1] === 'DET' || pos[end + 1] === 'ADJ' || pos[end + 1] === 'NOUN')) {
          end++;
        }
        
        // Only create chunk if it's 3-8 tokens
        if (end - start + 1 >= 3 && end - start + 1 <= 8) {
          const chunk = this.createChunk(lemmas, pos, start, end, 'VP');
          if (chunk) chunks.push(chunk);
        }
      }
    }
    
    return chunks;
  }

  private extractPrepositionalPhrases(lemmas: string[], pos: string[]): PhraseChunk[] {
    const chunks: PhraseChunk[] = [];
    
    for (let i = 0; i < pos.length; i++) {
      if (pos[i] === 'ADP') {
        // Look for PP patterns: ADP (DET|ADJ|PROPN)* NOUN
        let start = i;
        let end = i;
        
        // Look forwards for the object of the preposition
        while (end + 1 < pos.length && 
               (pos[end + 1] === 'DET' || pos[end + 1] === 'ADJ' || pos[end + 1] === 'NOUN')) {
          end++;
        }
        
        // Only create chunk if it's 3-8 tokens and has a noun
        if (end - start + 1 >= 3 && end - start + 1 <= 8 && 
            pos.slice(start + 1, end + 1).includes('NOUN')) {
          const chunk = this.createChunk(lemmas, pos, start, end, 'PP');
          if (chunk) chunks.push(chunk);
        }
      }
    }
    
    return chunks;
  }

  private extractMeaningfulChunks(lemmas: string[], pos: string[]): PhraseChunk[] {
    const chunks: PhraseChunk[] = [];
    
    // Define only the patterns we want to extract
    const desiredPatterns = [
      // Compound nouns
      'NOUN-NOUN',
      
      // Meaningful noun phrases
      'DET-ADJ-NOUN',
      'ADJ-ADJ-NOUN', 
      'DET-ADJ-ADJ-NOUN',
      'DET-NOUN-NOUN',
      'ADJ-NOUN-NOUN',
      'DET-ADJ-NOUN-NOUN',
      
      // Prepositional phrases
      'NOUN-ADP-NOUN',
      'DET-NOUN-ADP-NOUN',
      'ADJ-NOUN-ADP-NOUN',
      'DET-ADJ-NOUN-ADP-NOUN',
      
      // Meaningful verb phrases
      'AUX-VERB-NOUN',
      'VERB-ADP-NOUN',
      'AUX-VERB-ADP-NOUN',
      'VERB-DET-NOUN',
      'AUX-VERB-DET-NOUN',
      'VERB-ADJ-NOUN',
      'AUX-VERB-ADJ-NOUN'
    ];
    
    // Use sliding window to find these specific patterns
    for (let i = 0; i <= lemmas.length - 2; i++) {
      for (let size = 2; size <= Math.min(4, lemmas.length - i); size++) {
        const chunkPos = pos.slice(i, i + size);
        const pattern = chunkPos.join('-');
        
        // Only extract if it matches our desired patterns
        if (desiredPatterns.includes(pattern)) {
          const chunk = this.createChunk(lemmas, pos, i, i + size - 1, 'MEANINGFUL');
          if (chunk) chunks.push(chunk);
        }
      }
    }
    
    return chunks;
  }

  private createChunk(
    lemmas: string[], 
    pos: string[], 
    start: number, 
    end: number, 
    type: string
  ): PhraseChunk | null {
    if (start < 0 || end >= lemmas.length || start > end) return null;
    
    const chunkLemmas = lemmas.slice(start, end + 1);
    const chunkPos = pos.slice(start, end + 1);
    const posPattern = this.inferPosPattern(chunkPos);
    
    return {
      id: `${type}:${start}:${end}`,
      text: chunkLemmas.join(' '),
      lemmas: chunkLemmas,
      posPattern,
      span: [start, end],
      score: this.calculateChunkScore(chunkLemmas, chunkPos, end - start + 1),
    };
  }

  private calculateChunkScore(lemmas: string[], pos: string[], length: number): number {
    const pattern = pos.join('-');
    
    // Special exception: NOUN-NOUN patterns are allowed even with 2 tokens
    // These represent compound nouns like 'coffee cup', 'cherry pie', etc.
    if (pattern === 'NOUN-NOUN' && length === 2) {
      let score = 0;
      
      // Base score for compound nouns
      score += 1.0;
      
      // Word specificity bonus (longer words are more specific)
      const avgLength = lemmas.reduce((sum, lemma) => sum + lemma.length, 0) / lemmas.length;
      if (avgLength > 5) {
        score += 0.5;
      }
      
      // Pattern bonus for compound nouns
      score += 0.5;
      
      return score;
    }
    
    // Hard reject all other chunks with fewer than 3 tokens
    if (length < 3) {
      return -Infinity;
    }
    
    let score = 0;
    
    // Length bonus (prefer 3-6 tokens)
    if (length >= 3 && length <= 6) {
      score += 1;
    }
    
    // Rare lemmas bonus (simple heuristic: longer words are often more specific)
    const avgLength = lemmas.reduce((sum, lemma) => sum + lemma.length, 0) / lemmas.length;
    if (avgLength > 5) {
      score += 0.5;
    }
    
    // Pattern bonus for meaningful patterns
    const meaningfulPatterns = ['NOUN-NOUN', 'DET-ADJ-NOUN', 'VERB-ADP-NOUN', 'NOUN-ADP-NOUN'];
    if (meaningfulPatterns.some(meaningful => pattern.includes(meaningful))) {
      score += 0.5;
    }
    
    return score;
  }

  private deduplicateAndScoreChunks(chunks: PhraseChunk[]): PhraseChunk[] {
    // Sort by score (descending) to prioritize better chunks
    const sorted = chunks.sort((a, b) => b.score - a.score);
    
    const unique: PhraseChunk[] = [];
    
    for (const chunk of sorted) {
      // Check if this chunk is contained within any existing chunk
      const isContained = unique.some(existingChunk => {
        return this.isChunkContained(chunk, existingChunk);
      });
      
      // Only add if not contained within a longer chunk
      if (!isContained) {
        unique.push(chunk);
      }
    }
    
    // Return top 8 chunks
    return unique.slice(0, 8);
  }

  private isChunkContained(shorterChunk: PhraseChunk, longerChunk: PhraseChunk): boolean {
    // A chunk is contained if:
    // 1. It's shorter than the other chunk
    // 2. All its lemmas appear consecutively in the longer chunk
    // 3. The longer chunk has a higher or equal score
    
    if (shorterChunk.lemmas.length >= longerChunk.lemmas.length) {
      return false; // Can't be contained if same length or longer
    }
    
    if (shorterChunk.score > longerChunk.score) {
      return false; // Don't remove higher-scoring chunks
    }
    
    // Check if shorter chunk's lemmas appear consecutively in longer chunk
    const shorterText = shorterChunk.lemmas.join(' ');
    const longerText = longerChunk.lemmas.join(' ');
    
    return longerText.includes(shorterText);
  }
}

// Export singleton instance and convenience functions
export const nlpAnalyzer = NLPAnalyzer.getInstance();

export const analyzeText = async (text: string): Promise<AnalysisResult> => nlpAnalyzer.analyzeText(text);
export const inferPosPattern = (pos: string[]): string => nlpAnalyzer.inferPosPattern(pos);
export const extractChunks = (lemmas: string[], pos: string[]): PhraseChunk[] => 
  nlpAnalyzer.extractChunks(lemmas, pos);