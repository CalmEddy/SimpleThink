import type { SemanticGraphLite } from './semanticGraphLite.js';
import type { ResponseNode, PhraseNode } from '../types/index.js';
import { analyzeText } from './nlp.js';
import { promoteChunk } from './ingest.js';
import { generatePosPattern, processPropnSpans } from './posNormalization.js';
import { isStopWord } from './stopWords.js';
import { analyzeWordPOS } from './posAnalysis.js';
import { IngestionPipeline } from './ingest.js';

export interface ResponseResult {
  responseNode: ResponseNode;
  wordIds: string[];
  canPromote: boolean;
  promotionSuggestion?: string;
}

export class ResponseEngine {
  private static instance: ResponseEngine;
  
  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): ResponseEngine {
    if (!ResponseEngine.instance) {
      ResponseEngine.instance = new ResponseEngine();
    }
    return ResponseEngine.instance;
  }

  async recordResponse(
    promptId: string,
    text: string,
    graph: SemanticGraphLite,
    rating?: 'like' | 'skip',
    usePhraseSplitting?: boolean
  ): Promise<ResponseResult> {
    // If phrase splitting is enabled, use the new method
    if (usePhraseSplitting) {
      const results = await this.recordResponseWithPhraseSplitting(promptId, text, graph, rating);
      // Return the first result for backward compatibility
      return results[0];
    }

    // Original single response processing
    return this.processSingleResponse(promptId, text, graph, rating);
  }

  private async processSingleResponse(
    promptId: string,
    text: string,
    graph: SemanticGraphLite,
    rating?: 'like' | 'skip'
  ): Promise<ResponseResult> {
    // Analyze the response text
    const { tokens, lemmas, pos, morphFeatures } = await analyzeText(text);
    
    if (tokens.length === 0) {
      throw new Error('No tokens found in response text');
    }

    // Use centralized PROPN span processing
    const wordMap = new Map<string, string>(); // lemma -> wordId
    
    const processWordCallback = async (token: string, lemma: string, pos: string, morphFeature?: string): Promise<string> => {
      const normalizedLemma = lemma ? lemma.toLowerCase() : token.toLowerCase();
      
      if (!wordMap.has(normalizedLemma)) {
        // Use unified POS analysis
        const analysis = await analyzeWordPOS(normalizedLemma, pos);
        
        // Create word with normalized lemma as both text and lemma
        const word = graph.upsertWord(normalizedLemma, normalizedLemma, analysis.pos, morphFeature || pos);
        
        word.isPolysemousPOS = analysis.isPolysemous;
        word.posPotential = analysis.pos;
        word.posPotentialSource = [analysis.source];
        
        wordMap.set(normalizedLemma, word.id);
      } else {
        // Update existing word with current POS observation
        graph.upsertWord(normalizedLemma, normalizedLemma, [], morphFeature || pos);
      }
      
      return wordMap.get(normalizedLemma)!;
    };

    // Process words manually since processPropnSpans doesn't support async callbacks
    const wordIds: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const lemma = lemmas[i];
      const posTag = pos[i];
      const morphFeature = morphFeatures[i];
      
      const wordId = await processWordCallback(token, lemma, posTag, morphFeature);
      wordIds.push(wordId);
    }

    // Compute POS pattern
    const posPattern = generatePosPattern(pos);

    // Create response node
    const responseNode = graph.recordResponse(
      promptId,
      text,
      lemmas,
      posPattern,
      wordIds,
      rating
    );

    // Check if response can be promoted to a phrase
    const canPromote = this.canPromoteResponse(text, tokens.length, posPattern);
    const promotionSuggestion = canPromote ? 
      'This response could be promoted to a reusable phrase' : undefined;

    return {
      responseNode,
      wordIds,
      canPromote,
      promotionSuggestion,
    };
  }

  promoteResponseToPhrase(
    responseId: string,
    graph: SemanticGraphLite
  ): PhraseNode | null {
    const response = graph.getNodesByType('RESPONSE').find(r => r.id === responseId) as ResponseNode;
    if (!response) {
      throw new Error(`Response ${responseId} not found`);
    }

    // Create a temporary chunk-like structure for promotion
    const tempChunk = {
      id: `response:${responseId}`,
      text: response.text,
      lemmas: response.lemmas,
      posPattern: response.posPattern,
      span: [0, response.lemmas.length - 1] as [number, number],
      score: this.calculateResponseScore(response),
    };

    // Create WORD nodes for response lemmas
    const wordIds: string[] = [];
    response.lemmas.forEach((lemma, index) => {
      const word = graph.upsertWord(lemma, lemma, [response.posPattern.split('-')[index] || 'X']);
      wordIds.push(word.id);
    });

    // Create new PHRASE node from response
    const promotedPhrase = graph.upsertPhrase(
      response.text,
      response.lemmas,
      response.posPattern,
      wordIds
    );

    return promotedPhrase;
  }

  rateResponse(responseId: string, rating: 'like' | 'skip', graph: SemanticGraphLite): void {
    const response = graph.getNodesByType('RESPONSE').find(r => r.id === responseId) as ResponseNode;
    if (!response) {
      throw new Error(`Response ${responseId} not found`);
    }

    // Update response rating
    response.rating = rating;

    // Update stats on related nodes
    if (rating === 'like') {
      graph.likeNode(responseId);
      // Also like the words used in the response
      response.wordIds.forEach(wordId => {
        graph.likeNode(wordId);
      });
    }

    // Update usage stats
    graph.useNode(responseId);
    response.wordIds.forEach(wordId => {
      graph.useNode(wordId);
    });
  }

  private canPromoteResponse(text: string, tokenCount: number, posPattern: string): boolean {
    // Check if response is suitable for promotion
    if (tokenCount < 2 || tokenCount > 10) {
      return false;
    }

    // Check for decent chunk pattern
    const goodPatterns = ['NOUN-VERB', 'ADJ-NOUN', 'VERB-NOUN', 'ADP-NOUN', 'NOUN-VERB-NOUN'];
    const hasGoodPattern = goodPatterns.some(pattern => posPattern.includes(pattern));
    
    if (!hasGoodPattern) {
      return false;
    }

    // Check for meaningful content (not just common words)
    const commonWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
    const words = text.toLowerCase().split(/\s+/);
    const meaningfulWords = words.filter(word => !commonWords.includes(word));
    
    return meaningfulWords.length >= 2;
  }

  private calculateResponseScore(response: ResponseNode): number {
    let score = 0;
    
    // Length bonus (prefer 2-10 tokens)
    const length = response.lemmas.length;
    if (length >= 2 && length <= 10) {
      score += 1;
    }
    
    // Pattern bonus
    const goodPatterns = ['NOUN-VERB', 'ADJ-NOUN', 'VERB-NOUN', 'ADP-NOUN'];
    if (goodPatterns.some(pattern => response.posPattern.includes(pattern))) {
      score += 0.5;
    }
    
    // Rating bonus
    if (response.rating === 'like') {
      score += 1;
    }
    
    return score;
  }

  private inferPosPattern(pos: string[]): string {
    const pattern = pos
      .map(p => this.normalizePosTag(p))
      .join('-');
    
    return pattern;
  }

  private normalizePosTag(pos: string): string {
    const posMap: Record<string, string> = {
      'NOUN': 'NOUN',
      'PROPN': 'PROPN', // Keep proper nouns as PROPN
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
      'CCONJ': 'CCONJ', // Coordinating conjunctions (and, but, or)
      'SCONJ': 'SCONJ', // Subordinating conjunctions (because, although, if)
      'X': 'X',
    };
    
    return posMap[pos] || 'X';
  }

  // New method for phrase-splitting response storage
  async recordResponseWithPhraseSplitting(
    promptId: string,
    text: string,
    graph: SemanticGraphLite,
    rating?: 'like' | 'skip'
  ): Promise<ResponseResult[]> {
    // Use existing IngestionPipeline to split text into phrases
    const ingestionPipeline = IngestionPipeline.getInstance();
    const phrases = ingestionPipeline.splitTextIntoPhrases(text);
    
    if (phrases.length === 0) {
      throw new Error('No phrases found in response text');
    }

    // Process each phrase as a separate response
    const results: ResponseResult[] = [];
    
    for (const phrase of phrases) {
      try {
        const result = await this.processSingleResponse(promptId, phrase, graph, rating);
        results.push(result);
      } catch (error) {
        // Log error but continue with other phrases
        console.warn(`Failed to process phrase "${phrase}":`, error);
      }
    }

    if (results.length === 0) {
      throw new Error('Failed to process any phrases from response text');
    }

    return results;
  }

  // Get responses for a prompt
  getResponsesForPrompt(promptId: string, graph: SemanticGraphLite): ResponseNode[] {
    return graph.getNodesByType('RESPONSE')
      .filter(response => response.promptId === promptId) as ResponseNode[];
  }

  // Get top responses by rating
  getTopResponses(graph: SemanticGraphLite, limit: number = 10): ResponseNode[] {
    return graph.getNodesByType('RESPONSE')
      .filter(response => response.rating === 'like')
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit) as ResponseNode[];
  }

  // Get response statistics
  getResponseStats(graph: SemanticGraphLite): {
    total: number;
    liked: number;
    skipped: number;
    unrated: number;
  } {
    const responses = graph.getNodesByType('RESPONSE') as ResponseNode[];
    
    return {
      total: responses.length,
      liked: responses.filter(r => r.rating === 'like').length,
      skipped: responses.filter(r => r.rating === 'skip').length,
      unrated: responses.filter(r => !r.rating).length,
    };
  }
}

// Export singleton instance and convenience functions
export const responseEngine = ResponseEngine.getInstance();

export const recordResponse = async (
  promptId: string,
  text: string,
  graph: SemanticGraphLite,
  rating?: 'like' | 'skip',
  usePhraseSplitting?: boolean
) => responseEngine.recordResponse(promptId, text, graph, rating, usePhraseSplitting);

export const promoteResponseToPhrase = (
  responseId: string,
  graph: SemanticGraphLite
) => responseEngine.promoteResponseToPhrase(responseId, graph);

export const rateResponse = (
  responseId: string,
  rating: 'like' | 'skip',
  graph: SemanticGraphLite
) => responseEngine.rateResponse(responseId, rating, graph);

// New reassembly utilities
export const reassembleCompleteResponse = (
  promptId: string,
  graph: SemanticGraphLite
): string => {
  // Get all responses for the prompt using existing method
  const responses = responseEngine.getResponsesForPrompt(promptId, graph);
  
  if (responses.length === 0) {
    return '';
  }
  
  // Sort responses by creation timestamp to maintain order
  const sortedResponses = responses.sort((a, b) => a.createdAt - b.createdAt);
  
  // Join all response texts with spaces
  return sortedResponses.map(response => response.text).join(' ');
};

export const getResponsesForPrompt = (
  promptId: string,
  graph: SemanticGraphLite
): ResponseNode[] => {
  return responseEngine.getResponsesForPrompt(promptId, graph);
};
