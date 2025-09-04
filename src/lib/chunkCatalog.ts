import type { PhraseChunk } from '../types/index.js';

type TokenPOS = { token: string; lemma: string; pos: string };

interface ChunkStats {
  uses: number;
  likes: number;
  lastSeen: number;
  examples: string[];
}

export class ChunkCatalog {
  private static instance: ChunkCatalog;
  private catalog = new Map<string, ChunkStats>();

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): ChunkCatalog {
    if (!ChunkCatalog.instance) {
      ChunkCatalog.instance = new ChunkCatalog();
    }
    return ChunkCatalog.instance;
  }

  recordChunks(parentPhraseId: string, chunks: PhraseChunk[]): void {
    chunks.forEach(chunk => {
      const key = this.getChunkKey(chunk);
      const existing = this.catalog.get(key);
      
      if (existing) {
        existing.uses++;
        existing.lastSeen = Date.now();
        if (!existing.examples.includes(chunk.text)) {
          existing.examples.push(chunk.text);
          // Keep only the 3 most recent examples
          if (existing.examples.length > 3) {
            existing.examples.shift();
          }
        }
      } else {
        this.catalog.set(key, {
          uses: 1,
          likes: 0,
          lastSeen: Date.now(),
          examples: [chunk.text],
        });
      }
    });
  }

  updateChunkStats(key: string, deltaUses?: number, deltaLikes?: number): void {
    const stats = this.catalog.get(key);
    if (stats) {
      if (deltaUses !== undefined) {
        stats.uses += deltaUses;
      }
      if (deltaLikes !== undefined) {
        stats.likes += deltaLikes;
      }
      stats.lastSeen = Date.now();
    }
  }

  getChunkStats(key: string): ChunkStats | null {
    return this.catalog.get(key) || null;
  }

  topKeys(limit: number): Array<{ key: string; stats: ChunkStats; score: number }> {
    const entries = Array.from(this.catalog.entries())
      .map(([key, stats]) => ({
        key,
        stats,
        score: this.calculateScore(stats),
      }))
      .sort((a, b) => b.score - a.score);

    return entries.slice(0, limit);
  }

  getChunkKey(chunk: PhraseChunk): string {
    return `${chunk.lemmas.join('_')}|${chunk.posPattern}`;
  }

  private calculateScore(stats: ChunkStats): number {
    // Simple scoring: uses + likes + recency bonus
    const recencyBonus = Math.max(0, 1 - (Date.now() - stats.lastSeen) / (30 * 24 * 60 * 60 * 1000)); // 30 days
    return stats.uses + stats.likes + recencyBonus;
  }

  // Get all chunks that match a specific pattern
  getChunksByPattern(posPattern: string): Array<{ key: string; stats: ChunkStats }> {
    return Array.from(this.catalog.entries())
      .filter(([key]) => key.includes(`|${posPattern}`))
      .map(([key, stats]) => ({ key, stats }));
  }

  // Get chunks that contain specific lemmas
  getChunksByLemmas(lemmas: string[]): Array<{ key: string; stats: ChunkStats; overlap: number }> {
    return Array.from(this.catalog.entries())
      .map(([key, stats]) => {
        const chunkLemmas = key.split('|')[0].split('_');
        const overlap = lemmas.filter(lemma => chunkLemmas.includes(lemma)).length;
        return { key, stats, overlap };
      })
      .filter(item => item.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap);
  }

  // Clear all data (for testing or reset)
  clear(): void {
    this.catalog.clear();
  }

  // Get catalog size
  size(): number {
    return this.catalog.size;
  }

  // Export/import for persistence (if needed)
  toJSON(): Record<string, ChunkStats> {
    return Object.fromEntries(this.catalog);
  }

  fromJSON(data: Record<string, ChunkStats>): void {
    this.catalog.clear();
    Object.entries(data).forEach(([key, stats]) => {
      this.catalog.set(key, stats);
    });
  }
}

// Utility function to merge adjacent PROPN tokens into single name chunks
export function mergeProperNameRuns(seq: TokenPOS[]): TokenPOS[] {
  const out: TokenPOS[] = [];
  let i = 0;
  while (i < seq.length) {
    if (seq[i].pos === 'PROPN') {
      let j = i + 1;
      let text = seq[i].token;
      let lemma = seq[i].lemma;
      while (j < seq.length && seq[j].pos === 'PROPN') {
        text += ' ' + seq[j].token;
        lemma += ' ' + seq[j].lemma;
        j++;
      }
      out.push({ token: text, lemma, pos: 'PROPN' });
      i = j;
    } else {
      out.push(seq[i]);
      i++;
    }
  }
  return out;
}

// Enhanced chunk building with proper name merging
export function buildChunks(tokens: string[], lemmas: string[], pos: string[]): PhraseChunk[] {
  const seq: TokenPOS[] = tokens.map((t, i) => ({ token: t, lemma: lemmas[i], pos: pos[i] }));
  const merged = mergeProperNameRuns(seq);
  
  // Convert back to arrays for existing chunk extraction logic
  const mergedTokens = merged.map(t => t.token);
  const mergedLemmas = merged.map(t => t.lemma);
  const mergedPos = merged.map(t => t.pos);
  
  // Now create n-grams & match patterns like:
  // PROPN-PROPN, NOUN-PROPN, PROPN-NOUN, etc.
  // This would integrate with your existing extractChunks logic
  return []; // Placeholder - integrate with existing chunk extraction
}

// Export singleton instance and convenience functions
export const chunkCatalog = ChunkCatalog.getInstance();

export const recordChunks = (parentPhraseId: string, chunks: PhraseChunk[]) => 
  chunkCatalog.recordChunks(parentPhraseId, chunks);

export const updateChunkStats = (key: string, deltaUses?: number, deltaLikes?: number) => 
  chunkCatalog.updateChunkStats(key, deltaUses, deltaLikes);

export const topKeys = (limit: number) => chunkCatalog.topKeys(limit);
