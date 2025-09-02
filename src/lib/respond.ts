import type { SemanticGraphLite } from './semanticGraphLite.js';
import type { ResponseNode, PhraseNode } from '../types/index.js';
import { analyzeText } from './nlp.js';
import { promoteChunk } from './ingest.js';

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
    rating?: 'like' | 'skip'
  ): Promise<ResponseResult> {
    // Analyze the response text
    const { tokens, lemmas, pos } = await analyzeText(text);
    
    if (tokens.length === 0) {
      throw new Error('No tokens found in response text');
    }

    // Create/update WORD nodes for the response
    const wordIds: string[] = [];
    const wordMap = new Map<string, string>(); // lemma -> wordId
    
    lemmas.forEach((lemma, index) => {
      if (!wordMap.has(lemma)) {
        const word = graph.upsertWord(tokens[index], lemma, [pos[index]]);
        wordMap.set(lemma, word.id);
      }
      wordIds.push(wordMap.get(lemma)!);
    });

    // Compute POS pattern
    const posPattern = this.inferPosPattern(pos);

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
  rating?: 'like' | 'skip'
) => responseEngine.recordResponse(promptId, text, graph, rating);

export const promoteResponseToPhrase = (
  responseId: string,
  graph: SemanticGraphLite
) => responseEngine.promoteResponseToPhrase(responseId, graph);

export const rateResponse = (
  responseId: string,
  rating: 'like' | 'skip',
  graph: SemanticGraphLite
) => responseEngine.rateResponse(responseId, rating, graph);
