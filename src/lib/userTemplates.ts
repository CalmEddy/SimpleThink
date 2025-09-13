import { v4 as uuidv4 } from "uuid";
import type { TemplateDoc, TemplateBlock, PhraseBlock, PhraseToken, POS } from "../types";
import { ensureHydrated } from "./ensureHydrated.js";

// -------------------------------
// STORAGE SCHEMAS
// -------------------------------
const V1_KEY = "PROMPTER_TEMPLATES_V1"; // text-only templates (legacy)
const V2_KEY = "PROMPTER_TEMPLATES_V2"; // TemplateDoc-based templates
const GLOBAL_SESSION_ID = "__global__";

// ----------------- localStorage helpers (SSR-safe) -----------------
let MEMORY_STORE: any | null = null;
function getLS(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}
function readLS(key: string): string | null {
  const ls = getLS();
  if (!ls) return MEMORY_STORE?.[key] ?? null;
  return ls.getItem(key);
}
function writeLS(key: string, val: string) {
  const ls = getLS();
  if (!ls) {
    MEMORY_STORE = MEMORY_STORE || {};
    MEMORY_STORE[key] = val;
    return;
  }
  ls.setItem(key, val);
}

function broadcastTemplatesChanged(sessionId: string) {
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("prompter:templates-changed", { detail: { sessionId } }));
    }
  } catch {}
}

export type StoredTemplateV2 = {
  id: string;
  doc: TemplateDoc;           // canonical representation
  humanText?: string;         // for quick display (optional)
  tags?: string[];
  pinned?: boolean;
  origin?: "user" | "composer" | "system";
  createdAt?: string;
  updatedAt?: string;
};

type StoreV2 = {
  version: 2;
  sessions: Record<string, StoredTemplateV2[]>;
};

type StoreV1 = {
  version: 1;
  sessions: Record<string, { id: string; text: string; tags?: string[]; pinned?: boolean; origin?: string; createdAt?: string; updatedAt?: string }[]>;
};

function nowISO() { return new Date().toISOString(); }

function emptyV2(): StoreV2 { return { version: 2, sessions: {} }; }

function readV2(): StoreV2 | null {
  try {
    const raw = readLS(V2_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 2 && parsed.sessions) return parsed as StoreV2;
    return null;
  } catch { return null; }
}

function writeV2(store: StoreV2) {
  writeLS(V2_KEY, JSON.stringify(store));
}

function readV1(): StoreV1 | null {
  try {
    const raw = readLS(V1_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && parsed.sessions) return parsed as StoreV1;
    return null;
  } catch { return null; }
}

function textToDoc(id: string, text: string): TemplateDoc {
  // Minimal text doc (we will hydrate before storing/using).
  return { id, createdInSessionId: "user-templates", blocks: [{ kind: "text", text }] } as any;
}

function docToQuickText(doc: TemplateDoc): string {
  if (!doc || !Array.isArray(doc.blocks)) return "";
  const parts: string[] = [];
  for (const b of doc.blocks as TemplateBlock[]) {
    if ((b as any).kind === "text") {
      const t = (b as any).text || "";
      if (t) parts.push(String(t));
    } else if ((b as any).kind === "phrase") {
      const pb = b as PhraseBlock;
      const s = (pb.tokens || [])
        .map(tok => (tok.randomize && tok.pos ? `[${tok.pos}]` : (tok.text || "")))
        .join(" ");
      if (s) parts.push(s);
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function migrateV1toV2(v1: StoreV1): StoreV2 {
  const out: StoreV2 = emptyV2();
  for (const [sessionId, arr] of Object.entries(v1.sessions || {})) {
    if (!Array.isArray(arr)) continue;
    out.sessions[sessionId] = arr.map(t => {
      const id = t.id || uuidv4();
      const human = (t.text || "").trim();
      const doc = textToDoc(id, human);
      return {
        id,
        doc,
        humanText: human,
        tags: t.tags || [],
        pinned: !!t.pinned,
        origin: (t.origin as any) || "user",
        createdAt: t.createdAt || nowISO(),
        updatedAt: t.updatedAt || nowISO(),
      } as StoredTemplateV2;
    });
  }
  return out;
}

function hasRenderableBlocks(doc?: TemplateDoc): boolean {
  if (!doc || !Array.isArray((doc as any).blocks)) return false;
  if ((doc as any).blocks.length === 0) return false;
  for (const b of (doc as any).blocks as TemplateBlock[]) {
    if ((b as any).kind === "text" && typeof (b as any).text === "string" && (b as any).text.trim()) return true;
    if ((b as any).kind === "phrase" && Array.isArray((b as any).tokens) && (b as any).tokens.length > 0) return true;
  }
  return false;
}

// If a doc can't render (empty/missing blocks), reconstruct a basic text doc from humanText or doc.text.
function ensureDocRenderable(doc: TemplateDoc | undefined, fallbackText?: string): TemplateDoc | null {
  if (!doc) return null;
  const txt = (fallbackText || (doc as any).text || "").trim();
  if (hasRenderableBlocks(doc)) return doc;
  if (txt) return textToDoc(doc.id || `tmp_${Date.now()}`, txt);
  return null;
}

async function repairDocIfNeeded(t: StoredTemplateV2): Promise<StoredTemplateV2 | null> {
  if (!t || !t.doc) return null;
  let doc = t.doc;

  // Case: empty blocks but doc.text exists → rebuild blocks from text
  const docText: string = (doc as any).text || "";
  if ((!doc.blocks || doc.blocks.length === 0) && docText && docText.trim().length > 0) {
    doc = textToDoc(doc.id || t.id, docText);
  }

  // Drop truly empty docs (no blocks and no text)
  if ((!doc.blocks || doc.blocks.length === 0) && (!docText || !docText.trim())) {
    return null;
  }

  // Hydrate to phrase tokens (no graph needed)
  const hydrated = await ensureHydrated(doc);
  const human = (t.humanText && t.humanText.trim()) ? t.humanText : docToQuickText(hydrated);
  return { ...t, doc: hydrated, humanText: human };
}

async function normalizeStoreInPlace(store: StoreV2): Promise<void> {
  const sessions = store.sessions || {};
  for (const key of Object.keys(sessions)) {
    const arr = Array.isArray(sessions[key]) ? sessions[key] : [];
    const out: StoredTemplateV2[] = [];
    const seen = new Set<string>();
    for (const t of arr) {
      const repaired = await repairDocIfNeeded(t);
      if (!repaired) continue;
      // Dedup within the session by id
      const id = repaired.id || repaired.doc?.id || uuidv4();
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ ...repaired, id });
    }
    // Keep only items that actually render
    store.sessions[key] = out.filter(x => hasRenderableBlocks(x.doc));
  }
}

function ensureV2(): StoreV2 {
  const v2 = readV2();
  if (v2) { return v2; }
  const v1 = readV1();
  if (v1) {
    const migrated = migrateV1toV2(v1);
    writeV2(migrated);
    return migrated;
  }
  const fresh = emptyV2();
  writeV2(fresh);
  return fresh;
}

// -------------------------------
// PUBLIC API (backwards compatible names)
// -------------------------------
export function listSessionTemplates(sessionId: string): (StoredTemplateV2 & { text: string })[] {
  const store = ensureV2();
  const arr = (store.sessions[sessionId] ?? []).map(t => {
    // repair at read time so UI never looks empty for non-hydrated docs
    const repaired = ensureDocRenderable(t.doc, t.humanText) || t.doc;
    return { ...t, doc: repaired };
  }).filter(t => hasRenderableBlocks(t.doc));
  return arr.map(t => {
    const fallback = docToQuickText(t.doc);
    return { ...t, text: (t.humanText && t.humanText.trim()) ? t.humanText : fallback };
  });
}

// Union for UI: current session + global pool (dedup by id)
export function listTemplatesForUI(sessionId: string): (StoredTemplateV2 & { text: string })[] {
  const store = ensureV2();
  // quick guard: normalize once per read to avoid lingering broken entries
  // (no-op when already normalized)
  // Note: this is light work; it hydrates only when needed.
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  normalizeStoreInPlace(store);
  const main = (store.sessions[sessionId] ?? []).filter(t => hasRenderableBlocks(t.doc));
  const global = (store.sessions[GLOBAL_SESSION_ID] ?? []).filter(t => hasRenderableBlocks(t.doc));
  const byId = new Map<string, StoredTemplateV2>();
  for (const t of [...global, ...main]) byId.set(t.id, t);
  const arr = Array.from(byId.values());
  return arr.map(t => {
    const fallback = docToQuickText(t.doc);
    return { ...t, text: (t.humanText && t.humanText.trim()) ? t.humanText : fallback };
  });
}

export function listSessionTemplateDocs(sessionId: string): TemplateDoc[] {
  const store = ensureV2();
  return (store.sessions[sessionId] ?? [])
    .map(t => ensureDocRenderable(t.doc, t.humanText) || t.doc)
    .filter(d => !!d)
    .map(d => d as TemplateDoc);
}

export async function addSessionTemplate(
  sessionId: string,
  input: { text?: string; doc?: TemplateDoc; humanText?: string; tags?: string[]; pinned?: boolean; origin?: "user" | "composer" | "system" }
): Promise<StoredTemplateV2 & { text: string }> {
  const store = ensureV2();
  const sid = sessionId || GLOBAL_SESSION_ID;
  const arr = store.sessions[sid] ?? [];
  const id = (input.doc?.id) || uuidv4();
  const human = (input.humanText ?? input.text ?? "").trim();
  // Build doc from provided doc or text; then hydrate once so we persist in phrase-token form.
  const rawDoc: TemplateDoc = input.doc ?? textToDoc(id, human);
  const doc = await ensureHydrated(rawDoc);
  // Back-compat: mirror humanText into doc.text so any legacy readers see something
  const compatDoc = { ...(doc as any), text: (doc as any).text || human || docToQuickText(doc) } as TemplateDoc & { text?: string };

  const rec: StoredTemplateV2 = {
    id,
    doc: compatDoc,
    humanText: human || docToQuickText(doc),
    tags: input.tags ?? [],
    pinned: !!input.pinned,
    origin: input.origin ?? "user",
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  // Keep newest first
  arr.unshift(rec);
  store.sessions[sid] = arr;
  writeV2(store);
  broadcastTemplatesChanged(sid);
  return { ...rec, text: rec.humanText ?? "" };
}

export async function updateSessionTemplate(
  sessionId: string,
  id: string,
  patch: { text?: string; doc?: TemplateDoc; humanText?: string; tags?: string[]; pinned?: boolean }
): Promise<(StoredTemplateV2 & { text: string })> {
  const store = ensureV2();
  const sid = sessionId || GLOBAL_SESSION_ID;
  const arr = store.sessions[sid] ?? [];
  const idx = arr.findIndex(t => t.id === id);
  if (idx === -1) throw new Error("Template not found");
  const next = { ...arr[idx] };
  if (typeof patch.humanText === "string") next.humanText = patch.humanText.trim();
  if (typeof patch.text === "string") next.humanText = patch.text.trim();
  if (patch.doc) {
    const hydrated = await ensureHydrated(patch.doc);
    next.doc = { ...(hydrated as any), text: (hydrated as any).text || next.humanText || docToQuickText(hydrated) } as any;
    // refresh preview if not explicitly provided
    if (!patch.humanText && !patch.text) next.humanText = docToQuickText(next.doc);
  } else if (typeof patch.text === "string") {
    // if only text changed, rebuild + hydrate
    const rebuilt = await ensureHydrated(textToDoc(id, next.humanText ?? patch.text));
    next.doc = { ...(rebuilt as any), text: (rebuilt as any).text || next.humanText || docToQuickText(rebuilt) } as any;
    if (!patch.humanText) next.humanText = docToQuickText(rebuilt);
  }
  if (patch.tags) next.tags = [...patch.tags];
  if (typeof patch.pinned === "boolean") next.pinned = patch.pinned;
  next.updatedAt = nowISO();
  arr[idx] = next;
  store.sessions[sid] = arr;
  writeV2(store);
  broadcastTemplatesChanged(sid);
  return { ...next, text: next.humanText ?? "" };
}

export async function removeSessionTemplate(sessionId: string, id: string): Promise<void> {
  const store = ensureV2();
  const sid = sessionId || GLOBAL_SESSION_ID;
  const arr = store.sessions[sid] ?? [];
  store.sessions[sid] = arr.filter(t => t.id !== id);
  writeV2(store);
  broadcastTemplatesChanged(sid);
}

export async function saveAllTemplates(): Promise<void> {
  const store = ensureV2();
  await normalizeStoreInPlace(store);
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `prompter-templates-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Import templates and ADOPT them into the *current* session.
 * Accepts:
 *  - V2 {version:2,sessions:{...}}
 *  - V1 {version:1,sessions:{...}}
 *  - Array<TemplateDoc>  OR  Array<{doc:TemplateDoc}|{text:string}|string>
 */
export async function loadTemplatesFromFileForSession(sessionId: string): Promise<{ imported: number; skipped: number }> {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  const picked = await new Promise<File | null>((resolve) => {
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
  if (!picked) return { imported: 0, skipped: 0 };

  const raw = await picked.text();
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Invalid JSON file."); }

  // Normalize into an array of StoredTemplateV2-like items
  const normalizeToV2Array = async (p: any): Promise<StoredTemplateV2[]> => {
    const out: StoredTemplateV2[] = [];
    // Case A: V2 store
    if (p && p.version === 2 && p.sessions) {
      for (const arr of Object.values(p.sessions as Record<string, StoredTemplateV2[]>)) {
        if (!Array.isArray(arr)) continue;
        for (const t of arr) {
          if (t && t.doc) {
            out.push({
              id: t.id || uuidv4(),
              doc: await ensureHydrated(t.doc),
              humanText: t.humanText || docToQuickText(t.doc),
              tags: Array.isArray(t.tags) ? t.tags.slice() : [],
              pinned: !!t.pinned,
              origin: (t.origin as any) || "user",
              createdAt: t.createdAt || nowISO(),
              updatedAt: t.updatedAt || nowISO(),
            });
          }
        }
      }
      return out;
    }
    // Case B: V1 store
    if (p && p.version === 1 && p.sessions) {
      const migrated = migrateV1toV2(p as StoreV1);
      return normalizeToV2Array(migrated);
    }
    // Case C: array of docs or strings
    if (Array.isArray(p)) {
      for (const item of p) {
        if (!item) continue;
        if (typeof item === "string") {
          const id = uuidv4();
          const doc = await ensureHydrated(textToDoc(id, item));
          out.push({ id, doc, humanText: docToQuickText(doc), origin: "user", createdAt: nowISO(), updatedAt: nowISO() });
          continue;
        }
        if (item.doc) {
          const id = item.id || uuidv4();
          const doc = await ensureHydrated(item.doc);
          out.push({ id, doc, humanText: item.humanText || docToQuickText(doc), tags: item.tags || [], pinned: !!item.pinned, origin: item.origin || "user", createdAt: item.createdAt || nowISO(), updatedAt: item.updatedAt || nowISO() });
          continue;
        }
        if (item.blocks || item.text) {
          const id = item.id || uuidv4();
          const doc: TemplateDoc = item.blocks ? (await ensureHydrated(item as TemplateDoc)) : (await ensureHydrated(textToDoc(id, item.text)));
          out.push({ id, doc, humanText: docToQuickText(doc), origin: "user", createdAt: nowISO(), updatedAt: nowISO() });
          continue;
        }
      }
      return out;
    }
    // Fallback: unknown format
    return out;
  };

  const incomingArr = await normalizeToV2Array(parsed);
  if (!incomingArr.length) return { imported: 0, skipped: 0 };

  // Adopt into current session
  const curr = ensureV2();
  const sid = sessionId || GLOBAL_SESSION_ID;
  const existing = new Map((curr.sessions[sid] ?? []).map(t => [t.id, t]));
  let imported = 0, skipped = 0;
  for (const t of incomingArr) {
    if (!t || !t.doc) { skipped++; continue; }
    let id = t.id || uuidv4();
    if (existing.has(id)) {
      // If an identical id exists, mint a new one so the user can have both
      id = uuidv4();
    }
    const rec: StoredTemplateV2 = {
      ...t,
      id,
      createdAt: t.createdAt || nowISO(),
      updatedAt: t.updatedAt || nowISO(),
      tags: Array.isArray(t.tags) ? t.tags : [],
    };
    existing.set(id, rec);
    imported++;
  }
  curr.sessions[sid] = Array.from(existing.values()).sort((a,b) => (Date.parse(b.updatedAt||"") - Date.parse(a.updatedAt||"")));
  await normalizeStoreInPlace(curr);
  writeV2(curr);
  broadcastTemplatesChanged(sid);
  return { imported, skipped };
}

// Keep the old function for backward compatibility
export async function loadTemplatesFromFile(): Promise<{ imported: number; skipped: number }> {
  // Use a default session ID for backward compatibility
  return loadTemplatesFromFileForSession("default");
}

// Handy debuggers:
if (typeof window !== 'undefined') {
  (window as any).PROMPTER_DUMP = () => {
    try {
      const raw = readLS('PROMPTER_TEMPLATES_V2');
      const parsed = raw ? JSON.parse(raw) : null;
      console.log('[PROMPTER_DUMP] raw store', parsed);
      return parsed;
    } catch (e) {
      console.warn('[PROMPTER_DUMP] failed to parse store', e);
      return null;
    }
  };
  (window as any).PROMPTER_DUMP_SESS = (sid: string) => {
    try {
      const raw = readLS('PROMPTER_TEMPLATES_V2');
      const parsed = raw ? JSON.parse(raw) : null;
      const arr = parsed?.sessions?.[sid] ?? [];
      console.log('[PROMPTER_DUMP_SESS]', sid, arr);
      return arr;
    } catch (e) {
      console.warn('[PROMPTER_DUMP_SESS] failed', e);
      return null;
    }
  };
}
