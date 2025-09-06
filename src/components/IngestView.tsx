import React, { useState, useMemo, useEffect, useRef } from 'react';
import { SemanticGraphLite } from '../lib/semanticGraphLite.js';
import { ingestPhraseText, promoteChunk, ingestBatchPhrases, splitTextIntoPhrases, type BatchIngestionResult } from '../lib/ingest.js';
import type { PhraseNode, PhraseChunk, WordNode } from '../types/index.js';
import { useActiveNodesWithGraph } from '../contexts/ActiveNodesContext.jsx';
import TopicChip, { type TopicChipRef } from './TopicChip.jsx';

interface IngestViewProps {
  graph: SemanticGraphLite;
  onGraphUpdate: () => void;
  onError: (error: string) => void;
}

export default function IngestView({ graph, onGraphUpdate, onError }: IngestViewProps) {
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<{
    phrase: PhraseNode;
    wordsCreated: number;
    chunksExtracted: number;
  } | null>(null);
  const [lastBatchResult, setLastBatchResult] = useState<BatchIngestionResult | null>(null);
  const [selectedChunk, setSelectedChunk] = useState<PhraseChunk | null>(null);
  const [expandedSections, setExpandedSections] = useState<{
    phrases: boolean;
    chunks: boolean;
    words: boolean;
  }>({
    phrases: true,
    chunks: true,
    words: true,
  });
  const [graphUpdateTrigger, setGraphUpdateTrigger] = useState(0);
  
  const { contextFrame, getContextualNodes } = useActiveNodesWithGraph(graph);
  const topicChipRef = useRef<TopicChipRef>(null);
  
  // Force real-time updates by recomputing contextual data whenever graph changes
  const ctx = useMemo(() => {
    // Always get fresh data from the graph
    return getContextualNodes(graph);
  }, [getContextualNodes, graphUpdateTrigger, contextFrame?.topicId, contextFrame?.sessionId, graph.getNodeCount()]);

  // Trigger updates when contextFrame changes (topic/session changes)
  useEffect(() => {
    setGraphUpdateTrigger(prev => prev + 1);
  }, [contextFrame?.topicId, contextFrame?.sessionId]);

  // Helper function to organize words by POS based on potential POS
  const organizeWordsByPOS = (words: WordNode[]) => {
    const organized = {
      nouns: [] as WordNode[],
      verbs: [] as WordNode[],
      adjectives: [] as WordNode[],
      adverbs: [] as WordNode[],
      multiPOS: [] as WordNode[],
    };

    words.forEach(word => {
      // Get all potential POS tags from the word
      const potentialPOS = word.posPotential || [];
      
      // Add to Multi-POS column if word has multiple potential POS tags
      if (potentialPOS.length > 1) {
        organized.multiPOS.push(word);
      }
      
      // Add to individual POS columns based on what potential POS tags the word has
      if (potentialPOS.includes('NOUN')) {
        organized.nouns.push(word);
      }
      if (potentialPOS.includes('VERB')) {
        organized.verbs.push(word);
      }
      if (potentialPOS.includes('ADJ')) {
        organized.adjectives.push(word);
      }
      if (potentialPOS.includes('ADV')) {
        organized.adverbs.push(word);
      }
      
      // If word has no potential POS tags or unknown POS, put in Multi-POS as fallback
      if (potentialPOS.length === 0 || !potentialPOS.some(pos => ['NOUN', 'VERB', 'ADJ', 'ADV'].includes(pos))) {
        organized.multiPOS.push(word);
      }
    });

    // Sort all arrays alphabetically by word text
    Object.keys(organized).forEach(key => {
      organized[key as keyof typeof organized].sort((a, b) => a.text.localeCompare(b.text));
    });

    return organized;
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Function to trigger real-time updates
  const triggerGraphUpdate = () => {
    setGraphUpdateTrigger(prev => prev + 1);
    onGraphUpdate();
  };

  const handleIngest = async () => {
    if (!inputText.trim()) {
      onError('Please enter some text to ingest');
      return;
    }

    // Check if we have an active topic session
    if (!contextFrame) {
      // Automatically focus on topic entry instead of showing popup
      topicChipRef.current?.startTopicEntry();
      return;
    }

    try {
      setIsProcessing(true);
      
      // Create context frame for ingestion
      const ingestContextFrame = contextFrame ? {
        topicId: contextFrame.topicId,
        sessionId: contextFrame.sessionId,
      } : undefined;
      
      console.log('🔍 Processing mode: BATCH (default)');
      console.log('🔍 Input text:', inputText);
      
      // Always use batch processing
      console.log('🔄 Starting batch processing...');
      const batchResult = await ingestBatchPhrases(inputText.trim(), graph, ingestContextFrame);
      setLastBatchResult(batchResult);
      setLastResult(null); // Clear single result
      console.log(`✅ Batch processing complete: ${batchResult.successfulPhrases}/${batchResult.totalPhrases} phrases processed successfully`);
      
      if (batchResult.errors.length > 0) {
        console.warn('⚠️ Some phrases failed to process:', batchResult.errors);
      }
      
      setInputText('');
      triggerGraphUpdate(); // Use the new function that triggers real-time updates
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to ingest phrase');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePromoteChunk = async (chunk: PhraseChunk) => {
    if (!lastResult) return;

    try {
      const promotedPhrase = promoteChunk(lastResult.phrase.id, chunk.id, graph);
      if (promotedPhrase) {
        setSelectedChunk(null);
        triggerGraphUpdate(); // Use the new function that triggers real-time updates
        // Show success message
        console.log('Chunk promoted to phrase:', promotedPhrase.text);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to promote chunk');
    }
  };

  const organizedWords = organizeWordsByPOS(ctx.words);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-3xl font-bold text-white mb-2">Ingest Phrases</h2>
        <p className="text-white/80 mb-4">
          Add multiple phrases to extract words, analyze patterns, and discover chunks. Text is automatically split by sentences and line breaks.
        </p>
        <TopicChip ref={topicChipRef} graph={graph} />
      </div>

      {/* Input Section */}
      <div className="card p-6 rounded-lg shadow-lg">
        <div className="space-y-4">
          <div>
            <label htmlFor="phrase-input" className="block text-sm font-medium text-gray-700 mb-2">
              Enter text with multiple phrases (separated by sentences, line breaks):
            </label>
            <div className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded inline-block mb-2">
              Multiple phrases will be processed separately
            </div>
          </div>
          
          <textarea
            id="phrase-input"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="e.g., 'The quick brown fox jumps over the lazy dog. The cat sat on the mat. Birds fly in the sky.'"
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            rows={6}
            disabled={isProcessing}
          />
          
          {/* Preview phrases */}
          {inputText.trim() && (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg">
              <div className="text-sm font-medium text-gray-700 mb-2">Preview - Phrases to be processed:</div>
              <div className="space-y-1">
                {splitTextIntoPhrases(inputText).map((phrase, index) => (
                  <div key={index} className="text-sm text-gray-600 bg-white p-2 rounded border">
                    {index + 1}. "{phrase}"
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div className="flex space-x-3">
            <button
              onClick={handleIngest}
              disabled={isProcessing || !inputText.trim()}
              className="btn-primary px-6 py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? (
                <div className="flex items-center space-x-2">
                  <div className="spinner"></div>
                  <span>Processing Phrases...</span>
                </div>
              ) : (
                'Ingest Phrases'
              )}
            </button>
            
            <button
              onClick={() => {
                const cleaned = graph.cleanupCorruptedEdges();
                if (cleaned > 0) {
                  triggerGraphUpdate();
                  console.log(`🧹 Cleaned up ${cleaned} corrupted edges`);
                }
              }}
              className="btn-secondary px-4 py-2 rounded-lg font-medium text-sm"
            >
              🧹 Clean Corrupted Edges
            </button>
            
            <button
              onClick={async () => {
                const recovered = await graph.recoverFromBackup();
                if (recovered) {
                  triggerGraphUpdate();
                  console.log('🔄 Graph recovered from backup');
                } else {
                  console.log('❌ No backup available to recover from');
                }
              }}
              className="btn-secondary px-4 py-2 rounded-lg font-medium text-sm bg-green-600 hover:bg-green-700"
            >
              🔄 Recover from Backup
            </button>
            
            <button
              onClick={async () => {
                if (confirm('⚠️ This will permanently delete all graph data. Are you sure?')) {
                  try {
                    // Clear all storage
                    const { PersistentStore } = await import('../lib/persistentStore.js');
                    await PersistentStore.clearAll();
                    
                    // Clear the current graph
                    graph.clear();
                    
                    // Trigger update
                    triggerGraphUpdate();
                    
                    console.log('🗑️ All graph data cleared. Starting fresh.');
                  } catch (error) {
                    console.error('❌ Failed to clear data:', error);
                  }
                }
              }}
              className="btn-secondary px-4 py-2 rounded-lg font-medium text-sm bg-red-600 hover:bg-red-700"
            >
              🗑️ Start Fresh
            </button>
          </div>
        </div>
      </div>

      {/* Last Result */}
      {lastResult && (
        <div className="card p-6 rounded-lg shadow-lg slide-in">
          <h3 className="text-xl font-semibold text-gray-800 mb-4">Last Ingestion Result</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="text-sm text-blue-600 font-medium">Phrase</div>
              <div className="text-lg font-semibold text-blue-800">{lastResult.phrase.text}</div>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="text-sm text-green-600 font-medium">Words Created</div>
              <div className="text-lg font-semibold text-green-800">{lastResult.wordsCreated}</div>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <div className="text-sm text-purple-600 font-medium">Chunks Extracted</div>
              <div className="text-lg font-semibold text-purple-800">{lastResult.chunksExtracted}</div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h4 className="text-lg font-medium text-gray-700 mb-2">POS Pattern</h4>
              <code className="bg-gray-100 px-3 py-1 rounded text-sm">{lastResult.phrase.posPattern}</code>
            </div>

            <div>
              <h4 className="text-lg font-medium text-gray-700 mb-2">Lemmas</h4>
              <div className="flex flex-wrap gap-2">
                {lastResult.phrase.lemmas.map((lemma, index) => (
                  <span
                    key={index}
                    className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm"
                  >
                    {lemma}
                  </span>
                ))}
              </div>
            </div>

            {lastResult.phrase.chunks.length > 0 && (
              <div>
                <h4 className="text-lg font-medium text-gray-700 mb-2">Extracted Chunks</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {lastResult.phrase.chunks.map((chunk) => (
                    <div
                      key={`lastResult-${chunk.id}`}
                      className="chunk-item p-3 rounded-lg cursor-pointer"
                      onClick={() => setSelectedChunk(chunk)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-medium text-gray-800">{chunk.text}</span>
                        <span className="text-xs text-gray-500">Score: {chunk.score.toFixed(2)}</span>
                      </div>
                      <div className="text-sm text-gray-600">
                        <span className="bg-gray-200 px-2 py-1 rounded text-xs mr-2">
                          {chunk.posPattern}
                        </span>
                        <span className="text-xs">
                          Tokens {chunk.span[0]}-{chunk.span[1]}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Last Batch Result */}
      {lastBatchResult && (
        <div className="card p-6 rounded-lg shadow-lg slide-in">
          <h3 className="text-xl font-semibold text-gray-800 mb-4">Batch Processing Results</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="text-sm text-blue-600 font-medium">Total Phrases</div>
              <div className="text-lg font-semibold text-blue-800">{lastBatchResult.totalPhrases}</div>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="text-sm text-green-600 font-medium">Successful</div>
              <div className="text-lg font-semibold text-green-800">{lastBatchResult.successfulPhrases}</div>
            </div>
            <div className="bg-red-50 p-4 rounded-lg">
              <div className="text-sm text-red-600 font-medium">Failed</div>
              <div className="text-lg font-semibold text-red-800">{lastBatchResult.failedPhrases}</div>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <div className="text-sm text-purple-600 font-medium">Total Chunks</div>
              <div className="text-lg font-semibold text-purple-800">
                {lastBatchResult.results.reduce((sum, result) => sum + result.chunksExtracted, 0)}
              </div>
            </div>
          </div>

          {/* Show errors if any */}
          {lastBatchResult.errors.length > 0 && (
            <div className="mb-6">
              <h4 className="text-lg font-medium text-red-700 mb-2">Errors:</h4>
              <div className="space-y-2">
                {lastBatchResult.errors.map((error, index) => (
                  <div key={index} className="bg-red-50 border border-red-200 rounded p-3">
                    <div className="text-sm text-red-800">{error}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Show successful results */}
          {lastBatchResult.results.length > 0 && (
            <div>
              <h4 className="text-lg font-medium text-gray-700 mb-4">Successfully Processed Phrases:</h4>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {lastBatchResult.results.map((result, index) => (
                  <div key={index} className="bg-gray-50 p-4 rounded-lg">
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-medium text-gray-800">{result.phrase.text}</div>
                      <div className="text-sm text-gray-500">
                        {result.wordsCreated} words • {result.chunksExtracted} chunks
                      </div>
                    </div>
                    <div className="text-sm text-gray-600">
                      <span className="bg-gray-200 px-2 py-1 rounded text-xs mr-2">
                        {result.phrase.posPattern}
                      </span>
                      <span className="text-xs">
                        {result.phrase.lemmas.join(', ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Chunk Promotion Modal */}
      {selectedChunk && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="card p-6 rounded-lg shadow-lg max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">Promote Chunk</h3>
            <p className="text-gray-600 mb-4">
              Promote "{selectedChunk.text}" to a standalone phrase?
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => handlePromoteChunk(selectedChunk)}
                className="btn-primary px-4 py-2 rounded-lg font-medium"
              >
                Promote
              </button>
              <button
                onClick={() => setSelectedChunk(null)}
                className="btn-secondary px-4 py-2 rounded-lg font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contextual Data Sections */}
      <div className="space-y-4">
        {/* Section 1: ctx.phrases */}
        <div className="card p-6 rounded-lg shadow-lg">
          <button
            onClick={() => toggleSection('phrases')}
            className="flex items-center justify-between w-full text-left"
          >
            <h3 className="text-xl font-semibold text-gray-800">
              Contextual Phrases ({ctx.phrases.length})
            </h3>
            <span className="text-gray-500">
              {expandedSections.phrases ? '▼' : '▶'}
            </span>
          </button>
          
          {expandedSections.phrases && (
            <div className="mt-4 space-y-3">
              {ctx.phrases.length > 0 ? (
                ctx.phrases.map((phrase) => (
                  <div key={phrase.id} className="phrase-item p-3 rounded-lg">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium text-gray-800">{phrase.text}</div>
                        <div className="text-sm text-gray-600 mt-1">
                          <span className="bg-gray-200 px-2 py-1 rounded text-xs mr-2">
                            {phrase.posPattern}
                          </span>
                          {phrase.chunks.length} chunks
                          {phrase.stats && (
                            <span className="ml-2">
                              • {phrase.stats.likes} likes • {phrase.stats.uses} uses
                            </span>
                          )}
                        </div>
                      </div>
                      {phrase.derivedFromId && (
                        <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                          Derived
                        </span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-gray-500 text-center py-4">
                  No contextual phrases available. Start a topic session to see phrases.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Section 2: ctx.chunks */}
        <div className="card p-6 rounded-lg shadow-lg">
          <button
            onClick={() => toggleSection('chunks')}
            className="flex items-center justify-between w-full text-left"
          >
            <h3 className="text-xl font-semibold text-gray-800">
              Contextual Chunks ({ctx.chunks.length})
            </h3>
            <span className="text-gray-500">
              {expandedSections.chunks ? '▼' : '▶'}
            </span>
          </button>
          
          {expandedSections.chunks && (
            <div className="mt-4">
              {ctx.chunks.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {ctx.chunks.map((chunk) => (
                    <div
                      key={`ctx-${chunk.id}`}
                      className="bg-blue-100 text-blue-800 px-3 py-2 rounded-full text-sm font-medium"
                    >
                      {chunk.text}
                      <span className="ml-2 text-xs bg-blue-200 px-2 py-1 rounded">
                        {chunk.posPattern}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-gray-500 text-center py-4">
                  No contextual chunks available. Start a topic session to see chunks.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Section 3: ctx.words */}
        <div className="card p-6 rounded-lg shadow-lg">
          <button
            onClick={() => toggleSection('words')}
            className="flex items-center justify-between w-full text-left"
          >
            <h3 className="text-xl font-semibold text-gray-800">
              Contextual Words ({ctx.words.length})
            </h3>
            <span className="text-gray-500">
              {expandedSections.words ? '▼' : '▶'}
            </span>
          </button>
          
          {expandedSections.words && (
            <div className="mt-4">
              {ctx.words.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  {/* Adjectives Column */}
                  <div>
                    <h4 className="font-semibold text-gray-700 mb-2">Adjectives ({organizedWords.adjectives.length})</h4>
                    <div className="space-y-1">
                      {organizedWords.adjectives.map((word) => (
                        <div key={`adjectives-${word.id}`} className="text-sm bg-yellow-50 p-2 rounded">
                          {word.text}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Adverbs Column */}
                  <div>
                    <h4 className="font-semibold text-gray-700 mb-2">Adverbs ({organizedWords.adverbs.length})</h4>
                    <div className="space-y-1">
                      {organizedWords.adverbs.map((word) => (
                        <div key={`adverbs-${word.id}`} className="text-sm bg-purple-50 p-2 rounded">
                          {word.text}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Multi-POS Column */}
                  <div>
                    <h4 className="font-semibold text-gray-700 mb-2">Multi-POS ({organizedWords.multiPOS.length})</h4>
                    <div className="space-y-1">
                      {organizedWords.multiPOS.map((word) => (
                        <div key={`multiPOS-${word.id}`} className="text-sm bg-orange-50 p-2 rounded">
                          {word.text}
                          <div className="text-xs text-gray-500">
                            {word.posPotential?.join(', ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Nouns Column */}
                  <div>
                    <h4 className="font-semibold text-gray-700 mb-2">Nouns ({organizedWords.nouns.length})</h4>
                    <div className="space-y-1">
                      {organizedWords.nouns.map((word) => (
                        <div key={`nouns-${word.id}`} className="text-sm bg-green-50 p-2 rounded">
                          {word.text}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Verbs Column */}
                  <div>
                    <h4 className="font-semibold text-gray-700 mb-2">Verbs ({organizedWords.verbs.length})</h4>
                    <div className="space-y-1">
                      {organizedWords.verbs.map((word) => (
                        <div key={`verbs-${word.id}`} className="text-sm bg-red-50 p-2 rounded">
                          {word.text}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-gray-500 text-center py-4">
                  No contextual words available. Start a topic session to see words.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
