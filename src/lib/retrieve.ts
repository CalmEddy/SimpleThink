import type { SemanticGraphLite } from './semanticGraphLite.js';
import type { PhraseNode, PhraseChunk } from '../types/index.js';

export interface RetrievalOptions {
  maxResults?: number;
  useEmbeddings?: boolean;
  minOverlap?: number;
}

export interface ScoredPhrase {
  phrase: PhraseNode;
  score: number;
  overlapScore: number;
  patternBoost: number;
  likeBoost: number;
}

export interface RetrievalResult {
  relatedPhrases: ScoredPhrase[];
  topChunks: PhraseChunk[];
}

export class RetrievalEngine {
  private static instance: RetrievalEngine;
  
  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): RetrievalEngine {
    if (!RetrievalEngine.instance) {
      RetrievalEngine.instance = new RetrievalEngine();
    }
    return RetrievalEngine.instance;
  }

  surfaceRelatedPhrases(
    seedPhraseId: string, 
    graph: SemanticGraphLite, 
    options: RetrievalOptions = {}
  ): RetrievalResult {
    const {
      maxResults = 40,
      useEmbeddings = false,
      minOverlap = 1,
    } = options;

    // Get seed phrase
    const seedPhrase = graph.getNodesByType('PHRASE').find(p => p.id === seedPhraseId) as PhraseNode;
    if (!seedPhrase) {
      throw new Error(`Seed phrase ${seedPhraseId} not found`);
    }

    // Get all phrases that share lemmas with seed phrase
    const candidatePhrases = this.getCandidatePhrases(seedPhrase, graph);
    
    // Score candidates
    const scoredPhrases = candidatePhrases
      .map(candidate => this.scorePhrase(seedPhrase, candidate, useEmbeddings))
      .filter(scored => scored.overlapScore >= minOverlap)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    // Gather top chunks from related phrases
    const topChunks = this.gatherTopChunks(scoredPhrases);

    return {
      relatedPhrases: scoredPhrases,
      topChunks,
    };
  }

  private getCandidatePhrases(seedPhrase: PhraseNode, graph: SemanticGraphLite): PhraseNode[] {
    const candidates = new Set<PhraseNode>();
    
    // Get phrases that share lemmas with seed phrase
    seedPhrase.lemmas.forEach(lemma => {
      const phrases = graph.getPhrasesByWordLemma(lemma);
      phrases.forEach(phrase => {
        if (phrase.id !== seedPhrase.id) {
          candidates.add(phrase);
        }
      });
    });

    return Array.from(candidates);
  }

  private scorePhrase(seedPhrase: PhraseNode, candidate: PhraseNode, useEmbeddings: boolean): ScoredPhrase {
    // Calculate overlap score
    const overlapScore = this.calculateOverlapScore(seedPhrase.lemmas, candidate.lemmas);
    
    // Calculate pattern boost
    const patternBoost = this.calculatePatternBoost(seedPhrase.posPattern, candidate.posPattern);
    
    // Calculate like boost
    const likeBoost = this.calculateLikeBoost(candidate);
    
    // Calculate final score
    let score = overlapScore + patternBoost + likeBoost;
    
    // Add embedding similarity if available (placeholder for future implementation)
    if (useEmbeddings) {
      // TODO: Add embedding similarity when embeddings are implemented
      // const embeddingSimilarity = this.calculateEmbeddingSimilarity(seedPhrase, candidate);
      // score += embeddingSimilarity * 0.3; // Weight embeddings at 30%
    }

    return {
      phrase: candidate,
      score,
      overlapScore,
      patternBoost,
      likeBoost,
    };
  }

  private calculateOverlapScore(seedLemmas: string[], candidateLemmas: string[]): number {
    const seedSet = new Set(seedLemmas);
    const candidateSet = new Set(candidateLemmas);
    
    const intersection = new Set([...seedSet].filter(x => candidateSet.has(x)));
    const union = new Set([...seedSet, ...candidateSet]);
    
    // Jaccard similarity
    return intersection.size / union.size;
  }

  private calculatePatternBoost(seedPattern: string, candidatePattern: string): number {
    if (seedPattern === candidatePattern) {
      return 0.5; // Exact pattern match
    }
    
    // Check for partial pattern matches
    const seedParts = seedPattern.split('-');
    const candidateParts = candidatePattern.split('-');
    
    const commonParts = seedParts.filter(part => candidateParts.includes(part));
    const similarity = commonParts.length / Math.max(seedParts.length, candidateParts.length);
    
    return similarity * 0.2; // Partial pattern match
  }

  private calculateLikeBoost(phrase: PhraseNode): number {
    if (!phrase.stats) return 0;
    
    const likes = phrase.stats.likes;
    const uses = phrase.stats.uses;
    
    if (uses === 0) return 0;
    
    // Normalize likes by usage
    const likeRatio = likes / uses;
    
    // Boost based on like ratio (capped at 0.3)
    return Math.min(likeRatio * 0.3, 0.3);
  }

  private gatherTopChunks(scoredPhrases: ScoredPhrase[]): PhraseChunk[] {
    const allChunks: PhraseChunk[] = [];
    
    scoredPhrases.forEach(({ phrase }) => {
      allChunks.push(...phrase.chunks);
    });
    
    // Sort by score and return top chunks
    return allChunks
      .sort((a, b) => b.score - a.score)
      .slice(0, 20); // Top 20 chunks
  }

  // Get phrases by specific criteria
  getPhrasesByPattern(pattern: string, graph: SemanticGraphLite): PhraseNode[] {
    return graph.getNodesByType('PHRASE')
      .filter(node => node.posPattern === pattern) as PhraseNode[];
  }

  getPhrasesByWord(word: string, graph: SemanticGraphLite): PhraseNode[] {
    return graph.getPhrasesByWordLemma(word);
  }

  // Get top phrases by usage/likes
  getTopPhrases(graph: SemanticGraphLite, limit: number = 10): PhraseNode[] {
    return graph.getNodesByType('PHRASE')
      .filter(node => node.stats)
      .sort((a, b) => {
        const aScore = (a.stats?.likes || 0) + (a.stats?.uses || 0);
        const bScore = (b.stats?.likes || 0) + (b.stats?.uses || 0);
        return bScore - aScore;
      })
      .slice(0, limit) as PhraseNode[];
  }
}

// Export singleton instance and convenience functions
export const retrievalEngine = RetrievalEngine.getInstance();

export const surfaceRelatedPhrases = (
  seedPhraseId: string, 
  graph: SemanticGraphLite, 
  options?: RetrievalOptions
): RetrievalResult => retrievalEngine.surfaceRelatedPhrases(seedPhraseId, graph, options);
