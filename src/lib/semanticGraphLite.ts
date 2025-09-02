import { v4 as uuidv4 } from 'uuid';
import type {
  NodeId,
  EdgeId,
  Node,
  WordNode,
  PhraseNode,
  PromptNode,
  ResponseNode,
  Edge,
  EdgeType,
  GraphJSON,
  PhraseChunk,
  PromptSlotBinding,
} from '../types/index.js';
import { auditPosPotentialForLemma } from './wordAnalysis.js';

export class SemanticGraphLite {
  private nodes = new Map<NodeId, Node>();
  private edges = new Map<EdgeId, Edge>();
  
  // Indexes for fast lookup
  private lemmaToPhrases = new Map<string, Set<NodeId>>();
  private wordLemmaToWords = new Map<string, Set<NodeId>>();

  constructor() {
    // Initialize empty graph
  }

  // Word operations
  upsertWord(text: string, lemma: string, pos: string[], currentPOS?: string): WordNode {
    const existingWord = this.findWordByLemma(lemma);
    
    if (existingWord) {
      // Initialize new fields if they don't exist (for backward compatibility)
      if (!existingWord.posObserved) {
        existingWord.posObserved = {};
      }
      if (!existingWord.posPotential) {
        existingWord.posPotential = existingWord.pos || ['NOUN'];
      }
      if (!existingWord.primaryPOS) {
        existingWord.primaryPOS = existingWord.posPotential[0] || 'NOUN';
      }
      if (existingWord.isPolysemousPOS === undefined) {
        existingWord.isPolysemousPOS = false;
      }
      
      // Update observed POS counts if currentPOS is provided
      if (currentPOS) {
        const normalizedPOS = this.normalizePOS(currentPOS);
        existingWord.posObserved[normalizedPOS] = (existingWord.posObserved[normalizedPOS] || 0) + 1;
        
        // Recompute primaryPOS and isPolysemousPOS
        this.updateWordPOSStats(existingWord);
      }
      
      // Merge POS tags
      const mergedPos = [...new Set([...existingWord.pos, ...pos])];
      const updatedWord: WordNode = {
        ...existingWord,
        pos: mergedPos,
      };
      this.nodes.set(existingWord.id, updatedWord);
      return updatedWord;
    }

    const wordId = uuidv4();
    
    // Initialize POS polysemy fields
    const posPotential = pos.length > 0 ? pos : ['NOUN']; // Default to NOUN if no POS provided
    const posObserved: Record<string, number> = {};
    if (currentPOS) {
      const normalizedPOS = this.normalizePOS(currentPOS);
      posObserved[normalizedPOS] = 1;
    }
    
    const word: WordNode = {
      id: wordId,
      type: 'WORD',
      text,
      lemma,
      pos,
      posPotential,
      posPotentialSource: ['initial'],
      posObserved,
      primaryPOS: posPotential[0] || 'NOUN',
      isPolysemousPOS: false, // Start as false, will be updated based on observed evidence
      stats: { uses: 0, likes: 0 },
    };

    this.nodes.set(wordId, word);
    this.updateWordIndex(word);
    
    // Fire-and-forget audit for new words (optional)
    this.auditWordPosPotential(word).catch(err => 
      console.warn('Failed to audit POS potential for new word:', word.lemma, err)
    );
    
    return word;
  }

  // Phrase operations
  upsertPhrase(
    text: string,
    lemmas: string[],
    posPattern: string,
    wordIds: NodeId[],
    derivedFromId?: NodeId,
    wordPOS?: string[] // Array of POS tags for each word in the phrase
  ): PhraseNode {
    const phraseId = uuidv4();
    const phrase: PhraseNode = {
      id: phraseId,
      type: 'PHRASE',
      text,
      lemmas,
      posPattern,
      wordIds,
      chunks: [],
      stats: { uses: 0, likes: 0 },
      derivedFromId,
    };

    this.nodes.set(phraseId, phrase);
    this.updatePhraseIndex(phrase);

    // Create edges to words
    wordIds.forEach((wordId, index) => {
      // Use the provided wordPOS if available, otherwise fallback to word's primary POS
      const word = this.nodes.get(wordId) as WordNode;
      const posUsed = wordPOS?.[index] || word.primaryPOS || word.pos?.[0] || 'NOUN';
      
      this.addEdge(phraseId, wordId, 'PHRASE_CONTAINS_WORD', {
        posUsed
      });
    });

    // Create derived from edge if applicable
    if (derivedFromId) {
      this.addEdge(phraseId, derivedFromId, 'DERIVED_FROM');
    }

    return phrase;
  }

  // Edge operations
  addEdge(from: NodeId, to: NodeId, type: EdgeType, meta?: Record<string, unknown>): Edge {
    const edgeId = uuidv4();
    const edge: Edge = {
      id: edgeId,
      from,
      to,
      type,
      meta,
    };

    this.edges.set(edgeId, edge);
    return edge;
  }

  /**
   * Normalize POS tag to canonical format
   */
  private normalizePOS(pos: string): string {
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
    
    return posMap[pos] || 'NOUN';
  }

  /**
   * Update word POS statistics (primaryPOS and isPolysemousPOS)
   */
  private updateWordPOSStats(word: WordNode): void {
    // Find POS with highest observed count
    let maxCount = 0;
    let primaryPOS = word.primaryPOS; // Keep existing if no observed counts
    
    for (const [pos, count] of Object.entries(word.posObserved)) {
      if (count > maxCount) {
        maxCount = count;
        primaryPOS = pos;
      }
    }
    
    // Determine if word is polysemous
    const observedPOS = Object.keys(word.posObserved);
    let isPolysemous = false;
    
    if (observedPOS.length >= 2) {
      // Check if secondary POS have sufficient evidence
      const primaryCount = word.posObserved[primaryPOS] || 0;
      const secondaryPOS = observedPOS.filter(pos => pos !== primaryPOS);
      
      isPolysemous = secondaryPOS.some(pos => {
        const count = word.posObserved[pos] || 0;
        // Consider polysemous if secondary POS has at least 2 occurrences
        // OR if secondary POS has at least 1 occurrence and primary count is exactly 2
        return count >= 2 || (count >= 1 && primaryCount === 2);
      });
    }
    
    // Update the word
    word.primaryPOS = primaryPOS;
    word.isPolysemousPOS = isPolysemous;
  }

  // Prompt operations
  recordPrompt(
    templateId: string,
    templateText: string,
    bindings: PromptSlotBinding[]
  ): PromptNode {
    const promptId = uuidv4();
    const prompt: PromptNode = {
      id: promptId,
      type: 'PROMPT',
      templateId,
      templateText,
      bindings,
      createdAt: Date.now(),
    };

    this.nodes.set(promptId, prompt);

    // Create edges for slot bindings
    bindings.forEach(binding => {
      this.addEdge(promptId, binding.fillerNodeId, 'PROMPT_USES_FILLER', {
        slot: binding.slot,
      });
    });

    return prompt;
  }

  // Response operations
  recordResponse(
    promptId: NodeId,
    text: string,
    lemmas: string[],
    posPattern: string,
    wordIds: NodeId[],
    rating?: 'like' | 'skip'
  ): ResponseNode {
    const responseId = uuidv4();
    const response: ResponseNode = {
      id: responseId,
      type: 'RESPONSE',
      text,
      lemmas,
      posPattern,
      promptId,
      wordIds,
      createdAt: Date.now(),
      rating,
    };

    this.nodes.set(responseId, response);

    // Create edges
    this.addEdge(responseId, promptId, 'RESPONSE_ANSWERS_PROMPT');
    wordIds.forEach(wordId => {
      this.addEdge(responseId, wordId, 'PHRASE_CONTAINS_WORD');
    });

    return response;
  }

  // Stats operations
  likeNode(nodeId: NodeId): void {
    const node = this.nodes.get(nodeId);
    if (node && node.stats) {
      node.stats.likes++;
    }
  }

  useNode(nodeId: NodeId): void {
    const node = this.nodes.get(nodeId);
    if (node && node.stats) {
      node.stats.uses++;
    }
  }

  // Query operations
  getWordNeighbors(wordId: NodeId): PhraseNode[] {
    const neighbors: PhraseNode[] = [];
    
    for (const edge of this.edges.values()) {
      if (edge.type === 'PHRASE_CONTAINS_WORD' && edge.to === wordId) {
        const phrase = this.nodes.get(edge.from);
        if (phrase && phrase.type === 'PHRASE') {
          neighbors.push(phrase);
        }
      }
    }

    return neighbors;
  }

  getPhrasesByWordLemma(lemma: string): PhraseNode[] {
    const phraseIds = this.lemmaToPhrases.get(lemma);
    if (!phraseIds) return [];

    const phrases: PhraseNode[] = [];
    for (const phraseId of phraseIds) {
      const node = this.nodes.get(phraseId);
      if (node && node.type === 'PHRASE') {
        phrases.push(node);
      }
    }

    return phrases;
  }

  // Chunk operations
  addChunksToPhrase(phraseId: NodeId, chunks: PhraseChunk[]): void {
    const phrase = this.nodes.get(phraseId);
    if (phrase && phrase.type === 'PHRASE') {
      phrase.chunks = chunks;
    }
  }

  // Serialization
  toJSON(): GraphJSON {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
      version: 1,
    };
  }

  fromJSON(json: GraphJSON): void {
    this.nodes.clear();
    this.edges.clear();
    this.lemmaToPhrases.clear();
    this.wordLemmaToWords.clear();

    // Restore nodes
    json.nodes.forEach(node => {
      this.nodes.set(node.id, node);
      if (node.type === 'WORD') {
        this.updateWordIndex(node);
      } else if (node.type === 'PHRASE') {
        this.updatePhraseIndex(node);
      }
    });

    // Restore edges
    json.edges.forEach(edge => {
      this.edges.set(edge.id, edge);
    });
  }

  // Helper methods
  findWordByLemma(lemma: string): WordNode | null {
    const wordIds = this.wordLemmaToWords.get(lemma);
    if (!wordIds || wordIds.size === 0) return null;

    const wordId = Array.from(wordIds)[0];
    const node = this.nodes.get(wordId);
    return node && node.type === 'WORD' ? node : null;
  }

  private updateWordIndex(word: WordNode): void {
    const existing = this.wordLemmaToWords.get(word.lemma) || new Set();
    existing.add(word.id);
    this.wordLemmaToWords.set(word.lemma, existing);
  }

  private updatePhraseIndex(phrase: PhraseNode): void {
    phrase.lemmas.forEach(lemma => {
      const existing = this.lemmaToPhrases.get(lemma) || new Set();
      existing.add(phrase.id);
      this.lemmaToPhrases.set(lemma, existing);
    });
  }

  // Getters for debugging
  getNodeCount(): number {
    return this.nodes.size;
  }

  getEdgeCount(): number {
    return this.edges.size;
  }

  getNodesByType(type: NodeType): Node[] {
    return Array.from(this.nodes.values()).filter(node => node.type === type);
  }

  getEdges(): Edge[] {
    return Array.from(this.edges.values());
  }

  // POS Potential Audit methods
  async auditWordPosPotential(word: WordNode): Promise<void> {
    const { pos, sources } = await auditPosPotentialForLemma(word.lemma);
    word.posPotential = pos;
    word.posPotentialSource = sources;
    word.posPotentialLastAuditedAt = Date.now();
  }

  async auditAllWordsPosPotential(): Promise<void> {
    const words = this.getNodesByType('WORD') as WordNode[];
    for (const w of words) {
      await this.auditWordPosPotential(w);
    }
  }
}
