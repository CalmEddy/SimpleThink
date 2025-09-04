import { UserTemplate } from '../types/index.js';
import { v4 as uuid } from 'uuid';

const store = new Map<string /*sessionId*/, UserTemplate[]>();

export function listSessionTemplates(sessionId: string): UserTemplate[] {
  return store.get(sessionId) ?? [];
}

export function addSessionTemplate(sessionId: string, tpl: Omit<UserTemplate, 'id' | 'createdInSessionId' | 'source'> & { source?: UserTemplate['source'] }): UserTemplate {
  const arr = store.get(sessionId) ?? [];
  const created: UserTemplate = {
    id: uuid(),
    createdInSessionId: sessionId,
    source: tpl.source ?? 'user',
    text: tpl.text,
    slots: tpl.slots,
    pinned: tpl.pinned ?? false,
    tags: tpl.tags ?? [],
  };
  arr.push(created);
  store.set(sessionId, arr);
  return created;
}

export function updateSessionTemplate(sessionId: string, templateId: string, patch: Partial<UserTemplate>): UserTemplate | undefined {
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
