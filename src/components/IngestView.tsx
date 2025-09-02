import React, { useState } from 'react';
import { SemanticGraphLite } from '../lib/semanticGraphLite.js';
import { ingestPhraseText, promoteChunk } from '../lib/ingest.js';
import type { PhraseNode, PhraseChunk } from '../types/index.js';

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
  const [selectedChunk, setSelectedChunk] = useState<PhraseChunk | null>(null);

  const handleIngest = async () => {
    if (!inputText.trim()) {
      onError('Please enter some text to ingest');
      return;
    }

    try {
      setIsProcessing(true);
      const result = await ingestPhraseText(inputText.trim(), graph);
      setLastResult(result);
      setInputText('');
      onGraphUpdate();
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
        onGraphUpdate();
        // Show success message
        console.log('Chunk promoted to phrase:', promotedPhrase.text);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to promote chunk');
    }
  };

  const phrases = graph.getNodesByType('PHRASE') as PhraseNode[];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-3xl font-bold text-white mb-2">Ingest Phrases</h2>
        <p className="text-white/80">
          Add phrases to extract words, analyze patterns, and discover chunks
        </p>
      </div>

      {/* Input Section */}
      <div className="card p-6 rounded-lg shadow-lg">
        <div className="space-y-4">
          <div>
            <label htmlFor="phrase-input" className="block text-sm font-medium text-gray-700 mb-2">
              Enter a phrase or sentence:
            </label>
            <textarea
              id="phrase-input"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="e.g., 'The quick brown fox jumps over the lazy dog'"
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={3}
              disabled={isProcessing}
            />
          </div>
          
          <button
            onClick={handleIngest}
            disabled={isProcessing || !inputText.trim()}
            className="btn-primary px-6 py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? (
              <div className="flex items-center space-x-2">
                <div className="spinner"></div>
                <span>Processing...</span>
              </div>
            ) : (
              'Ingest Phrase'
            )}
          </button>
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
                      key={chunk.id}
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

      {/* All Phrases */}
      {phrases.length > 0 && (
        <div className="card p-6 rounded-lg shadow-lg">
          <h3 className="text-xl font-semibold text-gray-800 mb-4">All Phrases ({phrases.length})</h3>
          <div className="space-y-3">
            {phrases.slice(0, 10).map((phrase) => (
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
            ))}
            {phrases.length > 10 && (
              <div className="text-center text-gray-500 text-sm">
                ... and {phrases.length - 10} more phrases
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
