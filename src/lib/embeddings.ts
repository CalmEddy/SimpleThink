/**
 * Optional embeddings interface for ThinkCraft Lite
 * 
 * This module provides interfaces for embeddings that can be
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