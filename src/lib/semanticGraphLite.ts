import { v4 as uuidv4 } from 'uuid';
import type {
  NodeId,
  EdgeId,
  Node,
  NodeType,
  WordNode,
  PhraseNode,
  PromptNode,
  ResponseNode,
  TopicNode,
  SessionNode,
  Edge,
  EdgeType,
  GraphJSON,
  PhraseChunk,
  PromptSlotBinding,
  SessionLocks,
} from '../types/index.js';
import { analyzeWordPOS } from './posAnalysis.js';

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
        
        // Store morphological feature from currentPOS if it contains ':'
        if (currentPOS.includes(':')) {
          const [, morph] = currentPOS.split(':');
          existingWord.morphFeature = morph;
        }
        
        // Store original form
        existingWord.originalForm = text;
        
        // Recompute primaryPOS and isPolysemousPOS
        this.updateWordPOSStats(existingWord);
      }
      
      // Merge POS tags and posPotential
      const mergedPos = [...new Set([...existingWord.pos, ...pos])];
      const mergedPosPotential = [...new Set([...(existingWord.posPotential || []), ...pos])];
      const updatedWord: WordNode = {
        ...existingWord,
        pos: mergedPos,
        posPotential: mergedPosPotential,
      };
      
      // Update polysemy status after merging POS tags
      this.updateWordPOSStats(updatedWord);
      
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
      originalForm: text,
      posPotential,
      posPotentialSource: ['initial'],
      posObserved,
      primaryPOS: posPotential[0] || 'NOUN',
      isPolysemousPOS: false, // Will be updated immediately below
      stats: { uses: 0, likes: 0 },
    };

    // Store morphological feature from currentPOS if it contains ':'
    if (currentPOS && currentPOS.includes(':')) {
      const [, morph] = currentPOS.split(':');
      word.morphFeature = morph;
    }

    // Immediately update polysemy status based on potential POS tags
    this.updateWordPOSStats(word);

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
    
    // If no observed counts, use the first potential POS
    if (Object.keys(word.posObserved).length === 0 && word.posPotential && word.posPotential.length > 0) {
      primaryPOS = word.posPotential[0];
    }
    
    // Simple polysemy detection: word is polysemous if it has multiple POS tags
    // Check both observed POS and potential POS
    const observedPOS = Object.keys(word.posObserved);
    const potentialPOS = word.posPotential || [];
    const allPOS = [...new Set([...observedPOS, ...potentialPOS])];
    
    // Word is polysemous if it has more than one POS tag
    const isPolysemous = allPOS.length > 1;
    
    // Update the word
    word.primaryPOS = primaryPOS;
    word.isPolysemousPOS = isPolysemous;
    
    // Update the display POS to use the primary POS from observed counts
    if (primaryPOS && Object.keys(word.posObserved).length > 0) {
      word.pos = [primaryPOS];
    }
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
      // Migrate old prompt nodes that might not have bindings property
      if (node.type === 'PROMPT') {
        const promptNode = node as PromptNode;
        if (!promptNode.bindings) {
          promptNode.bindings = [];
        }
      }
      
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

  // Topic operations
  getTopicByText(text: string): TopicNode | undefined {
    const canon = text.trim().toLowerCase();
    const topics = this.getNodesByType('TOPIC') as TopicNode[];
    return topics.find(t => t.text.toLowerCase() === canon);
  }

  upsertTopic(text: string, lemmas: string[], posPattern?: string, keywords?: string[]): TopicNode {
    const existing = this.getTopicByText(text);
    if (existing) {
      existing.updatedAt = Date.now();
      if (keywords?.length) existing.keywords = keywords;
      return existing;
    }
    
    const topicId = uuidv4();
    const topic: TopicNode = {
      id: topicId,
      type: 'TOPIC',
      text,
      lemmas,
      posPattern,
      keywords,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    this.nodes.set(topicId, topic);
    return topic;
  }

  // Session operations
  openSession(topicId: string, entityBindings?: SessionNode['entityBindings']): SessionNode {
    const sessionId = uuidv4();
    const session: SessionNode = {
      id: sessionId,
      type: 'SESSION',
      topicId,
      startedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      entityBindings,
    };
    
    this.nodes.set(sessionId, session);
    
    // Create edge from session to topic
    this.addEdge(sessionId, topicId, 'SESSION_OF_TOPIC');
    
    return session;
  }

  endSession(sessionId: string): void {
    const session = this.nodes.get(sessionId);
    if (session && session.type === 'SESSION') {
      (session as SessionNode).endedAt = Date.now();
      (session as SessionNode).updatedAt = Date.now();
    }
  }

  // Context linking methods
  linkAboutTopic(fromNodeId: string, topicId: string, confidence = 1, origin: 'user'|'promotion'|'import' = 'user'): void {
    this.addEdge(fromNodeId, topicId, 'PHRASE_ABOUT_TOPIC', { confidence, origin });
  }

  linkCreatedInSession(fromNodeId: string, sessionId: string): void {
    this.addEdge(fromNodeId, sessionId, 'CREATED_IN_SESSION');
  }

  // POS Potential Audit methods
  async auditWordPosPotential(word: WordNode): Promise<void> {
    const analysis = await analyzeWordPOS(word.lemma, word.primaryPOS || 'NOUN');
    word.posPotential = analysis.pos;
    word.posPotentialSource = [analysis.source];
    word.isPolysemousPOS = analysis.isPolysemous;
    word.posPotentialLastAuditedAt = Date.now();
  }

  async auditAllWordsPosPotential(): Promise<void> {
    const words = this.getNodesByType('WORD') as WordNode[];
    for (const w of words) {
      await this.auditWordPosPotential(w);
    }
  }

  // Cleanup corrupted edges with undefined IDs
  cleanupCorruptedEdges(): number {
    const edgesToRemove: EdgeId[] = [];
    
    this.edges.forEach((edge, edgeId) => {
      if (!edge.from || !edge.to) {
        console.log('🧹 Removing corrupted edge:', edgeId, edge);
        edgesToRemove.push(edgeId);
      }
    });
    
    edgesToRemove.forEach(edgeId => {
      this.edges.delete(edgeId);
    });
    
    console.log('🧹 Cleaned up', edgesToRemove.length, 'corrupted edges');
    return edgesToRemove.length;
  }

  // Recovery function to restore from backup
  async recoverFromBackup(): Promise<boolean> {
    try {
      // Try to load from backup using the persistence manager
      const { PersistentStore } = await import('./persistentStore.js');
      const backupData = await PersistentStore.load();
      
      if (backupData && backupData.edges && backupData.edges.length > 0) {
        console.log('🔄 Recovering graph from backup with', backupData.edges.length, 'edges');
        this.fromJSON(backupData);
        return true;
      } else {
        console.log('❌ No backup data found to recover from');
        return false;
      }
    } catch (error) {
      console.error('❌ Failed to recover from backup:', error);
      return false;
    }
  }

  // --- NEW: persist/retrieve session locks on the SessionNode ---
  getSessionLocks(sessionId: string): SessionLocks | undefined {
    const session = this.nodes.get(sessionId) as SessionNode | undefined;
    return (session as any)?.locks as SessionLocks | undefined;
  }

  setSessionLocks(sessionId: string, locks: SessionLocks): void {
    const session = this.nodes.get(sessionId) as SessionNode | undefined;
    if (!session) return;
    (session as any).locks = locks;
    // Note: In a real implementation, you'd want to trigger graph updates here
  }
}
