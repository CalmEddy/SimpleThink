import type { TemplateDoc, PhraseBlock, TextBlock, PhraseToken, MorphFeature } from '../types';

// TML rules:
// - Text outside [ ... ] is literal text blocks
// - Inside [ ... ] is a phrase block with space-separated tokens
// - {word} marks a randomized token; {word#X} links to label X
// - {word^morph} marks morphological form; {word^morph#X} combines both

const PHRASE_RE = /\[([\s\S]*?)\]/g; // greedy across lines
const RAND_RE = /^\{([^}]+)\}$/; // {word} or {word#label} or {word^morph} or {word^morph#label}

export function parseTML(tml: string, sessionId: string): TemplateDoc {
  const doc: TemplateDoc = { id: `doc:${Date.now()}`, blocks: [], createdInSessionId: sessionId };
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = PHRASE_RE.exec(tml))) {
    const before = tml.slice(idx, m.index);
    if (before.trim().length) {
      doc.blocks.push({ kind: 'text', text: before } as TextBlock);
    } else if (before.length) {
      doc.blocks.push({ kind: 'text', text: before } as TextBlock);
    }
    const inner = m[1].trim();
    const tokens = inner.length ? inner.split(/\s+/).map(toPhraseToken) : [];
    doc.blocks.push({ kind: 'phrase', phraseText: tokens.map(t => t.text).join(' '), tokens } as PhraseBlock);
    idx = m.index + m[0].length;
  }
  const after = tml.slice(idx);
  if (after.length) doc.blocks.push({ kind: 'text', text: after } as TextBlock);
  return doc;
}

function toPhraseToken(word: string): PhraseToken {
  const m = RAND_RE.exec(word);
  if (!m) return { text: word, randomize: false };
  const inner = m[1];
  
  // Parse {word^morph#label} or {word#label^morph} or {word^morph} or {word#label}
  const labelMatch = inner.match(/#([A-Za-z0-9]+)\b/);
  const morphMatch = inner.match(/\^([A-Za-z_]+)\b/);
  const slotLabel = labelMatch ? labelMatch[1] : null;
  const morph = (morphMatch ? morphMatch[1] : null) as MorphFeature | null;
  const core = inner
    .replace(/#([A-Za-z0-9]+)\b/, '')
    .replace(/\^([A-Za-z_]+)\b/, '')
    .trim();
  
  return { 
    text: core, 
    randomize: true, 
    slotLabel, 
    morph 
  };
}

export function serializeTML(doc: TemplateDoc): string {
  return doc.blocks.map(b => {
    if (b.kind === 'text') return b.text;
    const body = b.tokens.map(t => {
      if (!t.randomize) return t.text;
      const morph = t.morph && t.morph !== 'base' ? `^${t.morph}` : '';
      const label = t.slotLabel ? `#${t.slotLabel}` : '';
      return `{${t.text}${morph}${label}}`;
    }).join(' ');
    return `[ ${body} ]`;
  }).join('');
}

// Re-export a tiny helper for UI hints if needed.
export const TML_MORPH_HINT = '^morph'; // e.g., {run^past#1}
