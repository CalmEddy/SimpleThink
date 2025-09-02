/**
 * Optional embeddings interface for ThinkCraft Lite
 * 
 * This module provides a no-op interface for embeddings that can be
 * extended later with actual embedding models (e.g., GloVe, Word2Vec, etc.)
 * 
 * The interface is designed to be pluggable - when embeddings are available,
 * they can be used to enhance phrase similarity calculations in the retrieval system.
 */

export interface EmbeddingVector {
  values: Float32Array;
  dimension: number;
}

export interface EmbeddingResult {
  word: string;
  vector: EmbeddingVector | null;
}

export class EmbeddingEngine {
  private static instance: EmbeddingEngine;
  private isInitialized = false;
  private embeddingCache = new Map<string, EmbeddingVector>();

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): EmbeddingEngine {
    if (!EmbeddingEngine.instance) {
      EmbeddingEngine.instance = new EmbeddingEngine();
    }
    return EmbeddingEngine.instance;
  }

  /**
   * Initialize the embedding engine
   * This is a no-op in the current implementation but can be extended
   * to load actual embedding models
   */
  async initialize(): Promise<boolean> {
    // No-op implementation
    this.isInitialized = true;
    return true;
  }

  /**
   * Get embeddings for a list of words
   * Returns null for all words in the current no-op implementation
   */
  async embedWords(words: string[]): Promise<EmbeddingResult[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return words.map(word => ({
      word,
      vector: null, // No embeddings available
    }));
  }

  /**
   * Get embedding for a single word
   * Returns null in the current no-op implementation
   */
  async embedWord(word: string): Promise<EmbeddingVector | null> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Check cache first
    if (this.embeddingCache.has(word)) {
      return this.embeddingCache.get(word)!;
    }

    // No embeddings available
    return null;
  }

  /**
   * Calculate cosine similarity between two embedding vectors
   * Returns 0 in the current no-op implementation
   */
  similarity(a: EmbeddingVector, b: EmbeddingVector): number {
    if (a.dimension !== b.dimension) {
      throw new Error('Embedding dimensions must match');
    }

    // No-op implementation - return 0 similarity
    return 0;
  }

  /**
   * Calculate cosine similarity between two words
   * Returns 0 in the current no-op implementation
   */
  async wordSimilarity(word1: string, word2: string): Promise<number> {
    const [embedding1, embedding2] = await Promise.all([
      this.embedWord(word1),
      this.embedWord(word2),
    ]);

    if (!embedding1 || !embedding2) {
      return 0;
    }

    return this.similarity(embedding1, embedding2);
  }

  /**
   * Find most similar words to a given word
   * Returns empty array in the current no-op implementation
   */
  async findSimilarWords(word: string, limit: number = 10): Promise<Array<{ word: string; similarity: number }>> {
    // No-op implementation
    return [];
  }

  /**
   * Calculate phrase similarity using word embeddings
   * Returns 0 in the current no-op implementation
   */
  async phraseSimilarity(phrase1: string[], phrase2: string[]): Promise<number> {
    // No-op implementation
    return 0;
  }

  /**
   * Check if embeddings are available
   * Returns false in the current no-op implementation
   */
  isAvailable(): boolean {
    return false;
  }

  /**
   * Get embedding dimension
   * Returns 0 in the current no-op implementation
   */
  getDimension(): number {
    return 0;
  }

  /**
   * Clear embedding cache
   */
  clearCache(): void {
    this.embeddingCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.embeddingCache.size,
      hitRate: 0, // No hits in no-op implementation
    };
  }
}

// Export singleton instance and convenience functions
export const embeddingEngine = EmbeddingEngine.getInstance();

export const embedWords = (words: string[]): Promise<EmbeddingResult[]> => 
  embeddingEngine.embedWords(words);

export const embedWord = (word: string): Promise<EmbeddingVector | null> => 
  embeddingEngine.embedWord(word);

export const similarity = (a: EmbeddingVector, b: EmbeddingVector): number => 
  embeddingEngine.similarity(a, b);

export const wordSimilarity = (word1: string, word2: string): Promise<number> => 
  embeddingEngine.wordSimilarity(word1, word2);

export const phraseSimilarity = (phrase1: string[], phrase2: string[]): Promise<number> => 
  embeddingEngine.phraseSimilarity(phrase1, phrase2);

export const isEmbeddingsAvailable = (): boolean => embeddingEngine.isAvailable();

// Future extension points for actual embedding implementations:

/**
 * Example interface for GloVe embeddings
 * This can be implemented when GloVe vectors are added
 */
export interface GloVeEmbeddings {
  loadModel(url: string): Promise<void>;
  getVector(word: string): Float32Array | null;
  getSimilarWords(word: string, limit: number): Array<{ word: string; similarity: number }>;
}

/**
 * Example interface for Word2Vec embeddings
 * This can be implemented when Word2Vec vectors are added
 */
export interface Word2VecEmbeddings {
  loadModel(url: string): Promise<void>;
  getVector(word: string): Float32Array | null;
  getSimilarWords(word: string, limit: number): Array<{ word: string; similarity: number }>;
}

/**
 * Example interface for transformer-based embeddings
 * This can be implemented when transformer models are added
 */
export interface TransformerEmbeddings {
  loadModel(modelName: string): Promise<void>;
  embedText(text: string): Promise<Float32Array>;
  embedWords(words: string[]): Promise<Float32Array[]>;
}
