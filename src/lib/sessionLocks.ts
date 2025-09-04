import type { SessionLocks } from '../types/index.js';
import type { SemanticGraphLite } from './semanticGraphLite.js';

// In-memory mirror to avoid excessive graph reads
const lockCache = new Map<string /*sessionId*/, SessionLocks>();

export function getSessionLocks(graph: SemanticGraphLite, sessionId: string): SessionLocks {
  const cached = lockCache.get(sessionId);
  if (cached) return cached;
  const stored = (graph as any).getSessionLocks?.(sessionId) as SessionLocks | undefined;
  const locks: SessionLocks = stored ?? { lockedWordIds: [], lockedChunkIds: [], lockedTemplateIds: [] };
  lockCache.set(sessionId, locks);
  return locks;
}

export function setSessionLocks(graph: SemanticGraphLite, sessionId: string, next: SessionLocks): void {
  lockCache.set(sessionId, next);
  if (typeof (graph as any).setSessionLocks === 'function') {
    (graph as any).setSessionLocks(sessionId, next);
  }
}

export function toggleWordLock(graph: SemanticGraphLite, sessionId: string, wordId: string): SessionLocks {
  const locks = getSessionLocks(graph, sessionId);
  const set = new Set(locks.lockedWordIds ?? []);
  set.has(wordId) ? set.delete(wordId) : set.add(wordId);
  const next = { ...locks, lockedWordIds: Array.from(set) };
  setSessionLocks(graph, sessionId, next);
  return next;
}

export function toggleChunkLock(graph: SemanticGraphLite, sessionId: string, chunkId: string): SessionLocks {
  const locks = getSessionLocks(graph, sessionId);
  const set = new Set(locks.lockedChunkIds ?? []);
  set.has(chunkId) ? set.delete(chunkId) : set.add(chunkId);
  const next = { ...locks, lockedChunkIds: Array.from(set) };
  setSessionLocks(graph, sessionId, next);
  return next;
}

export function toggleTemplateLock(graph: SemanticGraphLite, sessionId: string, tplId: string): SessionLocks {
  const locks = getSessionLocks(graph, sessionId);
  const set = new Set(locks.lockedTemplateIds ?? []);
  set.has(tplId) ? set.delete(tplId) : set.add(tplId);
  const next = { ...locks, lockedTemplateIds: Array.from(set) };
  setSessionLocks(graph, sessionId, next);
  return next;
}
