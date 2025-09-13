import { ensureHydrated } from '../ensureHydrated';
import type { TemplateDoc } from '../../types';

export type TemplateRecord = {
  id: string;                 // stable UUID
  sessionId: string | null;   // current topic; null if global
  doc: TemplateDoc;           // hydrated: phrase-only
  displayText: string;        // quick preview, derived from doc
  createdAt: string;
  updatedAt: string;
};

// Treat any of these as "global" (null in persistence)
const GLOBAL_SENTINELS = new Set<any>([undefined, null, '__global__', 'global', 'GLOBAL']);
function normalizeForPersist(sid: string | null | undefined): string | null {
  return GLOBAL_SENTINELS.has(sid as any) ? null : String(sid);
}
function normalizeForQuery(sid: string | null | undefined): string | null {
  // When asking the DB, "__global__" should match null
  return GLOBAL_SENTINELS.has(sid as any) ? null : String(sid);
}

// Optional debug — helps verify what's actually queried
function dbg(label: string, payload: any) {
  try { console.log(`[TemplateStore] ${label}`, payload); } catch {}
}

// Helper functions
function docToQuickText(doc: TemplateDoc): string {
  if (!doc || !Array.isArray(doc.blocks)) return "";
  const parts: string[] = [];
  for (const b of doc.blocks) {
    if ((b as any).kind === "text") {
      const t = (b as any).text || "";
      if (t) parts.push(String(t));
    } else if ((b as any).kind === "phrase") {
      const pb = b as any;
      const s = (pb.tokens || [])
        .map((tok: any) => (tok.randomize && tok.pos ? `[${tok.pos}]` : (tok.text || "")))
        .join(" ");
      if (s) parts.push(s);
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function hasRenderableBlocks(doc?: TemplateDoc): boolean {
  if (!doc || !Array.isArray((doc as any).blocks)) return false;
  if ((doc as any).blocks.length === 0) return false;
  for (const b of (doc as any).blocks) {
    if ((b as any).kind === "text" && typeof (b as any).text === "string" && (b as any).text.trim()) return true;
    if ((b as any).kind === "phrase" && Array.isArray((b as any).tokens) && (b as any).tokens.length > 0) return true;
  }
  return false;
}

// Event bus
const bus = (detail: any) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('prompter:templates-changed', { detail }));
  }
};

// Storage backend (localStorage-based for now)
const STORAGE_KEY = 'OTS_TEMPLATES';

async function dbPut(record: TemplateRecord): Promise<void> {
  const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const index = existing.findIndex((r: any) => r.id === record.id);
  if (index >= 0) {
    existing[index] = record;
  } else {
    existing.push(record);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

async function dbGet(id: string): Promise<TemplateRecord | null> {
  const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  return existing.find((r: any) => r.id === id) || null;
}

async function dbDelete(id: string): Promise<void> {
  const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const filtered = existing.filter((r: any) => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

async function dbQueryBySession(sessionId: string | null, includeGlobal: boolean = false): Promise<TemplateRecord[]> {
  const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  
  // USER TEMPLATES SHOULD BE AVAILABLE GLOBALLY - NO SESSION FILTERING
  // All user templates are available regardless of which session they were created in
  console.log('[TemplateStore] dbQueryBySession - returning ALL user templates:', {
    querySessionId: sessionId,
    includeGlobal,
    totalStored: existing.length,
    storedSessions: [...new Set(existing.map((r: any) => r.sessionId))],
    storedTemplates: existing.map((r: any) => ({ id: r.id, sessionId: r.sessionId, text: r.displayText?.substring(0, 50) }))
  });
  
  // Return ALL templates - no session filtering for user templates
  return existing;
}

async function dbQueryAll(): Promise<TemplateRecord[]> {
  const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  return existing;
}

// Main TemplateStore API
export const TemplateStore = {
  async save({ sessionId = null, text, doc }: { sessionId?: string | null; text?: string; doc?: TemplateDoc }): Promise<TemplateRecord> {
    const id = crypto.randomUUID();
    const baseDoc = doc ?? { 
      id, 
      createdInSessionId: 'user-templates', 
      blocks: [{ kind: 'text', text: (text || '').trim() }] 
    } as TemplateDoc;
    
    const hydrated = await ensureHydrated(baseDoc);
    if (!hasRenderableBlocks(hydrated)) {
      throw new Error('Empty template (no tokens/no text)');
    }
    
    // Persist "global" as null so queries can match it consistently
    const normalizedSessionId = normalizeForPersist(sessionId);
    
    const rec: TemplateRecord = {
      id, 
      sessionId: normalizedSessionId, 
      doc: hydrated,
      displayText: docToQuickText(hydrated),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    await dbPut(rec);
    bus({ sessionId: normalizedSessionId });
    return rec;
  },

  async list(sessionId: string | null, opts?: { includeGlobal?: boolean }): Promise<TemplateRecord[]> {
    // USER TEMPLATES ARE ALWAYS GLOBAL - NO SESSION FILTERING
    const rows = await dbQueryBySession(sessionId, opts?.includeGlobal);
    const sorted = rows.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    dbg('list', { in: sessionId, includeGlobal: opts?.includeGlobal, count: sorted.length, note: 'ALL user templates returned' });
    return sorted;
  },

  async listAll(): Promise<TemplateRecord[]> {
    const rows = await dbQueryAll();
    const sorted = rows.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    console.log('[TemplateStore] listAll:', { 
      count: sorted.length, 
      sessions: [...new Set(sorted.map(r => r.sessionId))],
      templates: sorted.map(r => ({ id: r.id, sessionId: r.sessionId, text: r.displayText?.substring(0, 50) }))
    });
    return sorted;
  },

  async update(id: string, patch: { text?: string; doc?: TemplateDoc; sessionId?: string | null }): Promise<TemplateRecord> {
    const prev = await dbGet(id);
    if (!prev) throw new Error('Not found');
    
    let nextDoc = patch.doc ?? prev.doc;
    if (patch.text !== undefined) {
      nextDoc = await ensureHydrated({ 
        id: prev.doc.id, 
        createdInSessionId: 'user-templates', 
        blocks: [{ kind: 'text', text: patch.text }] 
      } as TemplateDoc);
    }
    
    if (!hasRenderableBlocks(nextDoc)) {
      throw new Error('Refusing to save empty template');
    }
    
    const normalizedSessionId = normalizeForPersist(patch.sessionId ?? prev.sessionId);
    
    const rec: TemplateRecord = {
      ...prev,
      sessionId: normalizedSessionId,
      doc: nextDoc,
      displayText: docToQuickText(nextDoc),
      updatedAt: new Date().toISOString(),
    };
    
    await dbPut(rec);
    bus({ sessionId: normalizedSessionId });
    return rec;
  },

  async remove(id: string): Promise<void> {
    const prev = await dbGet(id);
    await dbDelete(id);
    bus({ sessionId: prev?.sessionId ?? null });
  },

  // Migration helper
  async migrateFromLegacy(): Promise<{ migrated: number; skipped: number }> {
    let migrated = 0;
    let skipped = 0;

    try {
      // Try V2 first
      const v2Raw = localStorage.getItem('PROMPTER_TEMPLATES_V2');
      if (v2Raw) {
        const v2Data = JSON.parse(v2Raw);
        for (const [sessionKey, templates] of Object.entries(v2Data.sessions || {})) {
          for (const template of templates as any[]) {
            try {
              const sessionId = sessionKey === '__global__' ? null : sessionKey;
              await this.save({ 
                sessionId, 
                text: template.humanText || template.text,
                doc: template.doc 
              });
              migrated++;
            } catch {
              skipped++;
            }
          }
        }
        localStorage.removeItem('PROMPTER_TEMPLATES_V2');
      }

      // Try V1
      const v1Raw = localStorage.getItem('PROMPTER_TEMPLATES_V1');
      if (v1Raw) {
        const v1Data = JSON.parse(v1Raw);
        for (const [sessionKey, templates] of Object.entries(v1Data.sessions || {})) {
          for (const template of templates as any[]) {
            try {
              const sessionId = sessionKey === 'default' ? null : sessionKey;
              await this.save({ 
                sessionId, 
                text: template.text 
              });
              migrated++;
            } catch {
              skipped++;
            }
          }
        }
        localStorage.removeItem('PROMPTER_TEMPLATES_V1');
      }
    } catch (error) {
      console.warn('Migration failed:', error);
    }

    return { migrated, skipped };
  }
};
