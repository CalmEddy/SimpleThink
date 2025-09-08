import React, { useState } from 'react';
import { SemanticGraphLite } from '../lib/semanticGraphLite.js';
import { recordResponse, promoteResponseToPhrase, rateResponse } from '../lib/respond.js';
import type { PromptNode, ResponseNode } from '../types/index.js';

interface PromptViewProps {
  graph: SemanticGraphLite;
  onGraphUpdate: () => void;
  onError: (error: string) => void;
}

export default function PromptView({ graph, onGraphUpdate, onError }: PromptViewProps) {
  const [selectedPrompt, setSelectedPrompt] = useState<PromptNode | null>(null);
  const [responseText, setResponseText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastResponse, setLastResponse] = useState<ResponseNode | null>(null);
  const [showPromotionModal, setShowPromotionModal] = useState(false);

  const prompts = graph.getNodesByType('PROMPT') as PromptNode[];
  const responses = graph.getNodesByType('RESPONSE') as ResponseNode[];

  const handlePromptSelect = (prompt: PromptNode) => {
    setSelectedPrompt(prompt);
    setResponseText('');
    setLastResponse(null);
  };

  const handleSubmitResponse = async () => {
    if (!selectedPrompt || !responseText.trim()) {
      onError('Please select a prompt and enter a response');
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await recordResponse(selectedPrompt.id, responseText.trim(), graph);
      setLastResponse(result.responseNode);
      setResponseText('');
      onGraphUpdate();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to record response');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRateResponse = (response: ResponseNode, rating: 'like' | 'skip') => {
    rateResponse(response.id, rating, graph);
    onGraphUpdate();
  };

  const handlePromoteResponse = async (response: ResponseNode) => {
    try {
      const promotedPhrase = promoteResponseToPhrase(response.id, graph);
      if (promotedPhrase) {
        setShowPromotionModal(false);
        onGraphUpdate();
        console.log('Response promoted to phrase:', promotedPhrase.text);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to promote response');
    }
  };

  const getResponsesForPrompt = (promptId: string) => {
    return responses.filter(response => response.promptId === promptId);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-3xl font-bold text-white mb-2">Prompt & Respond</h2>
        <p className="text-white/80">
          Generate prompts and record responses to build your knowledge graph
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Prompts */}
        <div className="space-y-6">
          {/* Available Prompts */}
          <div className="card p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">
              Available Prompts ({prompts.length})
            </h3>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {prompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className={`prompt-item p-3 rounded-lg cursor-pointer transition-all ${
                    selectedPrompt?.id === prompt.id ? 'ring-2 ring-blue-500' : ''
                  }`}
                  onClick={() => handlePromptSelect(prompt)}
                >
                  <div className="font-medium text-gray-800">{prompt.templateText}</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Template: {prompt.templateId} • {prompt.bindings.length} bindings
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Created: {new Date(prompt.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Response Input */}
          {selectedPrompt && (
            <div className="card p-6 rounded-lg shadow-lg">
              <h3 className="text-xl font-semibold text-gray-800 mb-4">Respond to Prompt</h3>
              <div className="space-y-4">
                <div className="bg-yellow-50 p-3 rounded-lg">
                  <div className="font-medium text-gray-800">{selectedPrompt.templateText}</div>
                </div>
                
                <div>
                  <label htmlFor="response-input" className="block text-sm font-medium text-gray-700 mb-2">
                    Your response:
                  </label>
                  <textarea
                    id="response-input"
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    placeholder="Enter your response here..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    rows={4}
                    disabled={isSubmitting}
                  />
                </div>
                
                <button
                  onClick={handleSubmitResponse}
                  disabled={isSubmitting || !responseText.trim()}
                  className="btn-primary w-full py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <div className="flex items-center justify-center space-x-2">
                      <div className="spinner"></div>
                      <span>Submitting...</span>
                    </div>
                  ) : (
                    'Submit Response'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column - Responses */}
        <div className="space-y-6">
          {/* Last Response */}
          {lastResponse && (
            <div className="card p-6 rounded-lg shadow-lg slide-in">
              <h3 className="text-xl font-semibold text-gray-800 mb-4">Last Response</h3>
              <div className="space-y-3">
                <div className="bg-green-50 p-3 rounded-lg">
                  <div className="font-medium text-gray-800">{lastResponse.text}</div>
                </div>
                <div className="text-sm text-gray-600">
                  POS Pattern: <code className="bg-gray-100 px-2 py-1 rounded text-xs">{lastResponse.posPattern}</code>
                </div>
                <div className="text-sm text-gray-600">
                  Lemmas: {lastResponse.lemmas.join(', ')}
                </div>
                <div className="text-sm text-gray-600">
                  Rating: {lastResponse.rating || 'Not rated'}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleRateResponse(lastResponse, 'like')}
                    className="btn-primary px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    Like
                  </button>
                  <button
                    onClick={() => handleRateResponse(lastResponse, 'skip')}
                    className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    Skip
                  </button>
                  {lastResponse.text.split(' ').length >= 2 && lastResponse.text.split(' ').length <= 10 && (
                    <button
                      onClick={() => setShowPromotionModal(true)}
                      className="bg-purple-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-600"
                    >
                      Promote to Phrase
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Responses for Selected Prompt */}
          {selectedPrompt && (
            <div className="card p-6 rounded-lg shadow-lg">
              <h3 className="text-xl font-semibold text-gray-800 mb-4">
                Responses ({getResponsesForPrompt(selectedPrompt.id).length})
              </h3>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {getResponsesForPrompt(selectedPrompt.id).map((response) => (
                  <div key={response.id} className="response-item p-3 rounded-lg">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="font-medium text-gray-800">{response.text}</div>
                        <div className="text-sm text-gray-600 mt-1">
                          <span className="bg-gray-200 px-2 py-1 rounded text-xs mr-2">
                            {response.posPattern}
                          </span>
                          {response.rating && (
                            <span className={`px-2 py-1 rounded text-xs ${
                              response.rating === 'like' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                            }`}>
                              {response.rating}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {new Date(response.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex space-x-1 ml-2">
                        <button
                          onClick={() => handleRateResponse(response, 'like')}
                          className="text-red-500 hover:text-red-700 text-sm"
                          title="Like"
                        >
                          ♥
                        </button>
                        <button
                          onClick={() => handleRateResponse(response, 'skip')}
                          className="text-gray-500 hover:text-gray-700 text-sm"
                          title="Skip"
                        >
                          ✗
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Response Statistics */}
          <div className="card p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">Statistics</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 p-3 rounded-lg">
                <div className="text-sm text-blue-600 font-medium">Total Responses</div>
                <div className="text-lg font-semibold text-blue-800">{responses.length}</div>
              </div>
              <div className="bg-green-50 p-3 rounded-lg">
                <div className="text-sm text-green-600 font-medium">Liked Responses</div>
                <div className="text-lg font-semibold text-green-800">
                  {responses.filter(r => r.rating === 'like').length}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Promotion Modal */}
      {showPromotionModal && lastResponse && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="card p-6 rounded-lg shadow-lg max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">Promote Response</h3>
            <p className="text-gray-600 mb-4">
              Promote "{lastResponse.text}" to a standalone phrase?
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => handlePromoteResponse(lastResponse)}
                className="btn-primary px-4 py-2 rounded-lg font-medium"
              >
                Promote
              </button>
              <button
                onClick={() => setShowPromotionModal(false)}
                className="btn-secondary px-4 py-2 rounded-lg font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
