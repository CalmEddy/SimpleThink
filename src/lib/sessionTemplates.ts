import { UnifiedTemplate } from '../types/index.js';
import { v4 as uuid } from 'uuid';
import { parseTemplateTextToTokens, buildBindings } from './parseTemplateText.js';

const store = new Map<string /*sessionId*/, UnifiedTemplate[]>();

export function listSessionTemplates(sessionId: string): UnifiedTemplate[] {
  return store.get(sessionId) ?? [];
}

export function addSessionTemplate(sessionId: string, tpl: Omit<UnifiedTemplate, 'id' | 'createdInSessionId'>): UnifiedTemplate {
  const arr = store.get(sessionId) ?? [];
  const tokens = parseTemplateTextToTokens(tpl.text);
  const created: UnifiedTemplate = {
    id: uuid(),
    createdInSessionId: sessionId,
    text: tpl.text,
    tokens,
    bindings: buildBindings(tokens),
    pinned: tpl.pinned ?? false,
    tags: tpl.tags ?? [],
    origin: tpl.origin ?? 'user',
  };
  arr.push(created);
  store.set(sessionId, arr);
  return created;
}

export function updateSessionTemplate(sessionId: string, templateId: string, patch: Partial<UnifiedTemplate>): UnifiedTemplate | undefined {
  const arr = store.get(sessionId);
  if (!arr) return;
  const idx = arr.findIndex(t => t.id === templateId);
  if (idx === -1) return;
  arr[idx] = { ...arr[idx], ...patch };
  store.set(sessionId, arr);
  return arr[idx];
}

export function removeSessionTemplate(sessionId: string, templateId: string): void {
  const arr = store.get(sessionId);
  if (!arr) return;
  const next = arr.filter(t => t.id !== templateId);
  store.set(sessionId, next);
}

export function clearSessionTemplates(sessionId: string): void {
  store.delete(sessionId);
}
