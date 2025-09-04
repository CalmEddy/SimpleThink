import React from 'react';
import { useActiveNodesWithGraph } from '../contexts/ActiveNodesContext';
import { getSessionLocks, toggleWordLock, toggleChunkLock, toggleTemplateLock } from '../lib/sessionLocks';
import type { SemanticGraphLite } from '../lib/semanticGraphLite.js';

interface LocksPanelProps {
  graph: SemanticGraphLite;
}

export default function LocksPanel({ graph }: LocksPanelProps) {
  const { contextFrame, ctx } = useActiveNodesWithGraph(graph);
  const locks = getSessionLocks(graph, contextFrame?.sessionId || 'default');
  const wordLocked = new Set(locks.lockedWordIds ?? []);
  const chunkLocked = new Set(locks.lockedChunkIds ?? []);

  if (!contextFrame) {
    return <div className="text-sm text-gray-500">No active session</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-medium mb-1">Word Locks</h4>
        <div className="flex flex-wrap gap-2 max-h-48 overflow-auto">
          {ctx.words.map(w => (
            <button
              key={w.id}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                wordLocked.has(w.id)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
              onClick={() => toggleWordLock(graph, contextFrame.sessionId, w.id)}
            >
              {wordLocked.has(w.id) ? '🔒' : '🔓'} {w.lemma}
            </button>
          ))}
        </div>
      </div>
      <div>
        <h4 className="font-medium mb-1">Chunk Locks</h4>
        <div className="flex flex-wrap gap-2 max-h-48 overflow-auto">
          {ctx.chunks.map(c => (
            <button
              key={c.id}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                chunkLocked.has(c.id)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
              onClick={() => toggleChunkLock(graph, contextFrame.sessionId, c.id)}
            >
              {chunkLocked.has(c.id) ? '🔒' : '🔓'} 
              <span className="bg-gray-300 px-1 py-0.5 rounded text-xs ml-1">{c.posPattern}</span>
              {c.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
