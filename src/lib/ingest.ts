import { v4 as uuidv4 } from 'uuid';
import type { SemanticGraphLite } from './semanticGraphLite.js';
import type { PhraseNode, PhraseChunk } from '../types/index.js';
import { analyzeText, extractChunks } from './nlp.js';
import { recordChunks } from './chunkCatalog.js';
import { analyzePotentialPOS, getPOSGuessSources } from './posHeuristics.js';
import { isStopWord, isOnlyStopWords, getStopWordRatio } from './stopWords.js';

export interface IngestionResult {
  phrase: PhraseNode;
  wordsCreated: number;
  chunksExtracted: number;
}

export class IngestionPipeline {
  private static instance: IngestionPipeline;
  
  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): IngestionPipeline {
    if (!IngestionPipeline.instance) {
      IngestionPipeline.instance = new IngestionPipeline();
    }
    return IngestionPipeline.instance;
  }

  async ingestPhraseText(text: string, graph: SemanticGraphLite): Promise<IngestionResult> {
    // Step 1: NLP analysis
    const { tokens, lemmas, pos } = await analyzeText(text);
    
    if (tokens.length === 0) {
      throw new Error('No tokens found in text');
    }

    // Check if phrase is only stop words
    const contentWords = tokens.filter(token => !isStopWord(token));
    if (contentWords.length === 0) {
      throw new Error('Phrase contains only stop words and cannot be ingested');
    }

    // Check if phrase has too many stop words (more than 70%)
    const stopWordRatio = getStopWordRatio(tokens);
    if (stopWordRatio > 0.7) {
      throw new Error(`Phrase has too many stop words (${(stopWordRatio * 100).toFixed(1)}%). Maximum allowed is 70%.`);
    }

    // Step 2: Build/merge WORD nodes for distinct lemmas (only non-stop words)
    const wordIds: string[] = [];
    const wordMap = new Map<string, string>(); // lemma -> wordId
    
    tokens.forEach((token, index) => {
      // Only create word nodes for non-stop words
      if (!isStopWord(token)) {
        const lemma = lemmas[index];
        if (!wordMap.has(lemma)) {
          // Use POS heuristics to get potential POS tags
          const potentialPOS = analyzePotentialPOS(lemma, pos[index]); // Use lemma instead of token
          const sources = getPOSGuessSources(lemma, pos[index]); // Use lemma instead of token
          
          // Create word with normalized lemma as both text and lemma
          const word = graph.upsertWord(lemma, lemma, potentialPOS, pos[index]);
          
          // Update the word with POS potential sources if it's a new word
          if (word.posPotentialSource?.includes('initial')) {
            word.posPotentialSource = sources;
          }
          
          wordMap.set(lemma, word.id);
        } else {
          // Update existing word with current POS observation
          graph.upsertWord(lemma, lemma, [], pos[index]); // Use lemma instead of token
        }
        wordIds.push(wordMap.get(lemma)!);
      } else {
        // For stop words, we don't create word nodes, but we need to maintain
        // the wordIds array alignment with the original tokens
        wordIds.push(''); // Placeholder for stop words
      }
    });

    // Step 3: Compute phrase posPattern (using original POS)
    const posPattern = this.inferPosPattern(pos);

    // Step 4: Create/merge PHRASE node (using original lemmas and POS, but filtered wordIds)
    // Filter out empty word IDs (placeholders for stop words)
    const validWordIds = wordIds.filter(id => id !== '');
    const phrase = graph.upsertPhrase(text, lemmas, posPattern, validWordIds, undefined, pos);

    // Step 5: Extract chunks and attach to phrase (using original data)
    const chunks = extractChunks(lemmas, pos);
    const topChunks = chunks.slice(0, 8); // Cap to top K=8 by score
    graph.addChunksToPhrase(phrase.id, topChunks);

    // Step 6: Update chunk catalog
    recordChunks(phrase.id, topChunks);

    return {
      phrase,
      wordsCreated: wordMap.size,
      chunksExtracted: topChunks.length,
    };
  }

  promoteChunk(parentPhraseId: string, chunkId: string, graph: SemanticGraphLite): PhraseNode | null {
    // Find the parent phrase
    const parentPhrase = graph.getNodesByType('PHRASE').find(p => p.id === parentPhraseId) as PhraseNode;
    if (!parentPhrase) {
      throw new Error(`Parent phrase ${parentPhraseId} not found`);
    }

    // Find the chunk
    const chunk = parentPhrase.chunks.find(c => c.id === chunkId);
    if (!chunk) {
      throw new Error(`Chunk ${chunkId} not found in phrase ${parentPhraseId}`);
    }
    
    // Validate chunk length (must be at least 3 tokens)
    const tokenCount = chunk.span[1] - chunk.span[0] + 1;
    if (tokenCount < 3) {
      throw new Error(`Chunk too short to promote (must be ≥ 3 tokens, got ${tokenCount}).`);
    }

    // Check if chunk has enough content words (not just stop words)
    const contentWords = chunk.lemmas.filter(lemma => !isStopWord(lemma));
    if (contentWords.length < 2) {
      throw new Error(`Chunk becomes too short after filtering stop words (${contentWords.length} content words remaining, minimum 2 required).`);
    }

    // Create WORD nodes for chunk lemmas (only non-stop words)
    const chunkWordIds: string[] = [];
    const chunkPosArray = chunk.posPattern.split('-');
    
    chunk.lemmas.forEach((lemma, index) => {
      // Only create word nodes for non-stop words
      if (!isStopWord(lemma)) {
        // Find existing word or create new one
        const existingWords = graph.getNodesByType('WORD');
        let word = existingWords.find(w => w.lemma === lemma) as any;
        
        if (!word) {
          // Create new word node with POS heuristics
          const chunkPOS = chunkPosArray[index] || 'X';
          const potentialPOS = analyzePotentialPOS(lemma, chunkPOS);
          const sources = getPOSGuessSources(lemma, chunkPOS);
          
          word = graph.upsertWord(lemma, lemma, potentialPOS, chunkPOS);
          
          // Update the word with POS potential sources if it's a new word
          if (word.posPotentialSource?.includes('initial')) {
            word.posPotentialSource = sources;
          }
        } else {
          // Update existing word with current POS observation
          const chunkPOS = chunkPosArray[index] || 'X';
          graph.upsertWord(lemma, lemma, [], chunkPOS);
        }
        
        chunkWordIds.push(word.id);
      } else {
        // For stop words, we don't create word nodes, but we need to maintain
        // the wordIds array alignment with the original chunk lemmas
        chunkWordIds.push(''); // Placeholder for stop words
      }
    });

    // Create new PHRASE node from chunk (preserving original lemmas and POS)
    // Filter out empty word IDs (placeholders for stop words)
    const validChunkWordIds = chunkWordIds.filter(id => id !== '');
    const promotedPhrase = graph.upsertPhrase(
      chunk.text,
      chunk.lemmas,
      chunk.posPattern,
      validChunkWordIds,
      parentPhraseId, // derivedFromId
      chunkPosArray // wordPOS
    );

    return promotedPhrase;
  }

  private inferPosPattern(pos: string[]): string {
    // Convert to compact pattern format
    const pattern = pos
      .map(p => this.normalizePosTag(p))
      .join('-');
    
    return pattern;
  }

  private normalizePosTag(pos: string): string {
    // Map to our canonical format
    const posMap: Record<string, string> = {
      'NOUN': 'NOUN',
      'PROPN': 'NOUN',
      'VERB': 'VERB',
      'ADJ': 'ADJ',
      'ADV': 'ADV',
      'ADP': 'ADP',
      'DET': 'DET',
      'AUX': 'AUX',
      'PART': 'PART',
      'PRON': 'PRON',
      'NUM': 'NUM',
      'PUNCT': 'PUNCT',
      'SYM': 'SYM',
      'X': 'X',
    };
    
    return posMap[pos] || 'X';
  }
}

// Export singleton instance and convenience functions
export const ingestionPipeline = IngestionPipeline.getInstance();

export const ingestPhraseText = async (text: string, graph: SemanticGraphLite): Promise<IngestionResult> => 
  ingestionPipeline.ingestPhraseText(text, graph);

export const promoteChunk = (parentPhraseId: string, chunkId: string, graph: SemanticGraphLite): PhraseNode | null => 
  ingestionPipeline.promoteChunk(parentPhraseId, chunkId, graph);
