import React, { useState } from 'react';
import { SemanticGraphLite } from '../lib/semanticGraphLite.js';
import { surfaceRelatedPhrases } from '../lib/retrieve.js';
import { createPromptFromPhrase } from '../lib/promptEngine.js';
import { TEMPLATES } from '../lib/templates.js';
import GraphViewer from './GraphViewer.jsx';
import TemplateEditor from './TemplateEditor.jsx';
import { useActiveNodes } from '../contexts/ActiveNodesContext.js';
import type { PhraseNode, PhraseChunk } from '../types/index.js';

interface ExploreViewProps {
  graph: SemanticGraphLite;
  onGraphUpdate: () => void;
  onError: (error: string) => void;
}

type ExploreTab = 'phrases' | 'graph';

export default function ExploreView({ graph, onGraphUpdate, onError }: ExploreViewProps) {
  const { contextFrame } = useActiveNodes();
  const [activeTab, setActiveTab] = useState<ExploreTab>('phrases');
  const [selectedPhrase, setSelectedPhrase] = useState<PhraseNode | null>(null);
  const [relatedPhrases, setRelatedPhrases] = useState<any[]>([]);
  const [topChunks, setTopChunks] = useState<PhraseChunk[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<typeof TEMPLATES[0] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [createdPrompt, setCreatedPrompt] = useState<any>(null);
  const [minOverlap, setMinOverlap] = useState<number>(0.1);
  const [showEditor, setShowEditor] = useState(false);

  const phrases = graph.getNodesByType('PHRASE') as PhraseNode[];

  const handlePhraseSelect = async (phrase: PhraseNode) => {
    setSelectedPhrase(phrase);
    setIsLoading(true);
    
    try {
      const result = surfaceRelatedPhrases(phrase.id, graph, { 
        maxResults: 20,
        minOverlap: minOverlap
      });
      setRelatedPhrases(result.relatedPhrases);
      setTopChunks(result.topChunks);
      setCreatedPrompt(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to find related phrases');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreatePrompt = async () => {
    if (!selectedPhrase || !selectedTemplate) return;

    try {
      const result = createPromptFromPhrase(selectedPhrase, selectedTemplate, graph);
      setCreatedPrompt(result);
      onGraphUpdate();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to create prompt');
    }
  };

  const handleLikePhrase = (phrase: PhraseNode) => {
    graph.likeNode(phrase.id);
    onGraphUpdate();
  };

  const handleUsePhrase = (phrase: PhraseNode) => {
    graph.useNode(phrase.id);
    onGraphUpdate();
  };

  const handleMinOverlapChange = async (newMinOverlap: number) => {
    setMinOverlap(newMinOverlap);
    
    // Re-run the search if a phrase is selected
    if (selectedPhrase) {
      setIsLoading(true);
      try {
        const result = surfaceRelatedPhrases(selectedPhrase.id, graph, { 
          maxResults: 20,
          minOverlap: newMinOverlap
        });
        setRelatedPhrases(result.relatedPhrases);
        setTopChunks(result.topChunks);
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Failed to find related phrases');
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-3xl font-bold text-white mb-2">Explore</h2>
        <p className="text-white/80">
          Find related phrases, discover chunks, create prompts, and explore the graph
        </p>
        <div className="mt-4">
          <button
            className="btn-secondary px-6 py-2 rounded-lg text-sm font-medium"
            onClick={() => setShowEditor(true)}
          >
            🛠️ Open Template Editor
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex justify-center">
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-1">
          <div className="flex space-x-1">
            {[
              { id: 'phrases', label: 'Phrases', description: 'Find related phrases and create prompts' },
              { id: 'graph', label: 'Graph Viewer', description: 'Explore the semantic graph structure' },
            ].map(({ id, label, description }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id as ExploreTab)}
                className={`px-6 py-3 rounded-md font-medium text-sm transition-all ${
                  activeTab === id
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
                title={description}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'phrases' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Phrase Selection */}
          <div className="space-y-6">
          {/* Available Phrases */}
          <div className="card p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">
              Available Phrases ({phrases.length})
            </h3>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {phrases.map((phrase) => (
                <div
                  key={phrase.id}
                  className={`phrase-item p-3 rounded-lg cursor-pointer transition-all ${
                    selectedPhrase?.id === phrase.id ? 'ring-2 ring-blue-500' : ''
                  }`}
                  onClick={() => handlePhraseSelect(phrase)}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
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
                    <div className="flex space-x-1 ml-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLikePhrase(phrase);
                        }}
                        className="text-red-500 hover:text-red-700 text-sm"
                        title="Like"
                      >
                        ♥
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUsePhrase(phrase);
                        }}
                        className="text-blue-500 hover:text-blue-700 text-sm"
                        title="Use"
                      >
                        ✓
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Min Overlap Slider */}
          <div className="card p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">
              Relatedness Threshold
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label htmlFor="minOverlap" className="text-sm font-medium text-gray-700">
                  Minimum Word Overlap
                </label>
                <span className="text-sm text-gray-600 bg-gray-100 px-2 py-1 rounded">
                  {minOverlap.toFixed(2)}
                </span>
              </div>
              <input
                id="minOverlap"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={minOverlap}
                onChange={(e) => handleMinOverlapChange(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>More Related (0.0)</span>
                <span>Less Related (1.0)</span>
              </div>
              <div className="text-xs text-gray-600 bg-blue-50 p-2 rounded">
                <strong>Tip:</strong> Lower values show more phrases with partial word overlap. 
                Higher values show only phrases with many shared words.
                {selectedPhrase && (
                  <div className="mt-1">
                    <strong>Found:</strong> {relatedPhrases.length} related phrases, {topChunks.length} chunks
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Template Selection */}
          {selectedPhrase && (
            <div className="card p-6 rounded-lg shadow-lg">
              <h3 className="text-xl font-semibold text-gray-800 mb-4">Select Template</h3>
              <div className="space-y-3">
                {TEMPLATES.map((template) => (
                  <div
                    key={template.id}
                    className={`p-3 rounded-lg cursor-pointer transition-all ${
                      selectedTemplate?.id === template.id
                        ? 'bg-blue-100 border-2 border-blue-500'
                        : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                    }`}
                    onClick={() => setSelectedTemplate(template)}
                  >
                    <div className="font-medium text-gray-800">{template.text}</div>
                    <div className="text-sm text-gray-600">
                      Slots: {template.slots.join(', ')}
                    </div>
                  </div>
                ))}
              </div>
              
              {selectedTemplate && (
                <button
                  onClick={handleCreatePrompt}
                  className="btn-primary w-full mt-4 py-2 rounded-lg font-medium"
                >
                  Create Prompt
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right Column - Results */}
        <div className="space-y-6">
          {/* Selected Phrase Info */}
          {selectedPhrase && (
            <div className="card p-6 rounded-lg shadow-lg">
              <h3 className="text-xl font-semibold text-gray-800 mb-4">Selected Phrase</h3>
              <div className="space-y-3">
                <div className="font-medium text-gray-800">{selectedPhrase.text}</div>
                <div className="text-sm text-gray-600">
                  <span className="bg-gray-200 px-2 py-1 rounded text-xs mr-2">
                    {selectedPhrase.posPattern}
                  </span>
                  {selectedPhrase.lemmas.length} lemmas
                </div>
                <div className="text-sm text-gray-600">
                  Lemmas: {selectedPhrase.lemmas.join(', ')}
                </div>
              </div>
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="card p-6 rounded-lg shadow-lg text-center">
              <div className="flex items-center justify-center space-x-2">
                <div className="spinner"></div>
                <span className="text-gray-600">Finding related phrases...</span>
              </div>
            </div>
          )}

          {/* Related Phrases */}
          {!isLoading && relatedPhrases.length > 0 && (
            <div className="card p-6 rounded-lg shadow-lg">
              <h3 className="text-xl font-semibold text-gray-800 mb-4">
                Related Phrases ({relatedPhrases.length})
              </h3>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {relatedPhrases.map(({ phrase, score, overlapScore, patternBoost, likeBoost }) => (
                  <div key={phrase.id} className="phrase-item p-3 rounded-lg">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="font-medium text-gray-800">{phrase.text}</div>
                        <div className="text-sm text-gray-600 mt-1">
                          <span className="bg-gray-200 px-2 py-1 rounded text-xs mr-2">
                            {phrase.posPattern}
                          </span>
                          Score: {score.toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Overlap: {overlapScore.toFixed(2)} • Pattern: {patternBoost.toFixed(2)} • Likes: {likeBoost.toFixed(2)}
                        </div>
                      </div>
                      <div className="flex space-x-1 ml-2">
                        <button
                          onClick={() => handleLikePhrase(phrase)}
                          className="text-red-500 hover:text-red-700 text-sm"
                          title="Like"
                        >
                          ♥
                        </button>
                        <button
                          onClick={() => handleUsePhrase(phrase)}
                          className="text-blue-500 hover:text-blue-700 text-sm"
                          title="Use"
                        >
                          ✓
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Chunks */}
          {!isLoading && topChunks.length > 0 && (
            <div className="card p-6 rounded-lg shadow-lg">
              <h3 className="text-xl font-semibold text-gray-800 mb-4">
                Top Chunks ({topChunks.length})
              </h3>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {topChunks.map((chunk) => (
                  <div key={chunk.id} className="chunk-item p-3 rounded-lg">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="font-medium text-gray-800">{chunk.text}</div>
                        <div className="text-sm text-gray-600 mt-1">
                          <span className="bg-gray-200 px-2 py-1 rounded text-xs mr-2">
                            {chunk.posPattern}
                          </span>
                          Score: {chunk.score.toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Lemmas: {chunk.lemmas.join(', ')}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Created Prompt */}
          {createdPrompt && (
            <div className="card p-6 rounded-lg shadow-lg">
              <h3 className="text-xl font-semibold text-gray-800 mb-4">Created Prompt</h3>
              <div className="space-y-3">
                <div className="bg-yellow-50 p-3 rounded-lg">
                  <div className="font-medium text-gray-800">{createdPrompt.promptText}</div>
                </div>
                <div className="text-sm text-gray-600">
                  Template: {createdPrompt.promptNode.templateId}
                </div>
                <div className="text-sm text-gray-600">
                  Bindings: {createdPrompt.bindings.length} slots filled
                </div>
                <div className="text-xs text-gray-500">
                  {createdPrompt.bindings.map((binding: any, index: number) => (
                    <span key={index} className="mr-2">
                      {binding.slot}: {binding.fillerNodeId}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Graph Viewer Tab */}
      {activeTab === 'graph' && (
        <GraphViewer 
          graph={graph} 
          onGraphUpdate={onGraphUpdate}
          onError={onError}
        />
      )}

      {/* Template Editor Modal */}
      {showEditor && (
        <div className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm">
          <div className="absolute inset-0 max-w-5xl mx-auto my-6 bg-background rounded-2xl shadow-xl overflow-hidden">
            <TemplateEditor 
              sessionId={contextFrame?.sessionId || 'default'} 
              onClose={() => setShowEditor(false)}
              graph={graph}
            />
          </div>
        </div>
      )}
    </div>
  );
}
