// src/lib/templateSaving.ts
import type { TemplateDoc, PhraseBlock, POS, SlotDescriptor } from "../types";
import { ensureHydrated } from "./ensureHydrated";
import { TemplateStore } from "./templateStore"; // your OTS

// Convert a TemplateDoc to a quick "pattern" string for display/saving fallbacks.
export function docToPattern(doc: TemplateDoc): string {
  const parts: string[] = [];
  for (const b of (doc.blocks || [])) {
    if ((b as any).kind === "phrase") {
      const pb = b as PhraseBlock;
      for (const t of pb.tokens || []) {
        if (t.randomize && t.pos) parts.push(`[${t.pos as POS}]`);
        else if (t.text) parts.push(t.text);
      }
    } else if ((b as any).kind === "text") {
      const txt = (b as any).text || "";
      if (txt.trim()) parts.push(txt);
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// Build a pattern string from a chip list (if you have one).
export function tokensToPatternString(tokens: SlotDescriptor[]): string {
  return (tokens ?? []).map(t => {
    if (t.kind === 'chunk') {
      return `[CHUNK:[${t.chunkPattern ?? ''}]]`;
    } else if (t.kind === 'slot' && t.pos) {
      return `[${t.pos}${t.index ?? ''}]`;
    } else {
      return ''; // Skip invalid tokens
    }
  }).filter(s => s.length > 0).join(' ').trim();
}

/**
 * Save a template from whichever source you have:
 * - rawText: the user typed pattern
 * - tokens: chip tokens (slots/chunks)
 * - doc: current TemplateDoc (edited in the composer)
 */
export async function saveTemplateRobust(
  sessionId: string | null | undefined,
  opts: { rawText?: string; tokens?: SlotDescriptor[]; doc?: TemplateDoc; graph?: any }
) {
  const sid = sessionId ?? null;

  // 1) prefer raw text if present
  let pattern = (opts.rawText || '').trim();

  // 2) else derive from chips
  if (!pattern && opts.tokens?.length) {
    pattern = tokensToPatternString(opts.tokens);
  }

  // 3) else derive from doc
  let doc: TemplateDoc | undefined = opts.doc;
  if (!pattern && doc) {
    pattern = docToPattern(doc);
  }

  // If we still have nothing, this is truly empty.
  if (!pattern && !doc) {
    throw new Error("Empty template (no tokens/no text)");
  }

  // If we have text but no doc, hydrate a text doc.
  if (!doc && pattern) {
    const rawDoc: TemplateDoc = {
      id: `user_tpl_${Date.now()}`,
      createdInSessionId: 'user-templates',
      blocks: [{ kind: 'text', text: pattern }]
    } as any;
    doc = await ensureHydrated(rawDoc, opts.graph);
  }

  // Finally, save using the unified store (hydration already done).
  const rec = await TemplateStore.save({ sessionId: sid, doc });
  return rec;
}
