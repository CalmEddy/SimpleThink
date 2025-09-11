import { BindingSpec, TemplateToken, UnifiedTemplate, POS, MorphFeature } from '../types/index.js';

const SLOT_RE = /^\[([A-Z:]+)(\d+)?\]$/;                 // [NOUN], [VERB:past], [NOUN1]
const LIT_RE  = /^\[LIT:(.+?)\]$/;                        // [LIT:life]
const CHUNK_RE= /^\[CHUNK:\[([A-Za-z0-9:-]+)\]\]$/;        // [CHUNK:[ADJ-NOUN]]

/**
 * Parse a canonical DSL string into TemplateTokens.
 * Supported forms:
 *  - [NOUN], [VERB:past], [NOUN1], [ADJ1:comparative]
 *  - [LIT:life]
 *  - [CHUNK:[ADJ-NOUN]] (nested parse)
 */
export function parseTemplateTextToTokens(text: string): TemplateToken[] {
  // Tokenize by whitespace preserving bracketed groups.
  const parts = splitDSL(text.trim());
  const tokens: TemplateToken[] = [];

  for (const p of parts) {
    const lit = p.match(LIT_RE);
    if (lit) {
      tokens.push({ kind: 'literal', surface: lit[1], raw: p });
      continue;
    }

    const chunk = p.match(CHUNK_RE);
    if (chunk) {
      // Convert hyphen-separated pattern to bracketed slots for individual parsing
      const hyphenPattern = chunk[1]; // e.g., "ADJ-NOUN-NOUN"
      const posTags = hyphenPattern.split('-'); // e.g., ["ADJ", "NOUN", "NOUN"]
      const bracketedSlots = posTags.map(pos => `[${pos}]`).join(' '); // e.g., "[ADJ] [NOUN] [NOUN]"
      const innerTokens = parseTemplateTextToTokens(bracketedSlots);
      tokens.push({ kind: 'subtemplate', tokens: innerTokens, raw: p });
      continue;
    }

    const slot = p.match(SLOT_RE);
    if (slot) {
      const tag = slot[1];         // e.g. "VERB:past" or "NOUN"
      const num = slot[2];         // e.g. "1"
      const [posStr, morphStr] = tag.split(':') as [POS, MorphFeature?];

      tokens.push({
        kind: 'slot',
        pos: posStr as POS,
        morph: morphStr as MorphFeature | undefined,
        bindId: num ? bindIdFor(posStr as POS, num) : undefined,
        raw: p,
      });
      continue;
    }

    // If it's just bare text (rare), treat as literal
    tokens.push({ kind: 'literal', surface: p, raw: p });
  }

  return tokens;
}

export function buildBindings(tokens: TemplateToken[]): Record<string, BindingSpec> | undefined {
  const bindings: Record<string, BindingSpec> = {};
  for (const t of tokens) {
    if (t.kind === 'slot' && t.bindId) {
      if (!bindings[t.bindId]) {
        bindings[t.bindId] = { id: t.bindId, pos: t.pos, morph: t.morph };
      }
    }
    if (t.kind === 'subtemplate') {
      const inner = buildBindings(t.tokens);
      if (inner) {
        for (const k in inner) {
          if (inner.hasOwnProperty(k) && !bindings[k]) {
            bindings[k] = inner[k];
          }
        }
      }
    }
  }
  return Object.keys(bindings).length ? bindings : undefined;
}

function bindIdFor(pos: POS, n: string): string {
  const letter = pos[0].toUpperCase(); // N, V, A...
  return `${letter}${n}`;               // N1, V2, etc.
}

/** Split text like "[NOUN1] [VERB:past] [LIT:life]" into bracketed/word chunks */
function splitDSL(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === '[') {
      const j = findMatchingBracket(s, i);
      out.push(s.slice(i, j + 1));
      i = j + 1;
      while (s[i] === ' ') i++;
    } else {
      // gather until space or bracket
      let j = i;
      while (j < s.length && s[j] !== ' ' && s[j] !== '[') j++;
      out.push(s.slice(i, j));
      i = j;
      while (s[i] === ' ') i++;
    }
  }
  return out.filter(Boolean);
}

function findMatchingBracket(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '[') depth++;
    if (s[i] === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error('Unbalanced brackets in template DSL');
}
