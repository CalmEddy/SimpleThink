import winkNLP from 'wink-nlp';
import type { PhraseChunk } from '../types/index.js';

// Initialize winkNLP with error handling
let nlp: any = null;
let isInitialized = false;
let MODEL_HAS_NER = false;

// Create fallback NLP instance
const createFallbackNLP = () => ({
  readDoc: (text: string) => ({
    tokens: () => ({
      each: (callback: (token: any, index?: number) => void) => {
        // Preprocess contractions in fallback mode too
        const preprocessedText = text
          .replace(/(\w+)'s\b/g, '$1')  // Remove possessive 's (nature's -> nature)
          .replace(/(\w+)'re\b/g, '$1 are')  // Handle "they're" -> "they are"
          .replace(/(\w+)'ve\b/g, '$1 have')  // Handle "I've" -> "I have"
          .replace(/(\w+)'ll\b/g, '$1 will')  // Handle "I'll" -> "I will"
          .replace(/(\w+)'d\b/g, '$1 would')  // Handle "I'd" -> "I would"
          .replace(/(\w+)'m\b/g, '$1 am')     // Handle "I'm" -> "I am"
          .replace(/(\w+)n't\b/g, '$1 not')   // Handle "don't" -> "do not"
          .replace(/\bcan't\b/g, 'cannot')    // Handle "can't" -> "cannot"
          .replace(/\bwon't\b/g, 'will not')  // Handle "won't" -> "will not"
          .replace(/\bshan't\b/g, 'shall not'); // Handle "shan't" -> "shall not"
          
        preprocessedText.split(/\s+/).forEach((word, index) => {
          // Skip punctuation
          if (/^[^\w\s]+$/.test(word)) {
            return;
          }
          
          // Use suffix-based heuristics as fallback
          let posTag = guessPOSBySuffix(word);
          
          callback({
            out: () => word,
            index: () => index,
            lemma: word.replace(/[^\w]/g, '').toLowerCase(), // Simple fallback without broken rules
            pos: posTag
          }, index);
        });
      }
    }),
    entities: () => ({
      each: (callback: (entity: any) => void) => {
        // Simple fallback NER: detect capitalized words as potential proper nouns
        const words = text.split(/\s+/);
        const entities: string[] = [];
        
        // Look for capitalized words that might be proper nouns
        for (let i = 0; i < words.length; i++) {
          const word = words[i].replace(/[^\w]/g, '');
          if (word.length > 0 && word[0] === word[0].toUpperCase() && word.length > 1) {
            entities.push(word);
          }
        }
        
        // Create entity objects for each detected proper noun
        entities.forEach(entityText => {
          callback({
            out: () => entityText,
            tokens: () => ({
              each: (tokenCallback: (token: any) => void) => {
                // Find the token indices for this entity
                const words = text.split(/\s+/);
                for (let i = 0; i < words.length; i++) {
                  const word = words[i].replace(/[^\w]/g, '');
                  if (word.toLowerCase() === entityText.toLowerCase()) {
                    tokenCallback({
                      index: () => i,
                      out: () => word
                    });
                  }
                }
              }
            })
          });
        });
      }
    })
  })
});

// Additional helper functions for robust NER detection
const its = () => nlp.its;

// Helper functions
const isPunctuationToken = (t: any): boolean => {
  const p = t.out(its().pos);
  if (p === 'PUNCT') return true;
  const v = t.out(its().value);
  return isPunctValue(v);
};

const isCapitalizedWord = (raw: string): boolean => {
  return /^[A-Z][a-zA-Z']*$/.test(raw); // supports "Lincoln's" sans trailing apostrophe-s
};

// Preserve case; only normalize smart quotes → ASCII straight quotes
const preprocessContractionsPreserveCase = (s: string): string => {
  return s
    .replace(/\u2019/g, "'") // right single quote
    .replace(/\u2018/g, "'"); // left single quote
};

const isPunctValue = (v: string): boolean => {
  return /^[^\w\s]+$/.test(v);
};

const isTokenCapitalizedOrAcronym = (v: string): boolean => {
  // Handles "Andrew", "Jackson", "NASA", "U.S." (tokenized as separate pieces)
  return /^[A-Z][a-zA-Z']*$/.test(v) || /^[A-Z]{2,}$/.test(v);
};

const NAME_LIKE_TYPES = new Set([
  'PERSON',
  'ORG',
  'GPE',
  'LOC',
  'PRODUCT',
  'WORK_OF_ART',
  'EVENT',
]);

// Helper function for suffix-based POS guessing (used in fallback)
const guessPOSBySuffix = (word: string): string => {
  // Suffix-based POS heuristics (similar to wordAnalysis.ts)
  const NOUN_SUFFIX = [/tion$/, /ment$/, /ness$/, /ity$/, /ship$/, /(er|or)$/, /ter$/];
  const VERB_SUFFIX = [/ize$/, /ise$/, /ify$/, /ate$/, /er$/];
  const ADJ_SUFFIX = [/al$/, /ive$/, /ous$/, /(able|ible)$/, /ic$/, /ish$/, /less$/, /ful$/, /est$/];
  const ADV_SUFFIX = [/ly$/];
  
  const lower = word.toLowerCase();
  
  // Check suffixes in order of specificity
  if (ADJ_SUFFIX.some(rx => rx.test(lower))) return 'ADJ';
  if (ADV_SUFFIX.some(rx => rx.test(lower))) return 'ADV';
  if (VERB_SUFFIX.some(rx => rx.test(lower))) return 'VERB';
  if (NOUN_SUFFIX.some(rx => rx.test(lower))) return 'NOUN';
  
  // Default fallback
  return 'NOUN';
};

// Probe NER capability
const probeNerCapability = (nlpInst: typeof nlp): boolean => {
  try {
    const doc = nlpInst.readDoc('George Washington met Thomas Edison in Paris.');
    const ents = doc.entities().out(nlpInst.its.detail) as any[];
    // Require at least one entity with a type key.
    return Array.isArray(ents) && ents.some((e) => e && typeof e.type === 'string' && e.type.length > 0);
  } catch {
    return false;
  }
};

// Initialize NLP asynchronously
const initializeNLP = async () => {
  if (isInitialized) return;
  
  try {
    // Always use real winkNLP; never swap it out.
    const { default: model } = await import('wink-eng-lite-web-model');
    nlp = winkNLP(model);
    console.log('[NLP] winkNLP model loaded');

    // Probe NER capability but DO NOT replace nlp if absent.
    MODEL_HAS_NER = probeNerCapability(nlp);
    console.info(`[NLP] NER capability: ${MODEL_HAS_NER ? 'present' : 'absent'}`);
  } catch (error) {
    console.error('[NLP] Failed to load winkNLP model:', error);
    throw error; // let caller catch; avoids silently running a broken fallback
  }
  
  isInitialized = true;
};

// Initialize nlp as null - will be set by initializeNLP()
nlp = null as any;

export interface AnalysisResult {
  tokens: string[];
  lemmas: string[];
  pos: string[];
  morphFeatures: string[]; // NEW: morphological features
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
    await initializeNLP();

    // IMPORTANT: do not lowercase before readDoc
    const preprocessed = preprocessContractionsPreserveCase(text);
    const doc = nlp.readDoc(preprocessed);

    const I = its(); // shorthand

    const tokens: string[] = [];
    const lemmas: string[] = [];
    const pos: string[] = [];
    const morphFeatures: string[] = []; // NEW: morphological features

    // Map the doc token index → our compacted array index (since we skip punctuation)
    const docIdxToArrIdx = new Map<number, number>();

    // 1) First pass: collect tokens/lemmas/pos; skip punctuation in OUTPUT arrays
    doc.tokens().each((t: any) => {
      const docIdx = t.out(I.index) as number;
      const val = t.out(I.value);
      const tag = t.out(I.pos);

      if (!isPunctuationToken(t)) {
        const arrIdx = tokens.length;
        tokens.push(val);

        let lemma = val; // fallback
        try {
          const l = t.out(I.lemma);
          if (l) lemma = l;
        } catch {
          // keep fallback
        }
        lemmas.push(lemma);
        pos.push(tag);
        
        // NEW: Extract morphological features
        let morph = '';
        try {
          // Try to get morphological features from winkNLP
          const morphInfo = t.out(I.morph);
          if (morphInfo) {
            morph = morphInfo;
          }
        } catch {
          // Fallback: infer from token form
          morph = inferMorphFromToken(val, lemma, tag);
        }
        morphFeatures.push(morph);
        
        docIdxToArrIdx.set(docIdx, arrIdx);
      }
    });

    // 2) Second pass: upgrade NOUN→PROPN for entity tokens (NER) or capitalized runs (NER-lite)
    if (MODEL_HAS_NER) {
      doc.entities().each((ent: any) => {
        // Consider only name-like entity types
        const et = ent.out(I.type);
        if (!NAME_LIKE_TYPES.has(et)) return;

        ent.tokens().each((t: any) => {
          const dIdx = t.out(I.index) as number;
          const aIdx = docIdxToArrIdx.get(dIdx);
          if (aIdx != null && pos[aIdx] === 'NOUN') pos[aIdx] = 'PROPN';
        });
      });
    } else {
      // NER-lite: upgrade consecutive CAPITALIZED tokens & all-caps acronyms
      const details = doc.tokens().out(I.detail) as Array<{ value: string; pos: string; index: number }>;
      let runStart = -1;
      for (let i = 0; i < details.length; i++) {
        const d = details[i];
        if (isTokenCapitalizedOrAcronym(d.value) && !isPunctValue(d.value)) {
          if (runStart === -1) runStart = i;
        } else {
          if (runStart !== -1 && i - runStart >= 1) {
            for (let j = runStart; j < i; j++) {
              const aIdx = docIdxToArrIdx.get(details[j].index);
              if (aIdx != null && pos[aIdx] === 'NOUN') pos[aIdx] = 'PROPN';
            }
          }
          runStart = -1;
        }
      }
      // tail
      if (runStart !== -1) {
        for (let j = runStart; j < details.length; j++) {
          const aIdx = docIdxToArrIdx.get(details[j].index);
          if (aIdx != null && pos[aIdx] === 'NOUN') pos[aIdx] = 'PROPN';
        }
      }
    }

    return { tokens, lemmas, pos, morphFeatures };
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

  private preprocessContractions(text: string): string {
    // Handle common contractions to prevent them from being split into separate tokens
    // This ensures that "nature's" stays as one token instead of becoming "nature" and "'s"
    return text
      .replace(/(\w+)'s\b/g, '$1')  // Remove possessive 's (nature's -> nature)
      .replace(/(\w+)'re\b/g, '$1 are')  // Handle "they're" -> "they are"
      .replace(/(\w+)'ve\b/g, '$1 have')  // Handle "I've" -> "I have"
      .replace(/(\w+)'ll\b/g, '$1 will')  // Handle "I'll" -> "I will"
      .replace(/(\w+)'d\b/g, '$1 would')  // Handle "I'd" -> "I would"
      .replace(/(\w+)'m\b/g, '$1 am')     // Handle "I'm" -> "I am"
      .replace(/(\w+)n't\b/g, '$1 not')   // Handle "don't" -> "do not"
      .replace(/\bcan't\b/g, 'cannot')    // Handle "can't" -> "cannot"
      .replace(/\bwon't\b/g, 'will not')  // Handle "won't" -> "will not"
      .replace(/\bshan't\b/g, 'shall not'); // Handle "shan't" -> "shall not"
  }

  private guessPOSBySuffix(word: string): string {
    // Suffix-based POS heuristics (similar to wordAnalysis.ts)
    const NOUN_SUFFIX = [/tion$/, /ment$/, /ness$/, /ity$/, /ship$/, /(er|or)$/, /ter$/];
    const VERB_SUFFIX = [/ize$/, /ise$/, /ify$/, /ate$/, /er$/];
    const ADJ_SUFFIX = [/al$/, /ive$/, /ous$/, /(able|ible)$/, /ic$/, /ish$/, /less$/, /ful$/, /est$/];
    const ADV_SUFFIX = [/ly$/];
    
    const lower = word.toLowerCase();
    
    // Check suffixes in order of specificity
    if (ADJ_SUFFIX.some(rx => rx.test(lower))) return 'ADJ';
    if (ADV_SUFFIX.some(rx => rx.test(lower))) return 'ADV';
    if (VERB_SUFFIX.some(rx => rx.test(lower))) return 'VERB';
    if (NOUN_SUFFIX.some(rx => rx.test(lower))) return 'NOUN';
    
    // Default fallback
    return 'NOUN';
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
      'PROPN': 'PROPN', // Keep proper nouns as PROPN
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
      if (pos[i] === 'NOUN' || pos[i] === 'PROPN') {
        // Look for NP patterns: (DET|ADJ|PROPN)* (NOUN|PROPN) (ADP (DET|ADJ|PROPN)* (NOUN|PROPN))?
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
                 (pos[end + 1] === 'DET' || pos[end + 1] === 'ADJ' || pos[end + 1] === 'NOUN' || pos[end + 1] === 'PROPN')) {
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
                pos[end + 1] === 'DET' || pos[end + 1] === 'ADJ' || pos[end + 1] === 'NOUN' || pos[end + 1] === 'PROPN')) {
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
        // Look for PP patterns: ADP (DET|ADJ|PROPN)* (NOUN|PROPN)
        let start = i;
        let end = i;
        
        // Look forwards for the object of the preposition
        while (end + 1 < pos.length && 
               (pos[end + 1] === 'DET' || pos[end + 1] === 'ADJ' || pos[end + 1] === 'NOUN' || pos[end + 1] === 'PROPN')) {
          end++;
        }
        
        // Only create chunk if it's 3-8 tokens and has a noun or proper noun
        if (end - start + 1 >= 3 && end - start + 1 <= 8 && 
            (pos.slice(start + 1, end + 1).includes('NOUN') || pos.slice(start + 1, end + 1).includes('PROPN'))) {
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
      // Compound nouns (including proper nouns)
      'NOUN-NOUN',
      'PROPN-PROPN',
      'NOUN-PROPN',
      'PROPN-NOUN',
      
      // Meaningful noun phrases (including proper nouns)
      'DET-ADJ-NOUN',
      'DET-ADJ-PROPN',
      'ADJ-ADJ-NOUN', 
      'ADJ-ADJ-PROPN',
      'DET-ADJ-ADJ-NOUN',
      'DET-ADJ-ADJ-PROPN',
      'DET-NOUN-NOUN',
      'DET-PROPN-PROPN',
      'DET-NOUN-PROPN',
      'DET-PROPN-NOUN',
      'ADJ-NOUN-NOUN',
      'ADJ-PROPN-PROPN',
      'ADJ-NOUN-PROPN',
      'ADJ-PROPN-NOUN',
      'DET-ADJ-NOUN-NOUN',
      'DET-ADJ-PROPN-PROPN',
      'DET-ADJ-NOUN-PROPN',
      'DET-ADJ-PROPN-NOUN',
      
      // Prepositional phrases (including proper nouns)
      'NOUN-ADP-NOUN',
      'NOUN-ADP-PROPN',
      'PROPN-ADP-NOUN',
      'PROPN-ADP-PROPN',
      'DET-NOUN-ADP-NOUN',
      'DET-NOUN-ADP-PROPN',
      'DET-PROPN-ADP-NOUN',
      'DET-PROPN-ADP-PROPN',
      'ADJ-NOUN-ADP-NOUN',
      'ADJ-NOUN-ADP-PROPN',
      'ADJ-PROPN-ADP-NOUN',
      'ADJ-PROPN-ADP-PROPN',
      'DET-ADJ-NOUN-ADP-NOUN',
      'DET-ADJ-NOUN-ADP-PROPN',
      'DET-ADJ-PROPN-ADP-NOUN',
      'DET-ADJ-PROPN-ADP-PROPN',
      
      // Meaningful verb phrases (including proper nouns)
      'AUX-VERB-NOUN',
      'AUX-VERB-PROPN',
      'VERB-ADP-NOUN',
      'VERB-ADP-PROPN',
      'AUX-VERB-ADP-NOUN',
      'AUX-VERB-ADP-PROPN',
      'VERB-DET-NOUN',
      'VERB-DET-PROPN',
      'AUX-VERB-DET-NOUN',
      'AUX-VERB-DET-PROPN',
      'VERB-ADJ-NOUN',
      'VERB-ADJ-PROPN',
      'AUX-VERB-ADJ-NOUN',
      'AUX-VERB-ADJ-PROPN'
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
    
    // Generate unique ID by including timestamp and random component to avoid duplicates
    const uniqueId = `${type}:${start}:${end}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
    
    return {
      id: uniqueId,
      text: chunkLemmas.join(' '),
      lemmas: chunkLemmas,
      posPattern,
      span: [start, end],
      score: this.calculateChunkScore(chunkLemmas, chunkPos, end - start + 1),
    };
  }

  private calculateChunkScore(lemmas: string[], pos: string[], length: number): number {
    const pattern = pos.join('-');
    
    // Special exception: NOUN-NOUN and PROPN patterns are allowed even with 2 tokens
    // These represent compound nouns like 'coffee cup', 'cherry pie', 'Andrew Jackson', etc.
    if ((pattern === 'NOUN-NOUN' || pattern === 'PROPN-PROPN' || pattern === 'NOUN-PROPN' || pattern === 'PROPN-NOUN') && length === 2) {
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
      
      // Extra bonus for proper noun compounds (names, places, etc.)
      if (pattern.includes('PROPN')) {
        score += 0.5;
      }
      
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
    
    // Pattern bonus for meaningful patterns (including PROPN patterns)
    const meaningfulPatterns = ['NOUN-NOUN', 'PROPN-PROPN', 'DET-ADJ-NOUN', 'DET-ADJ-PROPN', 'VERB-ADP-NOUN', 'VERB-ADP-PROPN', 'NOUN-ADP-NOUN', 'PROPN-ADP-PROPN'];
    if (meaningfulPatterns.some(meaningful => pattern.includes(meaningful))) {
      score += 0.5;
    }
    
    // Extra bonus for proper noun patterns
    if (pattern.includes('PROPN')) {
      score += 0.3;
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
    
    // Check if shorter chunk's span is contained within longer chunk's span
    return shorterChunk.span[0] >= longerChunk.span[0] && 
           shorterChunk.span[1] <= longerChunk.span[1];
  }
}

/**
 * Test a word in different grammatical contexts to discover all possible POS tags
 */
export async function testWordInContexts(word: string): Promise<{
  contexts: Array<{sentence: string, pos: string}>;
  uniquePOS: string[];
  isPolysemous: boolean;
}> {
  const testSentences = [
    `The ${word} is here`,           // Noun context
    `I ${word} the items`,           // Verb context
    `This is a ${word} solution`,    // Adjective context
    `He ${word}s carefully`,         // Verb with inflection
    `The ${word} of knowledge`,      // Noun with preposition
    `We need to ${word}`,            // Verb infinitive
    `A big ${word}`,                 // Noun with adjective
    `The ${word} apple`,             // Adjective before noun
    `It looks ${word}`,              // Adjective after linking verb
    `The ${word}ly spoken words`,    // Adverb context (if applicable)
  ];
  
  const results = [];
  const uniquePOS = new Set<string>();
  
  for (const sentence of testSentences) {
    try {
      const analysis = await analyzeText(sentence);
      const wordIndex = analysis.tokens.findIndex(t => 
        t.toLowerCase() === word.toLowerCase()
      );
      
      if (wordIndex !== -1) {
        const pos = analysis.pos[wordIndex];
        results.push({ sentence, pos });
        uniquePOS.add(pos);
      }
    } catch (error) {
      console.warn(`Failed to analyze sentence: ${sentence}`, error);
    }
  }
  
  return {
    contexts: results,
    uniquePOS: Array.from(uniquePOS),
    isPolysemous: uniquePOS.size > 1
  };
}

// Export singleton instance and convenience functions
export const nlpAnalyzer = NLPAnalyzer.getInstance();

export const analyzeText = async (text: string): Promise<AnalysisResult> => nlpAnalyzer.analyzeText(text);
export const inferPosPattern = (pos: string[]): string => nlpAnalyzer.inferPosPattern(pos);
export const extractChunks = (lemmas: string[], pos: string[]): PhraseChunk[] => 
  nlpAnalyzer.extractChunks(lemmas, pos);

// NEW: Helper function to infer morphological features from token form
function inferMorphFromToken(token: string, lemma: string, pos: string): string {
  if (pos === 'VERB') {
    if (token.endsWith('ing')) return 'participle';
    if (token.endsWith('ed')) return 'past';
    if (token.endsWith('s') && token !== lemma) return 'present_3rd';
    return 'base';
  }
  if (pos === 'ADJ') {
    if (token.endsWith('er')) return 'comparative';
    if (token.endsWith('est')) return 'superlative';
    return 'base';
  }
  return 'base';
}