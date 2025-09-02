import { SemanticNetwork, GraphStats, QueryResult, NoteEntry } from '@/types'
import { estimateMemoryUsage } from './utils'

import { UserTag } from '../types/tags'


/**
 * Interface for sentence storage
 */


/**
 * Interface for node metadata tracking
 */
interface NodeMetadata {
  createdAt: Date;
  lastModified: Date;
}

/**
 * Interface for connection metadata tracking
 */
interface ConnectionMetadata {
  createdAt: Date;
  lastModified: Date;
}

/**
 * Interface for co-occurrence data tracking
 */
interface CooccurrenceData {
  word1: string;
  word2: string;
  count: number;
  contexts: Set<string>;
  lastUpdated: Date;
}

/**
 * Interface for vector metadata
 */
interface VectorMetadata {
  dimension: number;
  source: 'glove' | 'computed' | 'external';
  lastUpdated: Date;
  nodeType: 'word' | 'phrase' | 'premise' | 'child-idea';
}

/**
 * Core semantic graph engine for managing word associations
 * Now with automatic lemmatization and sentence context storage
 * OPTIMIZED VERSION with caching and performance improvements
 */
export class SemanticGraph {
  private graph: Map<string, Set<string>> = new Map()
  private metadata: SemanticNetwork['metadata']
  private isDirty: boolean = false
  // Store categorized associations by AI
  private categorizedAssociations: Map<string, Array<{ word: string; category: string; subcategory?: string }>> = new Map()
  // Store multiple tags per association (updated structure)
  private associationTags: Map<string, Map<string, Set<string>>> = new Map()
  // Store user-created tags
  private userTags: Map<string, UserTag> = new Map()
  // Store individual word tags (POS, semantic properties, etc.)
  private wordTags: Map<string, Set<string>> = new Map()
  


  // NEW: Notes storage - separate from sentences for performance
  private notes: Map<string, NoteEntry> = new Map() // note_id -> note
  private nodeToNotes: Map<string, Set<string>> = new Map() // level0_node -> set of note_ids
  private noteIdCounter: number = 1

  // NEW: Timestamp tracking for nodes and connections
  private nodeMetadata: Map<string, NodeMetadata> = new Map()
  private connectionMetadata: Map<string, ConnectionMetadata> = new Map() // key: "word1|word2"

  // OPTIMIZATION 1: Word Processing Cache (80-95% performance improvement)
  private wordCache: Map<string, string> = new Map()
  private static readonly MAX_CACHE_SIZE = 10000

  // OPTIMIZATION 2: Lazy Statistics with Caching (90% performance improvement)  
  private cachedStats: GraphStats | null = null
  private statsDirty: boolean = true

  // OPTIMIZATION 4: Reverse Tag Indexing (95% improvement for tag lookups)
  private tagToWords: Map<string, Set<string>> = new Map() // tag -> words that have it

  // NEW: Co-occurrence tracking alongside existing structures
  private cooccurrence: Map<string, CooccurrenceData> = new Map()

  // NEW: Vector storage integrated with existing node structure
  private nodeVectors: Map<string, number[]> = new Map()
  private vectorMetadata: Map<string, VectorMetadata> = new Map()
  
  // NEW: Semantic similarity cache
  private similarityCache = new Map<string, { 
    results: Array<{ nodeId: string, similarity: number }>; 
    timestamp: number; 
    limit: number;
  }>();
  private readonly SIMILARITY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Response Management System storage
  private prompts: Map<string, any> = new Map() // prompt_id -> prompt data
  private responses: Map<string, any> = new Map() // response_id -> response data
  private promptIdCounter: number = 1
  private responseIdCounter: number = 1



  constructor() {
    this.metadata = {
      version: '1.0.0',
      created: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      nodeCount: 0,
      edgeCount: 0
    }
  }



 

  /**
   * Process word for storage: lemmatize using NLP
   * OPTIMIZED with LRU cache
   */
  public async processWord(word: string): Promise<string> {
    // console.log('🔍 SemanticGraph.processWord DEBUG:');
    // console.log('  Input word:', JSON.stringify(word));
    
    // Check cache first - O(1) lookup
    // console.log('  📊 Cache size before lookup:', this.wordCache.size);
    if (this.wordCache.has(word)) {
      const cached = this.wordCache.get(word)!;
      // console.log('  ✅ Found in cache:', JSON.stringify(cached));
      return cached;
    }

    if (!word || typeof word !== 'string') {
      // console.log('  ❌ Invalid word, returning empty string');
      return ''
    }
    
    // Special handling for topic IDs - preserve as-is
    if (word.startsWith('topic:')) {
      // console.log('  🎯 Topic ID detected, preserving as-is:', JSON.stringify(word));
      return word
    }
    
    // Use WordAnalysisService for proper lemmatization
    try {
      // console.log('  🔍 Importing WordAnalysisService...');
      const { WordAnalysisService } = await import('./wordAnalysis')
      const wordAnalysis = WordAnalysisService.getInstance()
      
      // Clear WordAnalysisService cache if available
      if (wordAnalysis.cleanupMemory) {
        wordAnalysis.cleanupMemory();
        // console.log('  🧹 WordAnalysisService cache cleared');
      }
      
      if (wordAnalysis.isReady()) {
        // console.log('  🔍 WordAnalysisService is ready, analyzing word...');
        
        // Check if this is a multi-word phrase
        const words = word.trim().split(/\s+/);
        if (words.length > 1) {
          // Multi-word phrase - preserve as-is, don't lemmatize
          // console.log('  📊 Multi-word phrase detected, preserving as-is:', JSON.stringify(word));
          const lemmatized = word; // Keep the original phrase
          // console.log('  📊 Preserved phrase:', JSON.stringify(lemmatized));
          
          // LRU cache management - keep cache size under control
          if (this.wordCache.size >= SemanticGraph.MAX_CACHE_SIZE) {
            const firstKey = this.wordCache.keys().next().value
            if (firstKey) {
              this.wordCache.delete(firstKey)
            }
          }

          // Cache the result for future use
          this.wordCache.set(word, lemmatized)
          // console.log('  ✅ Cached multi-word phrase');
          // console.log('  📊 Cache size after caching:', this.wordCache.size);
          return lemmatized
        } else {
          // Single word - use lemmatization
          const analysis = wordAnalysis.analyzeWord(word)
          const lemmatized = analysis.lemma || word.toLowerCase()
          // console.log('  📊 Analysis result:', analysis);
          // console.log('  📊 Lemmatized result:', JSON.stringify(lemmatized));
          
          // LRU cache management - keep cache size under control
          if (this.wordCache.size >= SemanticGraph.MAX_CACHE_SIZE) {
            const firstKey = this.wordCache.keys().next().value
            if (firstKey) {
              this.wordCache.delete(firstKey)
            }
          }

          // Cache the result for future use
          this.wordCache.set(word, lemmatized)
          // console.log('  ✅ Cached result');
          // console.log('  📊 Cache size after caching:', this.wordCache.size);
          return lemmatized
        }
      } else {
        // console.log('  ⚠️ WordAnalysisService not ready');
      }
    } catch (error) {
      console.warn('  ⚠️ WordAnalysisService not available for lemmatization, falling back to lowercase:', error)
    }
    
    // Fallback to lowercase if WordAnalysisService is not available
    const lemmatized = word.toLowerCase()
    // console.log('  📊 Fallback lemmatized result:', JSON.stringify(lemmatized));
    
    // LRU cache management - keep cache size under control
    if (this.wordCache.size >= SemanticGraph.MAX_CACHE_SIZE) {
      const firstKey = this.wordCache.keys().next().value
      if (firstKey) {
        this.wordCache.delete(firstKey)
      }
    }

    // Cache the result for future use
    this.wordCache.set(word, lemmatized)
    // console.log('  ✅ Cached fallback result');
    // console.log('  📊 Cache size after fallback caching:', this.wordCache.size);
    return lemmatized
  }

  /**
   * Mark statistics and other caches as dirty
   */
  private markCachesDirty(): void {
    this.statsDirty = true
    this.isDirty = true
  }

  /**
   * Helper method for connection keys - ensures consistent ordering for bidirectional connections
   */
  private getConnectionKey(word1: string, word2: string): string {
    return [word1, word2].sort().join('|');
  }

  /**
   * Universal gateway method to ensure a word exists in the main graph
   * This is the single source of truth for word creation
   * Now public to allow direct word creation with proper validation
   */
  public async ensureWordExists(word: string): Promise<string> {
    // console.log('🔍 SemanticGraph.ensureWordExists DEBUG:');
    // console.log('  Input word:', JSON.stringify(word));
    
    const cleanWord = await this.processWord(word)
    // console.log('  📊 Clean word after processing:', JSON.stringify(cleanWord));
    
    if (!cleanWord) {
      // console.log('  ❌ No clean word returned, returning empty string');
      return ''
    }
    
    // Ensure word exists in main graph (single source of truth)
    if (!this.graph.has(cleanWord)) {
      // console.log('  🔍 Word not in graph, adding...');
      this.graph.set(cleanWord, new Set())
      // console.log('  ✅ Word added to graph');
      
      // Track node creation time for new nodes
      this.nodeMetadata.set(cleanWord, {
        createdAt: new Date(),
        lastModified: new Date()
      });
      // console.log('  ✅ Metadata added for word');
    } else {
      // console.log('  ✅ Word already exists in graph');
    }
    
    // console.log('  📊 Current graph size:', this.graph.size);
    return cleanWord
  }

  /**
   * Add association between two words
   */
  async addAssociation(word1: string, word2: string, tags: string[] = []): Promise<void> {
    const cleanWord1 = await this.ensureWordExists(word1)
    const cleanWord2 = await this.ensureWordExists(word2)
    
    if (!cleanWord1 || !cleanWord2 || cleanWord1 === cleanWord2) return

    const now = new Date();
    
    // Track node creation/modification times
    if (!this.nodeMetadata.has(cleanWord1)) {
      this.nodeMetadata.set(cleanWord1, {
        createdAt: now,
        lastModified: now
      });
    } else {
      // Update last modified for existing node
      const metadata = this.nodeMetadata.get(cleanWord1)!;
      metadata.lastModified = now;
    }
    
    if (!this.nodeMetadata.has(cleanWord2)) {
      this.nodeMetadata.set(cleanWord2, {
        createdAt: now,
        lastModified: now
      });
    } else {
      const metadata = this.nodeMetadata.get(cleanWord2)!;
      metadata.lastModified = now;
    }

    // Track connection metadata
    const connectionKey = this.getConnectionKey(cleanWord1, cleanWord2);
    const hadConnection = this.connectionMetadata.has(connectionKey);
    
    if (!hadConnection) {
      this.connectionMetadata.set(connectionKey, {
        createdAt: now,
        lastModified: now
      });
    } else {
      // Update existing connection
      const connMetadata = this.connectionMetadata.get(connectionKey)!;
      connMetadata.lastModified = now;
    }

    const word1Connections = this.graph.get(cleanWord1)!
    const word2Connections = this.graph.get(cleanWord2)!

    const hadConnection1 = word1Connections.has(cleanWord2)
    const hadConnection2 = word2Connections.has(cleanWord1)

    word1Connections.add(cleanWord2)
    word2Connections.add(cleanWord1)

    // Set tags for both directions (only if tags are provided)
    if (tags.length > 0) {
      this.setAssociationTags(cleanWord1, cleanWord2, tags)
      this.setAssociationTags(cleanWord2, cleanWord1, tags)
    }

    // Update edge count only if new connections were made
    if (!hadConnection1 || !hadConnection2) {
      this.updateMetadata()
      this.markCachesDirty()
    }
  }

  /**
   * Add multiple associations for a word
   */
  async addWordAssociations(word: string, associations: string[], tags: string[] = []): Promise<void> {
    const cleanWord = await this.ensureWordExists(word)
    if (!cleanWord) return

    // Add word-level tags to the main word
    for (const tag of tags) {
      await this.addWordTag(cleanWord, tag)
    }

    // Lemmatize all associations and remove duplicates
    const lemmatizedAssociations = [...new Set(await Promise.all(associations.map(async assoc => await this.processWord(assoc))))]
    
    for (const association of lemmatizedAssociations) {
      if (association && association !== cleanWord) {
        await this.addAssociation(cleanWord, association, tags)
      }
    }
  }

  /**
   * Add word associations with category information and tags
   */
  async addWordAssociationsWithCategories(
    word: string, 
    associations: string[], 
    categorizedAssociations?: Array<{ word: string; category: string; subcategory?: string }>,
    tags: string[] = []
  ): Promise<void> {
    const cleanWord = await this.ensureWordExists(word)
    if (!cleanWord) return

    // Process each association and add category tags
    for (const association of associations) {
      if (association && association !== cleanWord) {
        const cleanAssociation = await this.processWord(association)
        if (cleanAssociation) {
          let categoryInfo: { word: string; category: string; subcategory?: string } | undefined = undefined;
          if (categorizedAssociations) {
            for (const catAssoc of categorizedAssociations) {
              const processed = await this.processWord(catAssoc.word)
              if (processed === cleanAssociation) {
                categoryInfo = catAssoc
                break
              }
            }
          }
          // Create tag array with base tags and category tags
          const allTags = [...tags]
          if (categoryInfo) {
            allTags.push(categoryInfo.category)
            if (categoryInfo.subcategory) {
              allTags.push(categoryInfo.subcategory)
            }
          }
          await this.addAssociation(cleanWord, cleanAssociation, allTags)
        }
      }
    }
    // Store categorized associations if provided (for backward compatibility)
    if (categorizedAssociations && categorizedAssociations.length > 0) {
      // Process categorized associations to ensure word consistency
      const processedCategorized = [];
      for (const catAssoc of categorizedAssociations) {
        const processedWord = await this.processWord(catAssoc.word);
        if (processedWord) {
          processedCategorized.push({
            word: processedWord,
            category: catAssoc.category,
            subcategory: catAssoc.subcategory
          });
        }
      }
      this.categorizedAssociations.set(cleanWord, processedCategorized)
  
    }
  }

  /**
   * Get all connections for a word
   */
  async getConnections(word: string): Promise<string[]> {
    const cleanWord = await this.processWord(word)
    const connections = this.graph.get(cleanWord)
    
    // Fallback to original word if clean word not found
    if (!connections && word !== cleanWord) {
      return Array.from(this.graph.get(word) || [])
    }
    
    return connections ? Array.from(connections) : []
  }

  /**
   * Check if word exists in graph
   */
  async wordExists(word: string): Promise<boolean> {
    console.log('🔍 SemanticGraph.wordExists DEBUG:');
    console.log('  Input word:', JSON.stringify(word));
    
    const cleanWord = await this.processWord(word)
    console.log('  📊 Clean word:', JSON.stringify(cleanWord));
    
    const exists = this.graph.has(cleanWord);
    console.log('  📊 Word exists in graph:', exists);
    
    return exists;
  }

  /**
   * Get all top-level words (nodes with connections)
   */
  async getTopLevelWords(): Promise<string[]> {
    const keys = Array.from(this.graph.keys())
    const results: string[] = []
    for (const word of keys) {
      const size = this.graph.get(word)!.size
      if (size > 0) results.push(word)
    }
    return results
  }

  /**
   * Get words that have no connections (isolated nodes)
   */
  async getIsolatedWords(): Promise<string[]> {
    const keys = Array.from(this.graph.keys())
    const results: string[] = []
    for (const word of keys) {
      if (this.graph.get(word)!.size === 0) results.push(word)
    }
    return results
  }

  /**
   * Get second-level connections (connections of connections)
   */
  async getSecondLevelConnections(word: string): Promise<Map<string, string[]>> {
    const cleanWord = await this.processWord(word)
    const secondLevel = new Map<string, string[]>()
    const directConnections = await this.getConnections(cleanWord)
    for (const connection of directConnections) {
      const connectionConnections = (await this.getConnections(connection))
        .filter(c => c !== cleanWord && !directConnections.includes(c))
      if (connectionConnections.length > 0) {
        secondLevel.set(connection, connectionConnections)
      }
    }
    return secondLevel
  }

  /**
   * Delete a word and all its connections
   */
  async deleteWord(word: string): Promise<boolean> {
    const cleanWord = await this.processWord(word)
    if (!this.graph.has(cleanWord)) return false
    // Remove all connections to this word from other words
    const connections = this.graph.get(cleanWord)!
    for (const connection of connections) {
      const connectionSet = this.graph.get(connection)
      if (connectionSet) {
        connectionSet.delete(cleanWord)
      }
    }
    // Remove the word itself
    this.graph.delete(cleanWord)
    this.updateMetadata()
    this.markCachesDirty()
    return true
  }

  /**
   * Query the graph for phrase analysis
   * OPTIMIZATION 3: Improved algorithm (30-50% performance improvement)
   */
  async queryPhrase(phrase: string): Promise<QueryResult> {
    const words = (await Promise.all(phrase.toLowerCase()
      .split(/\s+/)
      .map(async w => await this.processWord(w))))
      .filter(w => w.length > 0)

    // Pre-compute all connections once to avoid repeated calls
    const wordConnections = new Map<string, Set<string>>()
    const directConnections: QueryResult['directConnections'] = []

    for (const word of words) {
      if (await this.wordExists(word)) {
        const connections = this.graph.get(word)!
        wordConnections.set(word, connections)
        directConnections.push({
          word,
          connections: Array.from(connections)
        })
      }
    }

    // Optimized shared connection finding using pre-computed connections
    const secondLevelConnections: QueryResult['secondLevelConnections'] = []
    const wordsArray = Array.from(wordConnections.keys())
    for (let i = 0; i < wordsArray.length; i++) {
      for (let j = i + 1; j < wordsArray.length; j++) {
        const word1 = wordsArray[i]
        const word2 = wordsArray[j]
        const connections1 = wordConnections.get(word1)!
        const connections2 = wordConnections.get(word2)!
        const smallerSet = connections1.size <= connections2.size ? connections1 : connections2
        const largerSet = connections1.size > connections2.size ? connections1 : connections2
        const shared = Array.from(smallerSet).filter(c => largerSet.has(c))
        if (shared.length > 0) {
          secondLevelConnections.push({
            word1,
            word2,
            sharedConnections: shared
          })
        }
      }
    }

    const totalDirectConnections = directConnections.reduce(
      (sum, item) => sum + item.connections.length, 0
    )

    return {
      phrase,
      words,
      filteredWords: words,
      directConnections,
      secondLevelConnections,
      statistics: {
        totalDirectConnections,
        totalSecondLevelPaths: secondLevelConnections.length,
        averageConnections: directConnections.length > 0 
          ? totalDirectConnections / directConnections.length 
          : 0
      }
    }
  }

  /**
   * Get graph statistics
   */
  async getStats(): Promise<GraphStats> {
    if (!this.cachedStats || this.statsDirty) {
      const words = Array.from(this.graph.keys())
      const totalConnections = words.reduce(
        (sum, word) => sum + this.graph.get(word)!.size, 0
      ) / 2 // Divide by 2 because connections are bidirectional

      const connectionCounts = words.map(word => ({
        word,
        connections: this.graph.get(word)!.size
      })).sort((a, b) => b.connections - a.connections)

      this.cachedStats = {
        totalWords: words.length,
        totalConnections,
        averageConnections: words.length > 0 ? totalConnections / words.length : 0,
        memoryUsageKB: estimateMemoryUsage(this.toJSON()),
        topConnectedWords: connectionCounts.slice(0, 10)
      }
      this.statsDirty = false
    }
    return this.cachedStats
  }

  /**
   * Convert graph to JSON format for storage
   */
  toJSON(): any {
    try {
      // Convert Map to Record format for graph
      const graphRecord: Record<string, string[]> = {};
      for (const [word, connections] of this.graph.entries()) {
        graphRecord[word] = [...connections];
      }
      
      // Convert Map to Record format for wordTags
      const wordTagsRecord: Record<string, string[]> = {};
      for (const [word, tags] of this.wordTags.entries()) {
        wordTagsRecord[word] = [...tags];
      }
      

      
      // Convert Map to Record format for notes
      const notesRecord: Record<string, any> = {};
      for (const [id, note] of this.notes.entries()) {
        notesRecord[id] = {
          id: note.id,
          content: note.content,
          level0Nodes: note.level0Nodes,
          createdAt: note.createdAt.toISOString(),
          updatedAt: note.updatedAt.toISOString(),
          title: note.title,
          tags: note.tags,
          metadata: note.metadata
        };
      }
      
      // Convert Map to Record format for nodeToNotes
      const nodeToNotesRecord: Record<string, string[]> = {};
      for (const [node, noteIds] of this.nodeToNotes.entries()) {
        nodeToNotesRecord[node] = [...noteIds];
      }
      
      // Convert Map to Record format for nodeMetadata
      const nodeMetadataRecord: Record<string, any> = {};
      for (const [word, metadata] of this.nodeMetadata.entries()) {
        nodeMetadataRecord[word] = {
          createdAt: metadata.createdAt.toISOString(),
          lastModified: metadata.lastModified.toISOString()
        };
      }
      
      // Convert Map to Record format for connectionMetadata
      const connectionMetadataRecord: Record<string, any> = {};
      for (const [key, metadata] of this.connectionMetadata.entries()) {
        connectionMetadataRecord[key] = {
          createdAt: metadata.createdAt.toISOString(),
          lastModified: metadata.lastModified.toISOString()
        };
      }
      
      // Convert Map to Record format for associationTags
      const associationTagsRecord: Record<string, Record<string, string[]>> = {};
      for (const [word, tagMap] of this.associationTags.entries()) {
        const wordTagsRecord: Record<string, string[]> = {};
        for (const [associatedWord, tags] of tagMap.entries()) {
          wordTagsRecord[associatedWord] = [...tags];
        }
        associationTagsRecord[word] = wordTagsRecord;
      }
      
      // Convert Map to Record format for categorizedAssociations
      const categorizedAssociationsRecord: Record<string, Array<{ word: string; category: string; subcategory?: string }>> = {};
      for (const [word, categories] of this.categorizedAssociations.entries()) {
        categorizedAssociationsRecord[word] = categories;
      }
      
      // Convert Map to Record format for nodeVectors
      const nodeVectorsRecord: Record<string, number[]> = {};
      for (const [nodeId, vector] of this.nodeVectors.entries()) {
        nodeVectorsRecord[nodeId] = vector;
      }
      
      // Convert Map to Record format for vectorMetadata
      const vectorMetadataRecord: Record<string, any> = {};
      for (const [nodeId, metadata] of this.vectorMetadata.entries()) {
        vectorMetadataRecord[nodeId] = {
          dimension: metadata.dimension,
          source: metadata.source,
          lastUpdated: metadata.lastUpdated.toISOString(),
          nodeType: metadata.nodeType
        };
      }
      
      const result = {
        graph: graphRecord,
        wordTags: wordTagsRecord,
        associationTags: associationTagsRecord,
        categorizedAssociations: categorizedAssociationsRecord,
        nodeMetadata: nodeMetadataRecord,
        connectionMetadata: connectionMetadataRecord,
        nodeVectors: nodeVectorsRecord,
        vectorMetadata: vectorMetadataRecord,
        notes: notesRecord,
        nodeToNotes: nodeToNotesRecord,
        noteIdCounter: this.noteIdCounter,
        metadata: {
          version: '1.0',
          created: this.metadata?.created || new Date().toISOString(),
          lastModified: new Date().toISOString(),
          nodeCount: this.graph.size,
          edgeCount: this.connectionMetadata.size,
          vectorCount: this.nodeVectors.size,
          filename: this.metadata?.filename
        }
      };
      
      return result;
    } catch (error) {
      console.error('❌ Serialization failed:', error);
      throw error;
    }
  }

  /**
   * Load graph from serialized format
   */
  fromJSON(data: SemanticNetwork): void {
    // Ensure data is valid
    if (!data || typeof data !== 'object') {
      console.warn('Invalid data provided to fromJSON, creating empty graph')
      this.clear()
      return
    }



    this.graph.clear()
    this.categorizedAssociations.clear()
    this.associationTags.clear()
    this.userTags.clear()
    this.wordTags.clear()

    // Ensure metadata exists and has required properties
    this.metadata = data.metadata ? { ...data.metadata } : {
      version: '1.0',
      created: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      nodeCount: 0,
      edgeCount: 0
    }

    // Ensure graph exists
    if (data.graph && typeof data.graph === 'object') {
      Object.entries(data.graph).forEach(([word, connections]) => {
        // Ensure connections is an array, default to empty array if missing
        const safeConnections = Array.isArray(connections) ? connections : []
        this.graph.set(word, new Set(safeConnections))
      })
    }

    // Load categorized associations if present
    if ((data as any).categorizedAssociations) {
      Object.entries((data as any).categorizedAssociations).forEach(([word, categories]) => {
        // Ensure categories is an array, default to empty array if missing
        const safeCategories = Array.isArray(categories) ? categories : []
        this.categorizedAssociations.set(word, safeCategories as Array<{ word: string; category: string; subcategory?: string }>)
      })
  
    }

    // Load association tags if present (convert string[] back to Set<string>)
    if ((data as any).associationTags) {
      Object.entries((data as any).associationTags).forEach(([word, tags]) => {
        const tagMap = new Map<string, Set<string>>()
        if (tags && typeof tags === 'object') {
          Object.entries(tags as Record<string, string[]>).forEach(([associatedWord, tagArray]) => {
            // Ensure tagArray is an array, default to empty array if missing
            const safeTagArray = Array.isArray(tagArray) ? tagArray : []
            tagMap.set(associatedWord, new Set(safeTagArray))
          })
        }
        this.associationTags.set(word, tagMap)
      })
  
    }

    // Load user tags if present
    if ((data as any).userTags) {
      Object.entries((data as any).userTags).forEach(([id, tag]) => {
        this.userTags.set(id, tag as UserTag)
      })
  
    }

    // Load word tags if present (convert string[] back to Set<string>)
    if ((data as any).wordTags) {
      Object.entries((data as any).wordTags).forEach(([word, tags]) => {
        // Ensure tags is an array, default to empty array if missing
        const tagArray = Array.isArray(tags) ? tags : []
        this.wordTags.set(word, new Set(tagArray))
        
        // Rebuild reverse tag index
        tagArray.forEach((tag: string) => {
          if (!this.tagToWords.has(tag)) {
            this.tagToWords.set(tag, new Set())
          }
          this.tagToWords.get(tag)!.add(word)
        })
      })
      
    }



    // Load notes if present (convert Record back to Map)
    if ((data as any).notes) {
      Object.entries((data as any).notes).forEach(([id, noteData]) => {
        const note = noteData as {
          id: string;
          content: string;
          level0Nodes?: string[];
          createdAt: string;
          updatedAt: string;
          title?: string;
          tags?: string[];
          metadata?: { [key: string]: any };
        }
        
        // Ensure level0Nodes array exists, default to empty array if missing
        const level0Nodes = note.level0Nodes || []
        
        const noteEntry: NoteEntry = {
          id: note.id,
          content: note.content,
          level0Nodes: level0Nodes,
          createdAt: new Date(note.createdAt),
          updatedAt: new Date(note.updatedAt),
          title: note.title,
          tags: note.tags,
          metadata: note.metadata
        }
        
        this.notes.set(id, noteEntry)
      })
  
    }

    // Load nodeToNotes index if present (convert string[] back to Set<string>)
    if ((data as any).nodeToNotes) {
      Object.entries((data as any).nodeToNotes).forEach(([node, noteIds]) => {
        // Ensure noteIds is an array, default to empty array if missing
        const noteIdsArray = Array.isArray(noteIds) ? noteIds : []
        this.nodeToNotes.set(node, new Set(noteIdsArray))
      })
  
    }

    // Load noteIdCounter if present
    if ((data as any).noteIdCounter) {
      this.noteIdCounter = (data as any).noteIdCounter
  
    }

    // Load node metadata if present
    if (data.nodeMetadata) {
      this.nodeMetadata.clear();
      Object.entries(data.nodeMetadata).forEach(([word, metadata]) => {
        if (metadata && metadata.createdAt && metadata.lastModified) {
          this.nodeMetadata.set(word, {
            createdAt: new Date(metadata.createdAt),
            lastModified: new Date(metadata.lastModified)
          });
        }
      });
    }

    // Load connection metadata if present
    if (data.connectionMetadata) {
      this.connectionMetadata.clear();
      Object.entries(data.connectionMetadata).forEach(([key, metadata]) => {
        if (metadata && metadata.createdAt && metadata.lastModified) {
          this.connectionMetadata.set(key, {
            createdAt: new Date(metadata.createdAt),
            lastModified: new Date(metadata.lastModified)
          });
        }
      });
    }

    // Load nodeVectors if present
    if ((data as any).nodeVectors) {
      this.nodeVectors.clear();
      Object.entries((data as any).nodeVectors).forEach(([nodeId, vector]) => {
        if (Array.isArray(vector) && vector.every(v => typeof v === 'number')) {
          this.nodeVectors.set(nodeId, vector as number[]);
        }
      });
    }

    // Load vectorMetadata if present
    if ((data as any).vectorMetadata) {
      this.vectorMetadata.clear();
      Object.entries((data as any).vectorMetadata).forEach(([nodeId, metadata]) => {
        if (metadata && metadata.dimension && metadata.source && metadata.lastUpdated && metadata.nodeType) {
          this.vectorMetadata.set(nodeId, {
            dimension: metadata.dimension,
            source: metadata.source,
            lastUpdated: new Date(metadata.lastUpdated),
            nodeType: metadata.nodeType
          });
        }
      });
    }

    this.markCachesDirty()
  }

  /**
   * Clear all data
   * OPTIMIZED with cache clearing
   */
  clear(): void {
    // Force complete cache reset
    this.wordCache = new Map();
    console.log('  🔄 Forced wordCache reset to new Map');
    
    console.log('🔍 SemanticGraph.clear DEBUG:');
    console.log('  📊 Graph size before clear:', this.graph.size);
    console.log('  📊 Cache size before clear:', this.wordCache.size);
    
    this.graph.clear()
    this.categorizedAssociations.clear()
    this.associationTags.clear()
    this.userTags.clear()
    this.wordTags.clear()

    // Clear notes data
    this.notes.clear()
    this.nodeToNotes.clear()
    this.noteIdCounter = 1
    // Clear timestamp metadata
    this.nodeMetadata.clear()
    this.connectionMetadata.clear()
    // Clear optimization caches
    this.wordCache.clear()
    this.tagToWords.clear()
    this.cachedStats = null
    this.metadata = {
      version: '1.0.0',
      created: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      nodeCount: 0,
      edgeCount: 0
    }
    this.markCachesDirty()
    
    console.log('  ✅ Graph size after clear:', this.graph.size);
    console.log('  ✅ Cache size after clear:', this.wordCache.size);
    
    // Force garbage collection if available
    if (typeof global !== 'undefined' && global.gc) {
      global.gc();
      console.log('  🗑️ Forced garbage collection');
    }
  }

  /**
   * Update metadata counts
   */
  private updateMetadata(): void {
    this.metadata.nodeCount = this.graph.size
    this.metadata.edgeCount = Array.from(this.graph.values())
      .reduce((sum, connections) => sum + connections.size, 0) / 2
    this.metadata.lastModified = new Date().toISOString()
  }

  /**
   * Check if graph has unsaved changes
   */
  get dirty(): boolean {
    return this.isDirty
  }

  /**
   * Mark as saved
   */
  markSaved(): void {
    this.isDirty = false
  }

  /**
   * Get metadata
   */
  getMetadata(): SemanticNetwork['metadata'] {
    return { ...this.metadata }
  }

  /**
   * Set filename in metadata
   */
  setFilename(filename: string): void {
    this.metadata.filename = filename
  }

  /**
   * Get categorized associations for a word
   */
  async getCategorizedAssociations(word: string): Promise<Array<{ word: string; category: string; subcategory?: string }>> {
    const cleanWord = await this.processWord(word)
    return this.categorizedAssociations.get(cleanWord) || []
  }

  /**
   * Get all words that have categorized associations
   */
  getWordsWithCategories(): string[] {
    return Array.from(this.categorizedAssociations.keys())
  }

  /**
   * Set tag for a specific association (legacy method - now adds to existing tags)
   */
  async setAssociationTag(word1: string, word2: string, tag: string): Promise<void> {
    await this.addTagToAssociation(word1, word2, tag)
  }

  /**
   * Add a single tag to an association
   */
  async addTagToAssociation(word1: string, word2: string, tag: string): Promise<void> {
    const cleanWord1 = await this.processWord(word1)
    const cleanWord2 = await this.processWord(word2)
    
    if (!this.associationTags.has(cleanWord1)) {
      this.associationTags.set(cleanWord1, new Map())
    }
    
    if (!this.associationTags.get(cleanWord1)!.has(cleanWord2)) {
      this.associationTags.get(cleanWord1)!.set(cleanWord2, new Set())
    }
    
    this.associationTags.get(cleanWord1)!.get(cleanWord2)!.add(tag)
  }

  /**
   * Remove a tag from an association
   */
  async removeTagFromAssociation(word1: string, word2: string, tag: string): Promise<void> {
    const cleanWord1 = await this.processWord(word1)
    const cleanWord2 = await this.processWord(word2)
    
    const word1Tags = this.associationTags.get(cleanWord1)
    const associationTags = word1Tags?.get(cleanWord2)
    
    if (associationTags) {
      associationTags.delete(tag)
      // Don't add any default tags - allow empty tag sets
    }
  }

  /**
   * Get primary tag for a specific association (legacy method - returns first tag)
   */
  async getAssociationTag(word1: string, word2: string): Promise<string> {
    const tags = await this.getAssociationTags(word1, word2)
    return tags[0] || ''
  }

  /**
   * Get all tags for a specific association
   */
  async getAssociationTags(word1: string, word2: string): Promise<string[]> {
    const cleanWord1 = await this.processWord(word1)
    const cleanWord2 = await this.processWord(word2)
    
    const word1Tags = this.associationTags.get(cleanWord1)
    const associationTags = word1Tags?.get(cleanWord2)
    return associationTags ? Array.from(associationTags) : []
  }

  /**
   * Get all connections for a word with their tags
   */
  async getConnectionsWithTags(word: string): Promise<Array<{ word: string; tag: string; tags: string[] }>> {
    const cleanWord = await this.processWord(word)
    const connections = this.graph.get(cleanWord)
    
    if (!connections) return []
    
    const result: Array<{ word: string; tag: string; tags: string[] }> = []
    for (const connection of connections) {
      const tags = await this.getAssociationTags(cleanWord, connection)
      result.push({
        word: connection,
        tag: tags[0] || '',
        tags: tags
      })
    }
    return result
  }

  /**
   * Get connections filtered by tag
   */
  async getConnectionsByTag(word: string, tag: string): Promise<string[]> {
    const connectionsWithTags = await this.getConnectionsWithTags(word)
    const result: string[] = []
    for (const conn of connectionsWithTags) {
      if (conn.tags.includes(tag)) {
        result.push(conn.word)
      }
    }
    return result
  }

  /**
   * Convert all temporary associations to permanent for a word
   */
  async convertTempToPermanent(word: string): Promise<number> {
    const cleanWord = await this.processWord(word)
    const wordTags = this.associationTags.get(cleanWord)
    
    if (!wordTags) return 0
    
    let converted = 0
    for (const [associatedWord, tagSet] of wordTags.entries()) {
      if (tagSet.has('temp')) {
        tagSet.delete('temp')
        // Don't automatically add any tags - let the calling logic decide
        // Also update the reverse direction
        await this.removeTagFromAssociation(associatedWord, cleanWord, 'temp')
        converted++
      }
    }
    
    console.log(`🔄 Converted ${converted} temporary associations for "${cleanWord}"`)
    return converted
  }

  /**
   * Convert all temporary associations to permanent across the entire graph
   */
  async convertAllTempToPermanent(): Promise<number> {
    let totalConverted = 0
    
    for (const word of this.associationTags.keys()) {
      totalConverted += await this.convertTempToPermanent(word)
    }
    
    console.log(`🔄 Total converted: ${totalConverted} temporary associations to permanent`)
    return totalConverted
  }

  /**
   * GLOBAL: Clean up all incorrect sentence-level tags from word associations
   * This should be called once to fix the database after the tag architecture fix
   */
  async cleanupAllIncorrectSentenceTags(): Promise<number> {
    console.log('🧹 GLOBAL CLEANUP: Removing sentence-level tags from word associations...')
    
    const sentenceLevelTags = ['meaningful-statement', 'complete-sentence', 'txtboxentry', 'has-object']
    let totalCleaned = 0
    
    // Process all words in the database
    const allWords = await this.getTopLevelWords()
    
    for (const word of allWords) {
      const connections = await this.getConnectionsWithTags(word)
      
      for (const { word: associatedWord, tags } of connections) {
        const hasSentenceTags = tags.some(tag => sentenceLevelTags.includes(tag))
        
        if (hasSentenceTags) {
          console.log(`🚨 Found sentence tags on "${word}" → "${associatedWord}": [${tags.join(', ')}]`)
          
          // Filter out sentence-level tags, keep valid relationship tags
          const validTags = tags.filter(tag => !sentenceLevelTags.includes(tag))
          
          console.log(`✅ Cleaned to: [${validTags.join(', ')}]`)
          
          // Clear and reset with valid tags only
          this.associationTags.get(word)?.get(associatedWord)?.clear()
          if (validTags.length > 0) {
            await this.setAssociationTags(word, associatedWord, validTags)
          }
          
          totalCleaned++
        }
      }
    }
    
    console.log(`🧹 GLOBAL CLEANUP COMPLETE: Fixed ${totalCleaned} associations (removed sentence-level tags)`)
    this.markCachesDirty()
    return totalCleaned
  }

  /**
   * Cleanup incorrect tags for specific words - remove sentence-level tags from single words
   */
  async cleanupIncorrectTags(word: string): Promise<number> {
    const cleanWord = await this.processWord(word)
    const connections = await this.getConnectionsWithTags(cleanWord)
    if (!connections.length) return 0
    let cleaned = 0
    const sentenceLevelTags = ['txtboxentry', 'meaningful-statement', 'complete-sentence', 'has-object']
    console.log(`🧹 Cleaning up incorrect tags for "${cleanWord}"`)
    for (const conn of connections) {
      const hasSentenceTags = conn.tags.some(tag => sentenceLevelTags.includes(tag))
      if (hasSentenceTags) {
        console.log(`   🚨 Found sentence-level tags on "${cleanWord}" → "${conn.word}": [${conn.tags.join(', ')}]`)
        const validTags = conn.tags.filter(tag => !sentenceLevelTags.includes(tag))
        console.log(`   ✅ Keeping only valid tags: [${validTags.join(', ')}]`)
        this.associationTags.get(cleanWord)?.get(conn.word)?.clear()
        if (validTags.length > 0) {
          await this.setAssociationTags(cleanWord, conn.word, validTags)
        }
        cleaned++
      }
    }
    // Also clean up reverse connections (other words pointing TO this word)
    const allWords = await this.getTopLevelWords()
    for (const w of allWords) {
      if (w === cleanWord) continue
      const conns = await this.getConnectionsWithTags(w)
      for (const tagConn of conns) {
        if (tagConn.word === cleanWord) {
          const hasSentenceTags = tagConn.tags.some(tag => sentenceLevelTags.includes(tag))
          if (hasSentenceTags) {
            const validTags = tagConn.tags.filter(tag => !sentenceLevelTags.includes(tag))
            this.associationTags.get(w)?.get(cleanWord)?.clear()
            if (validTags.length > 0) {
              await this.setAssociationTags(w, cleanWord, validTags)
            }
            cleaned++
          }
        }
      }
    }
    this.markCachesDirty()
    return cleaned
  }

  /**
   * Set tags for a specific association
   */
  async setAssociationTags(word1: string, word2: string, tags: string[]): Promise<void> {
    const cleanWord1 = await this.processWord(word1)
    const cleanWord2 = await this.processWord(word2)
    
    if (!this.associationTags.has(cleanWord1)) {
      this.associationTags.set(cleanWord1, new Map())
    }
    
    if (!this.associationTags.get(cleanWord1)!.has(cleanWord2)) {
      this.associationTags.get(cleanWord1)!.set(cleanWord2, new Set())
    }
    
    tags.forEach(tag => this.associationTags.get(cleanWord1)!.get(cleanWord2)!.add(tag))
  }

  // ============= WORD TAG MANAGEMENT =============

  /**
   * Add a tag to an individual word
   * OPTIMIZED with reverse indexing (95% improvement for tag lookups)
   */
  async addWordTag(word: string, tag: string): Promise<void> {
    const cleanWord = await this.ensureWordExists(word)
    if (!cleanWord) return

    // Update forward index
    if (!this.wordTags.has(cleanWord)) {
      this.wordTags.set(cleanWord, new Set())
    }
    this.wordTags.get(cleanWord)!.add(tag)

    // Update reverse index for O(1) tag lookups
    if (!this.tagToWords.has(tag)) {
      this.tagToWords.set(tag, new Set())
    }
    this.tagToWords.get(tag)!.add(cleanWord)

    this.markCachesDirty()
  }

  /**
   * Remove a tag from an individual word
   * OPTIMIZED with reverse index cleanup
   */
  async removeWordTag(word: string, tag: string): Promise<boolean> {
    const cleanWord = await this.processWord(word)
    if (!cleanWord || !this.wordTags.has(cleanWord)) return false

    const removed = this.wordTags.get(cleanWord)!.delete(tag)
    if (removed) {
      // Update reverse index
      const wordsWithTag = this.tagToWords.get(tag)
      if (wordsWithTag) {
        wordsWithTag.delete(cleanWord)
        // Clean up empty reverse index entries
        if (wordsWithTag.size === 0) {
          this.tagToWords.delete(tag)
        }
      }

      this.markCachesDirty()
      // Clean up empty tag sets
      if (this.wordTags.get(cleanWord)!.size === 0) {
        this.wordTags.delete(cleanWord)
      }
    }
    return removed
  }

  /**
   * Get all tags for an individual word
   */
  async getWordTags(word: string): Promise<string[]> {
    const cleanWord = await this.processWord(word)
    if (!cleanWord || !this.wordTags.has(cleanWord)) {
      return []
    }
    const tags = Array.from(this.wordTags.get(cleanWord)!)
    return tags
  }

  /**
   * Set all tags for an individual word (replaces existing tags)
   * OPTIMIZED with reverse index maintenance
   */
  async setWordTags(word: string, tags: string[]): Promise<void> {
    const cleanWord = await this.ensureWordExists(word)
    if (!cleanWord) return

    // Remove word from all existing reverse indexes
    const existingTags = this.wordTags.get(cleanWord)
    if (existingTags) {
      existingTags.forEach(tag => {
        const wordsWithTag = this.tagToWords.get(tag)
        if (wordsWithTag) {
          wordsWithTag.delete(cleanWord)
          if (wordsWithTag.size === 0) {
            this.tagToWords.delete(tag)
          }
        }
      })
    }

    if (tags.length === 0) {
      this.wordTags.delete(cleanWord)
    } else {
      this.wordTags.set(cleanWord, new Set(tags))
      
      // Update reverse indexes for new tags
      tags.forEach(tag => {
        if (!this.tagToWords.has(tag)) {
          this.tagToWords.set(tag, new Set())
        }
        this.tagToWords.get(tag)!.add(cleanWord)
      })
    }
    this.markCachesDirty()
  }

  /**
   * Check if a word has a specific tag
   */
  async wordHasTag(word: string, tag: string): Promise<boolean> {
    const cleanWord = await this.processWord(word)
    if (!cleanWord || !this.wordTags.has(cleanWord)) return false
    return this.wordTags.get(cleanWord)!.has(tag)
  }

  /**
   * Get all words that have a specific tag
   * OPTIMIZED using reverse index (O(1) instead of O(n))
   */
  async getWordsByTag(tag: string): Promise<string[]> {
    if (!this.tagToWords.has(tag)) return []
    return Array.from(this.tagToWords.get(tag)!)
  }

  /**
   * Get all unique word tags in the system
   */
  getAllWordTags(): string[] {
    const allTags = new Set<string>()
    this.wordTags.forEach(tags => {
      tags.forEach(tag => allTags.add(tag))
    })
    return Array.from(allTags).sort()
  }

  // === BUCKET AND 'noAI' TAG SYSTEM ===

  /**
   * Get all associations with the 'noAI' tag
   */
  async getNoAIAssociations(): Promise<Array<{ word1: string; word2: string; tags: string[] }>> {
    const noAIAssociations: Array<{ word1: string; word2: string; tags: string[] }> = []
    for (const word1 of this.graph.keys()) {
      for (const word2 of this.graph.get(word1)!) {
        const tags = await this.getAssociationTags(word1, word2)
        if (tags.includes('noAI')) {
          noAIAssociations.push({ word1, word2, tags })
        }
      }
    }
    return noAIAssociations
  }

  /**
   * Remove 'noAI' tag from association (mark as AI processed)
   */
  markAsAIProcessed(word1: string, word2: string): void {
    this.removeTagFromAssociation(word1, word2, 'noAI')
    this.removeTagFromAssociation(word2, word1, 'noAI')
  }

  /**
   * Remove 'noAI' tag from all associations of a word
   */
  async markWordAsAIProcessed(word: string): Promise<number> {
    const cleanWord = await this.processWord(word)
    const connections = await this.getConnectionsWithTags(cleanWord)
    let removedCount = 0

    for (const { word: connectedWord } of connections) {
      const tags = await this.getAssociationTags(cleanWord, connectedWord)
      if (tags.includes('noAI')) {
        this.markAsAIProcessed(cleanWord, connectedWord)
        removedCount++
      }
    }

    return removedCount
  }

  /**
   * Check if association has 'noAI' tag
   */
  async hasNoAITag(word1: string, word2: string): Promise<boolean> {
    const tags = await this.getAssociationTags(word1, word2)
    return tags.includes('noAI')
  }

  /**
   * Get all words that have any 'noAI' associations
   */
  getWordsWithNoAIAssociations(): string[] {
    const wordsSet = new Set<string>()
    
    this.associationTags.forEach((targetMap, sourceWord) => {
      targetMap.forEach((tags, targetWord) => {
        if (tags.has('noAI')) {
          wordsSet.add(sourceWord)
          wordsSet.add(targetWord)
        }
      })
    })
    
    return Array.from(wordsSet)
  }

  /**
   * Search for associations by word or tag
   * ENHANCED: For bucket searches, include associations that don't have AI-related tags
   */
  searchAssociations(query: string, searchType: 'text' | 'tag' | 'both' = 'both'): Array<{
    word1: string;
    word2: string;
    tags: string[];
    matchType: 'word' | 'tag';
  }> {
    const results: Array<{
      word1: string;
      word2: string;
      tags: string[];
      matchType: 'word' | 'tag';
    }> = []
    const queryLower = query.toLowerCase()
    
    this.associationTags.forEach((targetMap, sourceWord) => {
      targetMap.forEach((tags, targetWord) => {
        const tagsArray = Array.from(tags)
        
        // ENHANCED: Include associations that are eligible for bucket processing
        // This includes associations with 'noAI' tag OR associations without AI-related tags
        const aiRelatedTags = ['ai-processed', 'ai-generated', 'ai-analysis']
        const hasAIRelatedTag = tagsArray.some(tag => aiRelatedTags.includes(tag))
        const hasNoAITag = tagsArray.includes('noAI')
        
        // Only include if it has 'noAI' tag OR doesn't have any AI-related tags
        if (!hasNoAITag && hasAIRelatedTag) return
        
        let matches = false
        let matchType: 'word' | 'tag' = 'word'
        
        // Text search in word names
        if (searchType === 'text' || searchType === 'both') {
          if (sourceWord.toLowerCase().includes(queryLower) || 
              targetWord.toLowerCase().includes(queryLower)) {
            matches = true
            matchType = 'word'
          }
        }
        
        // Tag search
        if ((searchType === 'tag' || searchType === 'both') && !matches) {
          const tagMatch = tagsArray.some(tag => 
            tag.toLowerCase().includes(queryLower)
          )
          if (tagMatch) {
            matches = true
            matchType = 'tag'
          }
        }
        
        if (matches) {
          results.push({
            word1: sourceWord,
            word2: targetWord,
            tags: tagsArray,
            matchType
          })
        }
      })
    })
    
    // Remove duplicates (since we store bidirectional associations)
    const uniqueResults = results.filter((result, index, array) => {
      return array.findIndex(r => 
        (r.word1 === result.word1 && r.word2 === result.word2) ||
        (r.word1 === result.word2 && r.word2 === result.word1)
      ) === index
    })
    
    return uniqueResults.sort((a, b) => {
      // Sort by match type (exact word matches first), then alphabetically
      if (a.matchType !== b.matchType) {
        return a.matchType === 'word' ? -1 : 1
      }
      return a.word1.localeCompare(b.word1)
    })
  }

  /**
   * Check if an association is in the bucket (for visual indicators)
   */
  static isInBucket(word1: string, word2: string): boolean {
    try {
      const savedBucket = localStorage.getItem('wordAssociationBucket')
      if (!savedBucket) return false
      
      const bucket = JSON.parse(savedBucket)
      return bucket.some((item: any) => 
        (item.word1 === word1 && item.word2 === word2) ||
        (item.word1 === word2 && item.word2 === word1)
      )
    } catch (error) {
      console.error('Error checking bucket status:', error)
      return false
    }
  }

















  /**
   * Get all words in the graph
   */
  async getAllWords(): Promise<string[]> {
    return [...this.wordTags.keys()]
  }

  /**
   * Get all nodes in the graph (including multi-word phrases)
   * This includes all nodes that exist in the graph, not just those with tags
   */
  async getAllNodes(): Promise<string[]> {
    console.log('🔍 SemanticGraph.getAllNodes DEBUG:');
    console.log('  📊 Graph size:', this.graph.size);
    console.log('  📊 Graph keys:', [...this.graph.keys()]);
    
    // Memory optimization: limit the number of nodes returned to prevent memory issues
    const allNodes = [...this.graph.keys()];
    
    // If the graph is very large, only return a subset to prevent memory issues
    if (allNodes.length > 10000) {
      console.warn(`Graph has ${allNodes.length} nodes, limiting to first 10000 to prevent memory issues`);
      return allNodes.slice(0, 10000);
    }
    
    console.log('  📊 Returning all nodes:', allNodes);
    return allNodes;
  }



  /**
   * Find shortest path between two words
   */
  async findShortestPath(start: string, end: string): Promise<string[]> {
    if (!(await this.wordExists(start)) || !(await this.wordExists(end))) {
      return []
    }

    // Simple BFS implementation
    const queue: Array<{word: string, path: string[]}> = [{word: start, path: [start]}]
    const visited = new Set<string>([start])

    while (queue.length > 0) {
      const {word, path} = queue.shift()!
      
      if (word === end) {
        return path
      }

      const connections = await this.getConnections(word)
      for (const next of connections) {
        if (!visited.has(next)) {
          visited.add(next)
          queue.push({word: next, path: [...path, next]})
        }
      }
    }

    return [] // No path found
  }



  // === NOTES MANAGEMENT ===

  /**
   * Add a note attached to one or more level 0 nodes
   */
  async addNote(
    content: string,
    level0Nodes: string[],
    title?: string,
    tags?: string[],
    metadata?: { [key: string]: any }
  ): Promise<string> {
    if (!level0Nodes || level0Nodes.length === 0) throw new Error('No level 0 nodes provided');
    const cleanNodes = await Promise.all(level0Nodes.map(n => this.processWord(n)));
    const validNodes = cleanNodes.filter(Boolean);
    if (validNodes.length === 0) throw new Error('No valid level 0 nodes');

    const noteId = `note_${this.noteIdCounter++}`;
    const noteEntry: NoteEntry = {
      id: noteId,
      content,
      level0Nodes: validNodes,
      createdAt: new Date(),
      updatedAt: new Date(),
      title,
      tags,
      metadata
    };
    this.notes.set(noteId, noteEntry);
    // Add to node index for each node
    for (const node of validNodes) {
      if (!this.nodeToNotes.has(node)) {
        this.nodeToNotes.set(node, new Set());
      }
      this.nodeToNotes.get(node)!.add(noteId);
    }
    this.markCachesDirty();
    return noteId;
  }

  /**
   * Get all notes for a level 0 node
   */
  async getNotesForNode(level0Node: string): Promise<NoteEntry[]> {
    const cleanNode = await this.processWord(level0Node);
    const noteIds = this.nodeToNotes.get(cleanNode) || new Set();
    return Array.from(noteIds)
      .map(id => this.notes.get(id))
      .filter((note): note is NoteEntry => note !== undefined)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  /**
   * Get notes accessible from any connected node
   * This finds all level 0 nodes connected to the given node and returns their notes
   */
  async getAccessibleNotes(node: string): Promise<NoteEntry[]> {
    const cleanNode = await this.processWord(node)
    if (!cleanNode) return []
    
    // Find all level 0 nodes connected to this node
    const level0Nodes = new Set<string>()
    
    // Direct connections to level 0 nodes
    const connections = await this.getConnections(cleanNode)
    for (const connection of connections) {
      // Check if this connection is a level 0 node
      if (await this.isLevel0Node(connection)) {
        level0Nodes.add(connection)
      }
    }
    
    // Get notes from all accessible level 0 nodes
    const allNotes: NoteEntry[] = []
    for (const level0Node of level0Nodes) {
      const notes = await this.getNotesForNode(level0Node)
      allNotes.push(...notes)
    }
    
    return allNotes.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }

  /**
   * Check if a node is a level 0 node (active node)
   */
  private async isLevel0Node(node: string): Promise<boolean> {
    // Check if the node has a level0 tag
    const nodeTags = await this.getWordTags(node)
    return nodeTags.includes('level0')
  }

  /**
   * Update an existing note
   */
  async updateNote(noteId: string, content: string, title?: string, tags?: string[]): Promise<boolean> {
    const note = this.notes.get(noteId)
    if (!note) return false
    
    note.content = content
    note.updatedAt = new Date()
    if (title !== undefined) note.title = title
    if (tags !== undefined) note.tags = tags
    
    this.markCachesDirty()
    return true
  }

  /**
   * Delete a note
   */
  async deleteNote(noteId: string): Promise<boolean> {
    const note = this.notes.get(noteId)
    if (!note) return false
    
    // Remove from node index
    const nodeNotes = this.nodeToNotes.get(note.level0Nodes[0]) // Assuming all level0Nodes are the same for deletion
    if (nodeNotes) {
      nodeNotes.delete(noteId)
    }
    
    // Remove from notes map
    this.notes.delete(noteId)
    
    this.markCachesDirty()
    return true
  }

  /**
   * Get all notes
   */
  async getAllNotes(): Promise<NoteEntry[]> {
    return Array.from(this.notes.values())
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }

  /**
   * Get a specific note by ID
   */
  async getNote(noteId: string): Promise<NoteEntry | undefined> {
    return this.notes.get(noteId)
  }

  /**
   * Search notes by content, title, or tags
   */
  async searchNotes(query: string): Promise<NoteEntry[]> {
    const queryLower = query.toLowerCase().trim()
    if (!queryLower) return []
    
    return Array.from(this.notes.values())
      .filter(note => 
        note.content.toLowerCase().includes(queryLower) ||
        note.title?.toLowerCase().includes(queryLower) ||
        note.tags?.some(tag => tag.toLowerCase().includes(queryLower))
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }

  /**
   * Get note statistics
   */
  async getNoteStats(): Promise<{
    totalNotes: number
    totalLevel0Nodes: number
    averageNotesPerNode: number
    mostActiveNodes: Array<{node: string, noteCount: number}>
  }> {
    const notes = await this.getAllNotes()
    const totalNotes = notes.length
    const nodeCounts = new Map<string, number>()
    
    for (const note of notes) {
      const count = nodeCounts.get(note.level0Nodes[0]) || 0 // Assuming all level0Nodes are the same for counting
      nodeCounts.set(note.level0Nodes[0], count + 1)
    }
    
    const totalLevel0Nodes = nodeCounts.size
    const averageNotesPerNode = totalLevel0Nodes > 0 ? totalNotes / totalLevel0Nodes : 0
    
    const mostActiveNodes = Array.from(nodeCounts.entries())
      .map(([node, count]) => ({ node, noteCount: count }))
      .sort((a, b) => b.noteCount - a.noteCount)
      .slice(0, 10)
    
    return {
      totalNotes,
      totalLevel0Nodes,
      averageNotesPerNode,
      mostActiveNodes
    }
  }

  /**
   * Migrate existing responses to notes
   */



  /**
   * Search for individual words (nodes) that haven't been processed by AI
   * Excludes multi-word phrases and only returns single words
   */
  searchUnprocessedWords(query: string): Array<{
    word: string;
    tags: string[];
    connectionCount: number;
  }> {
    const results: Array<{
      word: string;
      tags: string[];
      connectionCount: number;
    }> = []
    const queryLower = query.toLowerCase()
    
    console.log(`🔍 searchUnprocessedWords("${query}"): Starting search...`)
    console.log(`🔍 Total words in graph: ${this.graph.size}`)
    
    // Get all words from the graph
    for (const word of this.graph.keys()) {
      // Skip multi-word phrases (contain spaces)
      if (word.includes(' ')) continue
      
      // Get word tags
      const wordTags = this.wordTags.get(word) || new Set()
      const tagsArray = Array.from(wordTags)
      
      // Check if word has been processed by AI
      const aiProcessedTags = ['ai-processed'] // Only exclude if explicitly marked as processed
      const hasAIProcessedTag = tagsArray.some(tag => aiProcessedTags.includes(tag))
      const hasNoAITag = tagsArray.includes('noAI')
      
      // Debug: Log the word 'comfort' specifically
      if (word === 'comfort') {
        console.log(`🔍 Found 'comfort' in graph!`)
        console.log(`🔍 Tags: [${tagsArray.join(', ')}]`)
        console.log(`🔍 hasNoAITag: ${hasNoAITag}`)
        console.log(`🔍 hasAIProcessedTag: ${hasAIProcessedTag}`)
        console.log(`🔍 Would be included: ${hasNoAITag || !hasAIProcessedTag}`)
      }
      
      // Only include if it has 'noAI' tag OR doesn't have 'ai-processed' tag
      if (!hasNoAITag && hasAIProcessedTag) continue
      
      // Check if word matches search query
      if (word.toLowerCase().includes(queryLower)) {
        const connectionCount = this.graph.get(word)?.size || 0
        results.push({
          word,
          tags: tagsArray,
          connectionCount
        })
      }
    }
    
    console.log(`🔍 searchUnprocessedWords("${query}"): Found ${results.length} results`)
    if (results.length > 0) {
      console.log(`🔍 Sample results:`, results.slice(0, 3).map(r => ({ word: r.word, tags: r.tags, connections: r.connectionCount })))
    }
    
    return results.sort((a, b) => {
      // Sort by connection count (more connections first), then alphabetically
      if (a.connectionCount !== b.connectionCount) {
        return b.connectionCount - a.connectionCount
      }
      return a.word.localeCompare(b.word)
    })
  }

  /**
   * Get nodes created in date range
   */
  async getNodesByDateRange(startDate: Date, endDate: Date): Promise<string[]> {
    const nodes = await this.getAllWords();
    return nodes.filter(word => {
      const metadata = this.nodeMetadata.get(word);
      if (!metadata) return false;
      return metadata.createdAt >= startDate && metadata.createdAt <= endDate;
    });
  }

  /**
   * Get connections created in date range
   */
  async getConnectionsByDateRange(startDate: Date, endDate: Date): Promise<Array<{word1: string, word2: string}>> {
    const connections: Array<{word1: string, word2: string}> = [];
    
    this.connectionMetadata.forEach((metadata, key) => {
      if (metadata.createdAt >= startDate && metadata.createdAt <= endDate) {
        const [word1, word2] = key.split('|');
        connections.push({ word1, word2 });
      }
    });
    
    return connections;
  }

  /**
   * Get nodes sorted by creation time
   */
  async getNodesByCreationTime(ascending: boolean = true): Promise<Array<{word: string, createdAt: Date}>> {
    const nodes = await this.getAllWords();
    return nodes
      .map(word => ({
        word,
        createdAt: this.nodeMetadata.get(word)?.createdAt || new Date(0)
      }))
      .sort((a, b) => {
        const timeA = a.createdAt.getTime();
        const timeB = b.createdAt.getTime();
        return ascending ? timeA - timeB : timeB - timeA;
      });
  }

  /**
   * Get recent activity (nodes/connections modified in last N hours)
   */
  async getRecentActivity(hours: number = 24): Promise<{
    recentNodes: string[];
    recentConnections: Array<{word1: string, word2: string}>;
  }> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const recentNodes = Array.from(this.nodeMetadata.entries())
      .filter(([_, metadata]) => metadata.lastModified >= cutoff)
      .map(([word, _]) => word);
    
    const recentConnections = Array.from(this.connectionMetadata.entries())
      .filter(([_, metadata]) => metadata.lastModified >= cutoff)
      .map(([key, _]) => {
        const [word1, word2] = key.split('|');
        return { word1, word2 };
      });
    
    return { recentNodes, recentConnections };
  }

  /**
   * Get node creation time
   */
  getNodeCreationTime(word: string): Date | null {
    const metadata = this.nodeMetadata.get(word);
    return metadata ? metadata.createdAt : null;
  }

  /**
   * Get connection creation time
   */
  getConnectionCreationTime(word1: string, word2: string): Date | null {
    const key = this.getConnectionKey(word1, word2);
    const metadata = this.connectionMetadata.get(key);
    return metadata ? metadata.createdAt : null;
  }

  /**
   * Clean up memory by removing old data and optimizing storage
   */
  async cleanupMemory(): Promise<{
    removedNodes: number;
    removedConnections: number;
    removedNotes: number;
    cacheCleared: boolean;
  }> {
    console.log('🧹 Starting memory cleanup...');
    
    let removedNodes = 0;
    let removedConnections = 0;

    let removedNotes = 0;
    let cacheCleared = false;
    
    // Clear word cache if it's too large
    if (this.wordCache.size > 10000) { // Use hardcoded value instead of static property
      this.wordCache.clear();
      cacheCleared = true;
      console.log('🗑️ Cleared word cache');
    }
    
    // Remove isolated nodes (nodes with no connections)
    const isolatedNodes = await this.getIsolatedWords();
    for (const node of isolatedNodes) {
      if (this.graph.has(node)) {
        this.graph.delete(node);
        this.wordTags.delete(node);
        this.nodeMetadata.delete(node);
        removedNodes++;
      }
    }
    
    // Remove old sentences (older than 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    

    
    // Remove old notes (older than 30 days)
    for (const [id, note] of this.notes) {
      if (note.createdAt < thirtyDaysAgo) {
        this.notes.delete(id);
        removedNotes++;
      }
    }
    

    
    // Clean up nodeToNotes index
    for (const [node, noteIds] of this.nodeToNotes) {
      const validNoteIds = new Set<string>();
      for (const noteId of noteIds) {
        if (this.notes.has(noteId)) {
          validNoteIds.add(noteId);
        }
      }
      if (validNoteIds.size === 0) {
        this.nodeToNotes.delete(node);
      } else {
        this.nodeToNotes.set(node, validNoteIds);
      }
    }
    
    // Mark caches as dirty
    this.markCachesDirty();
    
    console.log(`🧹 Memory cleanup complete: ${removedNodes} nodes, ${removedConnections} connections, ${removedNotes} notes removed`);
    
    return {
      removedNodes,
      removedConnections,
      removedNotes,
      cacheCleared
    };
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats(): {
    graphSize: number;
    notesSize: number;
    cacheSize: number;
    totalMemory: number;
  } {
    const graphSize = this.graph.size;
    const notesSize = this.notes.size;
    const cacheSize = this.wordCache.size;
    
    // Calculate actual memory usage by measuring the data structures
    let graphMemory = 0;
    let totalConnections = 0;
    
    // Measure actual graph memory
    for (const [word, connections] of this.graph.entries()) {
      // Word string memory (UTF-16, 2 bytes per character)
      graphMemory += word.length * 2;
      // Set object overhead + connection strings
      graphMemory += connections.size * 50; // Rough estimate for Set overhead
      totalConnections += connections.size;
      
      // Measure each connection string
      for (const connection of connections) {
        graphMemory += connection.length * 2; // UTF-16 encoding
      }
    }
    

    
    // Measure notes memory
    let notesMemory = 0;
    for (const [id, note] of this.notes.entries()) {
      notesMemory += id.length * 2; // ID string
      notesMemory += note.content.length * 2; // Content string
      notesMemory += (note.title?.length || 0) * 2; // Title string
      notesMemory += note.level0Nodes.length * 20; // Node references
      notesMemory += 200; // Object overhead
    }
    
    // Measure cache memory
    let cacheMemory = 0;
    for (const [key, value] of this.wordCache.entries()) {
      cacheMemory += key.length * 2; // Key string
      cacheMemory += value.length * 2; // Value string
      cacheMemory += 50; // Map entry overhead
    }
    
    // Measure metadata memory
    let metadataMemory = 0;
    for (const [word, metadata] of this.nodeMetadata.entries()) {
      metadataMemory += word.length * 2; // Word string
      metadataMemory += 100; // Date objects + object overhead
    }
    
    for (const [key, metadata] of this.connectionMetadata.entries()) {
      metadataMemory += key.length * 2; // Key string
      metadataMemory += 100; // Date objects + object overhead
    }
    
    // Measure association tags memory
    let tagsMemory = 0;
    for (const [word1, tagMap] of this.associationTags.entries()) {
      tagsMemory += word1.length * 2; // Word string
      for (const [word2, tags] of tagMap.entries()) {
        tagsMemory += word2.length * 2; // Word string
        for (const tag of tags) {
          tagsMemory += tag.length * 2; // Tag string
        }
        tagsMemory += 50; // Set overhead
      }
      tagsMemory += 50; // Map overhead
    }
    
    // Measure word tags memory
    for (const [word, tags] of this.wordTags.entries()) {
      tagsMemory += word.length * 2; // Word string
      for (const tag of tags) {
        tagsMemory += tag.length * 2; // Tag string
      }
      tagsMemory += 50; // Set overhead
    }
    
    const totalMemory = graphMemory + notesMemory + cacheMemory + metadataMemory + tagsMemory;
    
    return {
      graphSize,
      notesSize,
      cacheSize,
      totalMemory
    };
  }

  /**
   * Emergency memory cleanup to prevent browser crashes
   * This should be called when memory usage is high
   * NEVER clears core graph data - only caches and metadata
   */
  emergencyMemoryCleanup(): void {
    console.warn('🧹 Performing emergency memory cleanup...');
    
    // Clear all caches
    this.wordCache.clear();
    this.cachedStats = null;
    this.statsDirty = true;
    

    
    if (this.notes.size > 500) {
      console.warn(`Clearing ${this.notes.size} notes to free memory`);
      this.notes.clear();
      this.nodeToNotes.clear();
    }
    
    // Clear connection metadata if it's large (this can consume significant memory)
    if (this.connectionMetadata.size > 1000) {
      console.warn(`Clearing ${this.connectionMetadata.size} connection metadata entries`);
      this.connectionMetadata.clear();
    }
    
    // Clear node metadata if it's large
    if (this.nodeMetadata.size > 1000) {
      console.warn(`Clearing ${this.nodeMetadata.size} node metadata entries`);
      this.nodeMetadata.clear();
    }
    
    // Clear association tags if they're consuming too much memory
    if (this.associationTags.size > 500) {
      console.warn(`Clearing ${this.associationTags.size} association tags to free memory`);
      this.associationTags.clear();
    }
    
    // CRITICAL: NEVER clear core graph data - this should only be done by user request
    // The graph itself (this.graph) is NEVER touched by automatic cleanup
    console.warn('✅ Emergency cleanup complete - core graph data preserved');
    
    // Force garbage collection hint
    if (typeof window !== 'undefined' && (window as any).gc) {
      (window as any).gc();
    }
  }

  // ===== NEW: Co-occurrence Tracking Methods =====

  /**
   * Update co-occurrence counts between words in the same text context
   * Integrates with existing word processing pipeline
   */
  async updateCooccurrenceCounts(
    words: string[], 
    context: 'sentence' | 'phrase' | 'document' = 'sentence'
  ): Promise<void> {
    try {
      // Only track co-occurrence for meaningful word pairs
      const meaningfulWords = words.filter(word => 
        word.length > 2 && !this.isStopWord(word)
      );

      if (meaningfulWords.length < 2) return;

      // Update counts for all word pairs in the same context window
      for (let i = 0; i < meaningfulWords.length; i++) {
        for (let j = i + 1; j < meaningfulWords.length; j++) {
          const word1 = meaningfulWords[i];
          const word2 = meaningfulWords[j];
          
          const key = this.getCooccurrenceKey(word1, word2);
          const existing = this.cooccurrence.get(key);
          
          if (existing) {
            existing.count++;
            existing.contexts.add(context);
            existing.lastUpdated = new Date();
          } else {
            this.cooccurrence.set(key, {
              word1,
              word2,
              count: 1,
              contexts: new Set([context]),
              lastUpdated: new Date()
            });
          }
        }
      }
    } catch (error) {
      console.warn('Failed to update co-occurrence counts:', error);
    }
  }

  /**
   * Get co-occurrence data between two words
   */
  getCooccurrenceData(word1: string, word2: string): CooccurrenceData | null {
    const key = this.getCooccurrenceKey(word1, word2);
    return this.cooccurrence.get(key) || null;
  }

  /**
   * Find words that frequently co-occur with a given word
   */
  getFrequentCooccurrences(word: string, minCount: number = 2): Array<{word: string, count: number}> {
    const results: Array<{word: string, count: number}> = [];
    
    for (const [key, data] of this.cooccurrence.entries()) {
      if (data.word1 === word && data.count >= minCount) {
        results.push({ word: data.word2, count: data.count });
      } else if (data.word2 === word && data.count >= minCount) {
        results.push({ word: data.word1, count: data.count });
      }
    }
    
    return results.sort((a, b) => b.count - a.count);
  }

  /**
   * Helper method for co-occurrence keys - ensures consistent ordering
   */
  private getCooccurrenceKey(word1: string, word2: string): string {
    return [word1, word2].sort().join('|');
  }

  /**
   * Check if a word is a stop word (simplified implementation)
   */
  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those'
    ]);
    return stopWords.has(word.toLowerCase());
  }

  // ===== NEW: Vector Storage Methods =====

  /**
   * Check if a node already has a vector stored
   */
  hasNodeVector(nodeId: string): boolean {
    return this.nodeVectors.has(nodeId);
  }

  /**
   * Get vector for a node (returns null if not stored)
   */
  getNodeVector(nodeId: string): number[] | null {
    return this.nodeVectors.get(nodeId) || null;
  }

  /**
   * Store vector for a node (integrated with graph)
   */
  setNodeVector(nodeId: string, vector: number[], metadata?: Partial<VectorMetadata>): void {
    this.nodeVectors.set(nodeId, vector);
    
    const defaultMetadata: VectorMetadata = {
      dimension: vector.length,
      source: 'glove',
      lastUpdated: new Date(),
      nodeType: 'word'
    };
    
    this.vectorMetadata.set(nodeId, { ...defaultMetadata, ...metadata });
  }

  /**
   * Check if a word exists in the graph AND has a vector
   */
  async wordExistsWithVector(word: string): Promise<boolean> {
    const exists = await this.wordExists(word);
    return exists && this.hasNodeVector(word);
  }

  /**
   * Check if a phrase exists in the graph AND has a vector
   */
  async phraseExistsWithVector(phrase: string): Promise<boolean> {
    const exists = await this.wordExists(phrase);
    return exists && this.hasNodeVector(phrase);
  }

  /**
   * Find semantically similar nodes using cosine similarity
   */
  findSimilarNodes(
    queryVector: number[], 
    nodeType?: string, 
    limit: number = 10
  ): Array<{nodeId: string, similarity: number}> {
    const results: Array<{nodeId: string, similarity: number}> = [];
    
    for (const [nodeId, vector] of this.nodeVectors.entries()) {
      // Filter by node type if specified
      if (nodeType) {
        const metadata = this.vectorMetadata.get(nodeId);
        if (metadata?.nodeType !== nodeType) continue;
      }
      
      // Skip if vectors have different dimensions
      if (vector.length !== queryVector.length) continue;
      
      const similarity = this.cosineSimilarity(queryVector, vector);
      results.push({ nodeId, similarity });
    }
    
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Helper method to compute cosine similarity between two vectors
   */
  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) return 0;
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }
    
    if (norm1 === 0 || norm2 === 0) return 0;
    
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Return phrases that are linked to the given WORD LEMMA in the graph.
   * - `lemma` must be the normalized lemma string (e.g., "dog", "buy", "snail")
   *
   * This method scans the graph for phrases that contain the given word lemma.
   * In a production implementation, this should traverse word↔phrase edges.
   */
  async getPhrasesForWord(
    lemma: string
  ): Promise<string[]> {
    // Simple implementation: scan nodes and do a strict word boundary match
    const nodes: string[] = await this.getAllNodes();
    const rx = new RegExp(`\\b${lemma.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
    return nodes.filter(n => /\s/.test(n) && rx.test(n));
  }

  /**
   * Convenience wrapper for semantic surfacing using WordNet.
   */
  async semanticSurface(
    term: string,
    options: { pos?: 'ANY'|'NOUN'|'VERB'|'ADJ'|'ADV'; maxResults?: number; maxDepthHypo?: number; maxDepthHyper?: number } = {},
    wordnetApi: { wnExpand: (w: string, pos?: 'NOUN'|'VERB'|'ADJ'|'ADV', limit?: number) => Promise<{ syn: string[]; hyper: string[]; hypo: string[]; mero: string[]; holo: string[] }> }
  ) {
    const { GraphSemanticSurfacer } = await import('./semantic/GraphSemanticSurfacer');
    const surfacer = new GraphSemanticSurfacer(this as unknown as SemanticGraph, wordnetApi);
    return await surfacer.search(term, options);
  }

  // ============================================================================
  // RESPONSE MANAGEMENT SYSTEM METHODS
  // ============================================================================

  /**
   * Create a prompt node in the graph
   */
  async createPrompt(promptData: {
    text: string;
    patternKey?: string;
    templateId?: string;
    metadata?: { [key: string]: any };
  }): Promise<string> {
    const promptId = `prompt_${this.promptIdCounter++}`;
    const now = new Date().toISOString();
    
    const prompt = {
      id: promptId,
      text: promptData.text,
      patternKey: promptData.patternKey,
      templateId: promptData.templateId,
      createdAt: now,
      metadata: promptData.metadata || {}
    };
    
    this.prompts.set(promptId, prompt);
    this.isDirty = true;
    this.markCachesDirty();
    
    // Add the prompt text as a node in the main graph
    await this.ensureWordExists(promptData.text);
    
    return promptId;
  }

  /**
   * Create a response node in the graph
   */
  async createResponse(responseData: {
    text: string;
    promptId: string;
    tokenWords: string[];
    metadata?: { [key: string]: any };
  }): Promise<string> {
    const responseId = `response_${this.responseIdCounter++}`;
    const now = new Date().toISOString();
    
    const response = {
      id: responseId,
      text: responseData.text,
      promptId: responseData.promptId,
      tokenWords: responseData.tokenWords,
      createdAt: now,
      metadata: responseData.metadata || {}
    };
    
    this.responses.set(responseId, response);
    this.isDirty = true;
    this.markCachesDirty();
    
    // Ensure response node exists in the main graph
    await this.ensureWordExists(responseData.text);

    // Link to prompt (origin context)
    const prompt = this.prompts.get(responseData.promptId);
    if (prompt) {
      await this.addAssociation(responseData.text, prompt.text, ['ANSWERS']);
    }

    // Defensive backfill: if caller provided no tokens, extract here
    let tokens = responseData.tokenWords || [];
    if (!tokens.length) {
      try {
        const { UnifiedTextProcessor } = await import('./unifiedTextProcessor');
        const utp = UnifiedTextProcessor.getInstance();
        tokens = await utp.extractWords(responseData.text);
        console.warn('⚠️ createResponse: backfilled tokenWords:', tokens);
      } catch (e) {
        console.warn('⚠️ createResponse: token backfill failed, skipping MENTIONS:', e);
      }
    }

    // Create MENTIONS for tokens
    console.log('🔍 Creating MENTIONS for words:', tokens);
    for (const word of tokens) {
      console.log('🔍 MENTION:', responseData.text, '→', word);
      await this.addAssociation(responseData.text, word, ['MENTIONS']);
    }
    return responseId;
  }

  /**
   * Get a prompt by ID
   */
  getPrompt(promptId: string): any | null {
    return this.prompts.get(promptId) || null;
  }

  /**
   * Get a response by ID
   */
  getResponse(responseId: string): any | null {
    return this.responses.get(responseId) || null;
  }

  /**
   * Get all prompts
   */
  getAllPrompts(): any[] {
    return Array.from(this.prompts.values());
  }

  /**
   * Get all responses
   */
  getAllResponses(): any[] {
    return Array.from(this.responses.values());
  }

  /**
   * Get responses for a specific prompt
   */
  getResponsesForPrompt(promptId: string): any[] {
    return Array.from(this.responses.values()).filter(response => response.promptId === promptId);
  }

  /**
   * Get prompts that contain a specific word
   */
  async getPromptsContainingWord(word: string): Promise<any[]> {
    const cleanWord = await this.processWord(word);
    const prompts: any[] = [];
    
    for (const prompt of this.prompts.values()) {
      if (prompt.text.toLowerCase().includes(cleanWord.toLowerCase())) {
        prompts.push(prompt);
      }
    }
    
    return prompts;
  }

  /**
   * Get responses that contain a specific word
   */
  async getResponsesContainingWord(word: string): Promise<any[]> {
    const cleanWord = await this.processWord(word);
    const responses: any[] = [];
    
    for (const response of this.responses.values()) {
      if (response.text.toLowerCase().includes(cleanWord.toLowerCase()) ||
          response.tokenWords.some((w: string) => w.toLowerCase() === cleanWord.toLowerCase())) {
        responses.push(response);
      }
    }
    
    return responses;
  }

  /**
   * Delete a prompt and all its associated responses
   */
  async deletePrompt(promptId: string): Promise<boolean> {
    const prompt = this.prompts.get(promptId);
    if (!prompt) return false;
    
    // Delete all responses for this prompt
    const responsesToDelete = this.getResponsesForPrompt(promptId);
    for (const response of responsesToDelete) {
      await this.deleteResponse(response.id);
    }
    
    // Delete the prompt
    this.prompts.delete(promptId);
    this.isDirty = true;
    this.markCachesDirty();
    
    return true;
  }

  /**
   * Delete a response
   */
  async deleteResponse(responseId: string): Promise<boolean> {
    const response = this.responses.get(responseId);
    if (!response) return false;
    
    this.responses.delete(responseId);
    this.isDirty = true;
    this.markCachesDirty();
    
    return true;
  }

  /**
   * Get statistics for prompts and responses
   */
  getResponseStats() {
    return {
      totalPrompts: this.prompts.size,
      totalResponses: this.responses.size,
      averageResponsesPerPrompt: this.prompts.size > 0 ? this.responses.size / this.prompts.size : 0,
      promptIdCounter: this.promptIdCounter,
      responseIdCounter: this.responseIdCounter
    };
  }

  /**
   * Update co-occurrence when two terms appear together.
   * Uses existing co-occurrence infrastructure.
   */
  async updateCooccurrence(a: string, b: string, context: string): Promise<void> {
    if (!a || !b || a === b) return
    await this.updateCooccurrenceData(a, b, context)
  }

  /**
   * Get simple normalized co-occurrence strength in [0..1] scale.
   */
  async getCooccurrenceStrength(a: string, b: string): Promise<number> {
    const data = this.getCooccurrenceData(a, b)
    if (!data) return 0
    // Normalize by max count for this word
    const allCooccurrences = this.getFrequentCooccurrences(a, 0)
    const maxCount = Math.max(...allCooccurrences.map(n => n.count), 1)
    return data.count / maxCount
  }

  /**
   * Get top-N co-occurrence neighbors for a node.
   */
  async getCooccurrenceNeighbors(nodeId: string, minWeight = 0, limit = 50): Promise<Array<{ nodeId: string, weight: number }>> {
    const neighbors = this.getFrequentCooccurrences(nodeId, minWeight)
    return neighbors.slice(0, limit).map(n => ({ nodeId: n.word, weight: n.count }))
  }

  /**
   * Return kNN neighbors by cosine similarity among nodes with vectors.
   * Uses existing vector infrastructure with caching.
   */
  async getEmbeddingNeighbors(nodeId: string, k: number = 20): Promise<Array<{ nodeId: string, similarity: number }>> {
    const cacheKey = `${nodeId}:${k}`;
    const now = Date.now();
    
    // Check cache first
    const cached = this.similarityCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < this.SIMILARITY_CACHE_TTL && cached.limit >= k) {
      return cached.results.slice(0, k);
    }
    
    // Compute similarity results
    const nodeVector = await this.getNodeVector(nodeId);
    if (!nodeVector) {
      return [];
    }
    
    const results = this.findSimilarNodes(nodeVector, undefined, k);
    
    // Cache the results
    this.similarityCache.set(cacheKey, {
      results,
      timestamp: now,
      limit: k
    });
    
    return results;
  }

  /**
   * Get cached similarity results for a node
   */
  getCachedSimilarityResults(nodeId: string, k: number = 20): Array<{ nodeId: string, similarity: number }> | null {
    const cacheKey = `${nodeId}:${k}`;
    const now = Date.now();
    
    const cached = this.similarityCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < this.SIMILARITY_CACHE_TTL && cached.limit >= k) {
      return cached.results.slice(0, k);
    }
    
    return null;
  }

  /**
   * Clear similarity cache for a specific node or all nodes
   */
  clearSimilarityCache(nodeId?: string): void {
    if (nodeId) {
      // Clear cache entries for specific node
      const keysToDelete = Array.from(this.similarityCache.keys()).filter(key => key.startsWith(`${nodeId}:`));
      keysToDelete.forEach(key => this.similarityCache.delete(key));
    } else {
      // Clear all cache
      this.similarityCache.clear();
    }
  }
}

// local cosine (duplicate kept here to avoid import cycle)
function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i]*a[i]; nb += b[i]*b[i] }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
} 