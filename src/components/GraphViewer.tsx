import React, { useState, useMemo, useEffect } from 'react';
import { SemanticGraphLite } from '../lib/semanticGraphLite.js';
import type { Node, Edge, WordNode, PhraseNode, PromptNode, ResponseNode, TopicNode, SessionNode } from '../types/index.js';

interface GraphViewerProps {
  graph: SemanticGraphLite;
  onGraphUpdate: () => void;
  onError: (error: string) => void;
}

type ViewMode = 'overview' | 'nodes' | 'edges' | 'word-details' | 'phrase-details' | 'prompt-details';

export default function GraphViewer({ graph, onGraphUpdate, onError }: GraphViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('id');
  // Get all nodes and edges - use node count as dependency to force refresh
  const nodeCount = graph.getNodeCount();
  const edgeCount = graph.getEdgeCount();
  
  const allNodes = useMemo(() => graph.getNodesByType('WORD').concat(
    graph.getNodesByType('PHRASE'),
    graph.getNodesByType('PROMPT'),
    graph.getNodesByType('RESPONSE'),
    graph.getNodesByType('TOPIC'),
    graph.getNodesByType('SESSION')
  ), [graph, nodeCount]);

  const allEdges = useMemo(() => graph.getEdges(), [graph, edgeCount]);

  // Filter and search logic
  const filteredNodes = useMemo(() => {
    let filtered = allNodes;

    // Filter by type
    if (filterType !== 'all') {
      filtered = filtered.filter(node => node.type === filterType);
    }

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(node => {
        if (node.type === 'WORD') {
          const wordNode = node as WordNode;
          return wordNode.text.toLowerCase().includes(term) || 
                 wordNode.lemma.toLowerCase().includes(term) ||
                 wordNode.pos.some(p => p.toLowerCase().includes(term));
        } else if (node.type === 'PHRASE') {
          const phraseNode = node as PhraseNode;
          return phraseNode.text.toLowerCase().includes(term) ||
                 phraseNode.lemmas.some(l => l.toLowerCase().includes(term)) ||
                 phraseNode.posPattern.toLowerCase().includes(term);
        } else if (node.type === 'PROMPT') {
          const promptNode = node as PromptNode;
          return promptNode.templateText.toLowerCase().includes(term) ||
                 promptNode.templateId.toLowerCase().includes(term);
        } else if (node.type === 'RESPONSE') {
          const responseNode = node as ResponseNode;
          return responseNode.text.toLowerCase().includes(term) ||
                 responseNode.lemmas.some(l => l.toLowerCase().includes(term));
        } else if (node.type === 'TOPIC') {
          const topicNode = node as TopicNode;
          return topicNode.text.toLowerCase().includes(term) ||
                 topicNode.lemmas.some(l => l.toLowerCase().includes(term)) ||
                 (topicNode.keywords && topicNode.keywords.some(k => k.toLowerCase().includes(term)));
        } else if (node.type === 'SESSION') {
          const sessionNode = node as SessionNode;
          return sessionNode.id.toLowerCase().includes(term) ||
                 sessionNode.topicId.toLowerCase().includes(term) ||
                 (sessionNode.entityBindings && Object.keys(sessionNode.entityBindings).some(k => k.toLowerCase().includes(term)));
        }
        return false;
      });
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'type':
          return a.type.localeCompare(b.type);
        case 'text':
          const aText = 'text' in a ? a.text : a.id;
          const bText = 'text' in b ? b.text : b.id;
          return aText.localeCompare(bText);
        case 'stats':
          const aStats = 'stats' in a ? (a.stats?.uses || 0) + (a.stats?.likes || 0) : 0;
          const bStats = 'stats' in b ? (b.stats?.uses || 0) + (b.stats?.likes || 0) : 0;
          return bStats - aStats;
        default:
          return a.id.localeCompare(b.id);
      }
    });

    return filtered;
  }, [allNodes, filterType, searchTerm, sortBy]);

  const filteredEdges = useMemo(() => {
    let filtered = allEdges;

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(edge => {
        const fromNode = graph.getNodesByType('WORD').concat(
          graph.getNodesByType('PHRASE'),
          graph.getNodesByType('PROMPT'),
          graph.getNodesByType('RESPONSE'),
          graph.getNodesByType('TOPIC'),
          graph.getNodesByType('SESSION')
        ).find(n => n.id === edge.from);
        const toNode = graph.getNodesByType('WORD').concat(
          graph.getNodesByType('PHRASE'),
          graph.getNodesByType('PROMPT'),
          graph.getNodesByType('RESPONSE'),
          graph.getNodesByType('TOPIC'),
          graph.getNodesByType('SESSION')
        ).find(n => n.id === edge.to);
        
        return edge.type.toLowerCase().includes(term) ||
               (fromNode && 'text' in fromNode && fromNode.text.toLowerCase().includes(term)) ||
               (toNode && 'text' in toNode && toNode.text.toLowerCase().includes(term));
      });
    }

    return filtered;
  }, [allEdges, searchTerm, graph]);

  const handleNodeClick = (node: Node) => {
    setSelectedNode(node);
    setSelectedEdge(null);
  };

  const handleEdgeClick = (edge: Edge) => {
    setSelectedEdge(edge);
    setSelectedNode(null);
  };

  const renderNodeDetails = (node: Node) => {
    if (node.type === 'WORD') {
      const wordNode = node as WordNode;
      return (
        <div className="space-y-3">
          <div>
            <h4 className="font-semibold text-gray-800">Word Details</h4>
            <div className="text-sm text-gray-600 mt-1">
              <div><strong>Text:</strong> {wordNode.text}</div>
              <div><strong>Lemma:</strong> {wordNode.lemma}</div>
              <div><strong>POS:</strong> {wordNode.pos.join(', ')}</div>
              <div><strong>Potential POS:</strong> {wordNode.posPotential?.join(', ') || 'N/A'}</div>
              <div><strong>Primary POS:</strong> {wordNode.primaryPOS || 'N/A'}</div>
              <div><strong>Is Polysemous:</strong> {wordNode.isPolysemousPOS ? 'Yes' : 'No'}</div>
              {wordNode.posObserved && Object.keys(wordNode.posObserved).length > 0 && (
                <div><strong>Observed POS:</strong> {Object.entries(wordNode.posObserved).map(([pos, count]) => `${pos}: ${count}`).join(', ')}</div>
              )}
              {wordNode.stats && (
                <div><strong>Stats:</strong> {wordNode.stats.uses} uses, {wordNode.stats.likes} likes</div>
              )}
            </div>
          </div>
        </div>
      );
    } else if (node.type === 'PHRASE') {
      const phraseNode = node as PhraseNode;
      return (
        <div className="space-y-3">
          <div>
            <h4 className="font-semibold text-gray-800">Phrase Details</h4>
            <div className="text-sm text-gray-600 mt-1">
              <div><strong>Text:</strong> {phraseNode.text}</div>
              <div><strong>POS Pattern:</strong> {phraseNode.posPattern}</div>
              <div><strong>Lemmas:</strong> {phraseNode.lemmas.join(', ')}</div>
              <div><strong>Word IDs:</strong> {phraseNode.wordIds.length} words</div>
              <div><strong>Chunks:</strong> {phraseNode.chunks.length} chunks</div>
              {phraseNode.derivedFromId && (
                <div><strong>Derived From:</strong> {phraseNode.derivedFromId}</div>
              )}
              {phraseNode.stats && (
                <div><strong>Stats:</strong> {phraseNode.stats.uses} uses, {phraseNode.stats.likes} likes</div>
              )}
            </div>
          </div>
        </div>
      );
    } else if (node.type === 'PROMPT') {
      const promptNode = node as PromptNode;
      return (
        <div className="space-y-3">
          <div>
            <h4 className="font-semibold text-gray-800">Prompt Details</h4>
            <div className="text-sm text-gray-600 mt-1">
              <div><strong>Template ID:</strong> {promptNode.templateId}</div>
              <div><strong>Template Text:</strong> {promptNode.templateText}</div>
              <div><strong>Bindings:</strong> {promptNode.bindings.length} slots</div>
              <div><strong>Created:</strong> {new Date(promptNode.createdAt).toLocaleString()}</div>
              {promptNode.sessionId && (
                <div><strong>Session ID:</strong> {promptNode.sessionId}</div>
              )}
            </div>
          </div>
        </div>
      );
    } else if (node.type === 'RESPONSE') {
      const responseNode = node as ResponseNode;
      return (
        <div className="space-y-3">
          <div>
            <h4 className="font-semibold text-gray-800">Response Details</h4>
            <div className="text-sm text-gray-600 mt-1">
              <div><strong>Text:</strong> {responseNode.text}</div>
              <div><strong>POS Pattern:</strong> {responseNode.posPattern}</div>
              <div><strong>Lemmas:</strong> {responseNode.lemmas.join(', ')}</div>
              <div><strong>Prompt ID:</strong> {responseNode.promptId}</div>
              <div><strong>Word IDs:</strong> {responseNode.wordIds.length} words</div>
              <div><strong>Created:</strong> {new Date(responseNode.createdAt).toLocaleString()}</div>
              {responseNode.rating && (
                <div><strong>Rating:</strong> {responseNode.rating}</div>
              )}
            </div>
          </div>
        </div>
      );
    } else if (node.type === 'TOPIC') {
      const topicNode = node as TopicNode;
      return (
        <div className="space-y-3">
          <div>
            <h4 className="font-semibold text-gray-800">Topic Details</h4>
            <div className="text-sm text-gray-600 mt-1">
              <div><strong>Text:</strong> {topicNode.text}</div>
              <div><strong>Lemmas:</strong> {topicNode.lemmas.join(', ')}</div>
              {topicNode.posPattern && (
                <div><strong>POS Pattern:</strong> {topicNode.posPattern}</div>
              )}
              {topicNode.keywords && topicNode.keywords.length > 0 && (
                <div><strong>Keywords:</strong> {topicNode.keywords.join(', ')}</div>
              )}
              <div><strong>Created:</strong> {new Date(topicNode.createdAt).toLocaleString()}</div>
              <div><strong>Updated:</strong> {new Date(topicNode.updatedAt).toLocaleString()}</div>
            </div>
          </div>
        </div>
      );
    } else if (node.type === 'SESSION') {
      const sessionNode = node as SessionNode;
      return (
        <div className="space-y-3">
          <div>
            <h4 className="font-semibold text-gray-800">Session Details</h4>
            <div className="text-sm text-gray-600 mt-1">
              <div><strong>Topic ID:</strong> {sessionNode.topicId}</div>
              <div><strong>Started:</strong> {new Date(sessionNode.startedAt).toLocaleString()}</div>
              {sessionNode.endedAt && (
                <div><strong>Ended:</strong> {new Date(sessionNode.endedAt).toLocaleString()}</div>
              )}
              {sessionNode.entityBindings && Object.keys(sessionNode.entityBindings).length > 0 && (
                <div>
                  <strong>Entity Bindings:</strong>
                  <div className="ml-4 mt-1">
                    {Object.entries(sessionNode.entityBindings).map(([key, binding]) => (
                      <div key={key} className="text-xs">
                        <strong>{key}:</strong> {binding.referent} ({binding.kind || 'unknown'})
                        {binding.aliases && binding.aliases.length > 0 && (
                          <span> - aliases: {binding.aliases.join(', ')}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  const renderEdgeDetails = (edge: Edge) => {
    const fromNode = allNodes.find(n => n.id === edge.from);
    const toNode = allNodes.find(n => n.id === edge.to);
    
    return (
      <div className="space-y-3">
        <div>
          <h4 className="font-semibold text-gray-800">Edge Details</h4>
          <div className="text-sm text-gray-600 mt-1">
            <div><strong>Type:</strong> {edge.type}</div>
            <div><strong>From:</strong> {fromNode ? (fromNode.type + ': ' + ('text' in fromNode ? fromNode.text : fromNode.id)) : edge.from}</div>
            <div><strong>To:</strong> {toNode ? (toNode.type + ': ' + ('text' in toNode ? toNode.text : toNode.id)) : edge.to}</div>
            {edge.meta && Object.keys(edge.meta).length > 0 && (
              <div><strong>Metadata:</strong> {JSON.stringify(edge.meta, null, 2)}</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderOverview = () => {
    const nodeCounts = {
      WORD: graph.getNodesByType('WORD').length,
      PHRASE: graph.getNodesByType('PHRASE').length,
      PROMPT: graph.getNodesByType('PROMPT').length,
      RESPONSE: graph.getNodesByType('RESPONSE').length,
      TOPIC: graph.getNodesByType('TOPIC').length,
      SESSION: graph.getNodesByType('SESSION').length,
    };

    const edgeCounts = allEdges.reduce((acc, edge) => {
      acc[edge.type] = (acc[edge.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(nodeCounts).map(([type, count]) => (
            <div key={type} className="card p-4 rounded-lg text-center">
              <div className="text-2xl font-bold text-blue-600">{count}</div>
              <div className="text-sm text-gray-600">{type} Nodes</div>
            </div>
          ))}
        </div>

        <div className="card p-6 rounded-lg">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Edge Types</h3>
          <div className="space-y-2">
            {Object.entries(edgeCounts).map(([type, count]) => (
              <div key={type} className="flex justify-between items-center">
                <span className="text-sm text-gray-600">{type}</span>
                <span className="text-sm font-medium text-gray-800">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-6 rounded-lg">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Graph Statistics</h3>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Total Nodes</span>
              <span className="text-sm font-medium text-gray-800">{allNodes.length}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Total Edges</span>
              <span className="text-sm font-medium text-gray-800">{allEdges.length}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Average Connections per Node</span>
              <span className="text-sm font-medium text-gray-800">
                {allNodes.length > 0 ? (allEdges.length / allNodes.length).toFixed(2) : '0'}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderNodesView = () => (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-gray-700">Filter:</label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded-md text-sm"
          >
            <option value="all">All Types</option>
            <option value="WORD">Words</option>
            <option value="PHRASE">Phrases</option>
            <option value="PROMPT">Prompts</option>
            <option value="RESPONSE">Responses</option>
            <option value="TOPIC">Topics</option>
            <option value="SESSION">Sessions</option>
          </select>
        </div>
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-gray-700">Sort:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded-md text-sm"
          >
            <option value="id">ID</option>
            <option value="type">Type</option>
            <option value="text">Text</option>
            <option value="stats">Stats</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredNodes.map((node) => (
          <div
            key={node.id}
            className={`card p-4 rounded-lg cursor-pointer transition-all ${
              selectedNode?.id === node.id ? 'ring-2 ring-blue-500' : 'hover:shadow-md'
            }`}
            onClick={() => handleNodeClick(node)}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    {node.type}
                  </span>
                </div>
                <div className="mt-2">
                  {'text' in node ? (
                    <div className="font-medium text-gray-800 truncate">{node.text}</div>
                  ) : (
                    <div className="font-medium text-gray-800 truncate">{node.id}</div>
                  )}
                </div>
                {node.type === 'WORD' && (
                  <div className="text-xs text-gray-500 mt-1">
                    {(node as WordNode).lemma} • {(node as WordNode).pos.join(', ')}
                  </div>
                )}
                {node.type === 'PHRASE' && (
                  <div className="text-xs text-gray-500 mt-1">
                    {(node as PhraseNode).posPattern} • {(node as PhraseNode).lemmas.length} lemmas
                  </div>
                )}
                {node.type === 'TOPIC' && (
                  <div className="text-xs text-gray-500 mt-1">
                    {(node as TopicNode).lemmas.length} lemmas • {(node as TopicNode).keywords?.length || 0} keywords
                  </div>
                )}
                {node.type === 'SESSION' && (
                  <div className="text-xs text-gray-500 mt-1">
                    Topic: {(node as SessionNode).topicId} • {(node as SessionNode).entityBindings ? Object.keys((node as SessionNode).entityBindings!).length : 0} entities
                  </div>
                )}
                {'stats' in node && node.stats && (
                  <div className="text-xs text-gray-500 mt-1">
                    {node.stats.uses} uses • {node.stats.likes} likes
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderEdgesView = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredEdges.map((edge) => {
          const fromNode = allNodes.find(n => n.id === edge.from);
          const toNode = allNodes.find(n => n.id === edge.to);
          
          return (
            <div
              key={edge.id}
              className={`card p-4 rounded-lg cursor-pointer transition-all ${
                selectedEdge?.id === edge.id ? 'ring-2 ring-blue-500' : 'hover:shadow-md'
              }`}
              onClick={() => handleEdgeClick(edge)}
            >
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                    {edge.type}
                  </span>
                </div>
                <div className="text-sm">
                  <div className="font-medium text-gray-800">
                    {fromNode ? (fromNode.type + ': ' + ('text' in fromNode ? fromNode.text : fromNode.id)) : edge.from}
                  </div>
                  <div className="text-gray-500">→</div>
                  <div className="font-medium text-gray-800">
                    {toNode ? (toNode.type + ': ' + ('text' in toNode ? toNode.text : toNode.id)) : edge.to}
                  </div>
                </div>
                {edge.meta && Object.keys(edge.meta).length > 0 && (
                  <div className="text-xs text-gray-500">
                    Meta: {Object.keys(edge.meta).join(', ')}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-3xl font-bold text-white mb-2">Graph Viewer</h2>
        <p className="text-white/80">
          Explore the semantic graph structure, nodes, and relationships
        </p>
      </div>

      {/* Controls */}
      <div className="card p-6 rounded-lg shadow-lg">
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">View:</label>
              <select
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as ViewMode)}
                className="px-3 py-1 border border-gray-300 rounded-md text-sm"
              >
                <option value="overview">Overview</option>
                <option value="nodes">Nodes</option>
                <option value="edges">Edges</option>
                <option value="word-details">Word Details</option>
                <option value="phrase-details">Phrase Details</option>
                <option value="prompt-details">Prompt Details</option>
              </select>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm w-48"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2">
          <div className="card p-6 rounded-lg shadow-lg">
            {viewMode === 'overview' && renderOverview()}
            {viewMode === 'nodes' && renderNodesView()}
            {viewMode === 'edges' && renderEdgesView()}
            {viewMode === 'word-details' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800">Word Nodes</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {graph.getNodesByType('WORD').map((word) => (
                    <div
                      key={word.id}
                      className={`p-4 rounded-lg cursor-pointer transition-all ${
                        selectedNode?.id === word.id ? 'ring-2 ring-blue-500' : 'hover:shadow-md'
                      }`}
                      onClick={() => handleNodeClick(word)}
                    >
                      <div className="font-medium text-gray-800">{word.text}</div>
                      <div className="text-sm text-gray-600 mt-1">
                        <div>Lemma: {word.lemma}</div>
                        <div>POS: {word.pos.join(', ')}</div>
                        {word.posPotential && (
                          <div>Potential: {word.posPotential.join(', ')}</div>
                        )}
                        {word.isPolysemousPOS && (
                          <div className="text-orange-600">Polysemous</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {viewMode === 'phrase-details' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800">Phrase Nodes</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {graph.getNodesByType('PHRASE').map((phrase) => (
                    <div
                      key={phrase.id}
                      className={`p-4 rounded-lg cursor-pointer transition-all ${
                        selectedNode?.id === phrase.id ? 'ring-2 ring-blue-500' : 'hover:shadow-md'
                      }`}
                      onClick={() => handleNodeClick(phrase)}
                    >
                      <div className="font-medium text-gray-800">{phrase.text}</div>
                      <div className="text-sm text-gray-600 mt-1">
                        <div>Pattern: {phrase.posPattern}</div>
                        <div>Lemmas: {phrase.lemmas.join(', ')}</div>
                        <div>Chunks: {phrase.chunks.length}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {viewMode === 'prompt-details' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800">Prompt Nodes</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {graph.getNodesByType('PROMPT').map((prompt) => (
                    <div
                      key={prompt.id}
                      className={`p-4 rounded-lg cursor-pointer transition-all ${
                        selectedNode?.id === prompt.id ? 'ring-2 ring-blue-500' : 'hover:shadow-md'
                      }`}
                      onClick={() => handleNodeClick(prompt)}
                    >
                      <div className="font-medium text-gray-800">{prompt.templateText}</div>
                      <div className="text-sm text-gray-600 mt-1">
                        <div>ID: {prompt.templateId}</div>
                        <div>Bindings: {prompt.bindings.length}</div>
                        <div>Created: {new Date(prompt.createdAt).toLocaleDateString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar - Details */}
        <div className="lg:col-span-1">
          {(selectedNode || selectedEdge) && (
            <div className="card p-6 rounded-lg shadow-lg">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">
                {selectedNode ? 'Node Details' : 'Edge Details'}
              </h3>
              {selectedNode && renderNodeDetails(selectedNode)}
              {selectedEdge && renderEdgeDetails(selectedEdge)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
