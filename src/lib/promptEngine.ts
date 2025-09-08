import type { SemanticGraphLite } from './semanticGraphLite.js';
import type { PhraseNode, PromptNode, PromptSlotBinding, UserTemplate, SlotDescriptor, POS, SessionLocks, EphemeralPrompt, WordNode, MorphFeature, UnifiedTemplate, TemplateToken } from '../types/index.js';
import type { ContextualNodeSets } from '../contexts/ActiveNodesContext.js';
import { TEMPLATES, getRandomWordForSlot } from './templates.js';
import { surfaceRelatedPhrases } from './retrieve.js';
import { listSessionTemplates } from './sessionTemplates.js';
import { getSessionLocks } from './sessionLocks.js';
import wordBank from './templates.js';
import { tenseConverter, type MorphologicalType } from './tenseConverter.js';
import { parseTemplateTextToTokens, buildBindings } from './parseTemplateText.js';
import { realizeTemplate } from './fillTemplate.js';

export interface PromptResult {
  promptText: string;
  bindings: PromptSlotBinding[];
  promptNode: PromptNode;
}

export class PromptEngine {
  private static instance: PromptEngine;
  
  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): PromptEngine {
    if (!PromptEngine.instance) {
      PromptEngine.instance = new PromptEngine();
    }
    return PromptEngine.instance;
  }

  async buildPromptFromPhrase(
    phrase: PhraseNode, 
    template: typeof TEMPLATES[0], 
    graph: SemanticGraphLite
  ): Promise<{ promptText: string; bindings: PromptSlotBinding[] }> {
    const bindings: PromptSlotBinding[] = [];
    let promptText = template.text;

    // Try to map slots from phrase words by POS
    const phraseWords = this.getWordsFromPhrase(phrase, graph);
    const usedWords = new Set<string>();

    for (let index = 0; index < template.slots.length; index++) {
      const slot = template.slots[index];
      
      // Try to find a word in the phrase that matches this slot
      const matchingWord = phraseWords.find(word => 
        word.pos.includes(slot) && !usedWords.has(word.id)
      );

      if (matchingWord) {
        bindings.push({
          slot,
          fillerNodeId: matchingWord.id,
        });
        usedWords.add(matchingWord.id);
        
        // Handle morphological conversion
        const { basePos, morph } = this.parseMorphSpecifier(slot);
        let wordText = matchingWord.text;
        if (morph) {
          wordText = await this.convertWordToMorph(matchingWord, basePos, morph);
        }
        promptText = promptText.replace(`[${slot}]`, wordText);
      } else {
        // Try to find from related phrases
        const relatedWord = this.findWordFromRelatedPhrases(phrase, slot, graph, usedWords);
        
        if (relatedWord) {
          bindings.push({
            slot,
            fillerNodeId: relatedWord.id,
          });
          usedWords.add(relatedWord.id);
          
          // Handle morphological conversion
          const { basePos, morph } = this.parseMorphSpecifier(slot);
          let wordText = relatedWord.text;
          if (morph) {
            wordText = await this.convertWordToMorph(relatedWord, basePos, morph);
          }
          promptText = promptText.replace(`[${slot}]`, wordText);
        } else {
          // Fall back to word bank
          const fallbackWord = this.getFallbackWord(slot, graph);
          bindings.push({
            slot,
            fillerNodeId: fallbackWord.id,
          });
          
          // Handle morphological conversion
          const { basePos, morph } = this.parseMorphSpecifier(slot);
          let wordText = fallbackWord.text;
          if (morph) {
            wordText = await this.convertWordToMorph(fallbackWord, basePos, morph);
          }
          promptText = promptText.replace(`[${slot}]`, wordText);
        }
      }
    }

    return { promptText, bindings };
  }

  recordPromptAndReturnNode(
    templateId: string,
    templateText: string,
    bindings: PromptSlotBinding[],
    graph: SemanticGraphLite
  ): PromptNode {
    return graph.recordPrompt(templateId, templateText, bindings);
  }

  async createPromptFromPhrase(
    phrase: PhraseNode,
    template: typeof TEMPLATES[0],
    graph: SemanticGraphLite
  ): Promise<PromptResult> {
    const { promptText, bindings } = await this.buildPromptFromPhrase(phrase, template, graph);
    const promptNode = this.recordPromptAndReturnNode(template.id, promptText, bindings, graph);

    return {
      promptText,
      bindings,
      promptNode,
    };
  }

  private getWordsFromPhrase(phrase: PhraseNode, graph: SemanticGraphLite): any[] {
    const words: any[] = [];
    
    phrase.wordIds.forEach(wordId => {
      const word = graph.getNodesByType('WORD').find(w => w.id === wordId);
      if (word) {
        words.push(word);
      }
    });

    return words;
  }

  private findWordFromRelatedPhrases(
    phrase: PhraseNode,
    slot: string,
    graph: SemanticGraphLite,
    usedWords: Set<string>
  ): any | null {
    try {
      const { relatedPhrases } = surfaceRelatedPhrases(phrase.id, graph, { maxResults: 10 });
      
      for (const { phrase: relatedPhrase } of relatedPhrases) {
        const words = this.getWordsFromPhrase(relatedPhrase, graph);
        const matchingWord = words.find(word => 
          word.pos.includes(slot) && !usedWords.has(word.id)
        );
        
        if (matchingWord) {
          return matchingWord;
        }
      }
    } catch (error) {
      console.warn('Failed to get related phrases for word lookup:', error);
    }

    return null;
  }

  private getFallbackWord(slot: string, graph: SemanticGraphLite): any {
    // FIRST: Try word bank (controlled vocabulary)
    const wordText = getRandomWordForSlot(slot);
    const wordBankWord = graph.upsertWord(wordText, wordText.toLowerCase(), [slot]);
    
    // SECOND: Fall back to existing graph words only if word bank fails
    const existingWords = graph.getNodesByType('WORD');
    const matchingWord = existingWords.find(word => word.pos.includes(slot));
    
    return matchingWord || wordBankWord;
  }

  // Get available templates for a phrase based on its POS pattern
  getCompatibleTemplates(phrase: PhraseNode): typeof TEMPLATES {
    const phrasePos = phrase.posPattern.split('-');
    
    return TEMPLATES.filter(template => {
      // Check if template slots can be filled by phrase words
      const templateSlots = template.slots;
      
      // Simple compatibility check: if template has fewer or equal slots than phrase has words
      return templateSlots.length <= phrasePos.length;
    });
  }

  // Get suggestions for improving a prompt
  getPromptSuggestions(promptNode: PromptNode, graph: SemanticGraphLite): string[] {
    const suggestions: string[] = [];
    
    // Check if all slots are filled
    const unfilledSlots = promptNode.templateText.match(/\[([^\]]+)\]/g);
    if (unfilledSlots && unfilledSlots.length > 0) {
      suggestions.push(`Consider filling remaining slots: ${unfilledSlots.join(', ')}`);
    }

    // Check for variety in bindings
    const bindingTypes = new Set(promptNode.bindings.map(b => b.slot));
    if (bindingTypes.size < promptNode.bindings.length) {
      suggestions.push('Try using different word types for more variety');
    }

    return suggestions;
  }

  /**
   * Parse morphological specifier from slot string
   */
  parseMorphSpecifier(slot: string): { basePos: string; morph?: string } {
    if (slot.includes(':')) {
      const [basePos, morph] = slot.split(':');
      return { basePos, morph };
    }
    return { basePos: slot };
  }

  /**
   * Convert word to morphological form
   */
  async convertWordToMorph(word: WordNode, basePos: string, morph: string): Promise<string> {
    const morphType = morph as MorphologicalType;
    return await tenseConverter.convertWord(word.lemma, basePos, morphType);
  }
}

// Export singleton instance and convenience functions
export const promptEngine = PromptEngine.getInstance();

export const buildPromptFromPhrase = async (
  phrase: PhraseNode,
  template: typeof TEMPLATES[0],
  graph: SemanticGraphLite
) => await promptEngine.buildPromptFromPhrase(phrase, template, graph);

export const createPromptFromPhrase = async (
  phrase: PhraseNode,
  template: typeof TEMPLATES[0],
  graph: SemanticGraphLite
) => await promptEngine.createPromptFromPhrase(phrase, template, graph);

// NEW: Enhanced Template system functions

// Helper: build a phrase-derived unified template
function buildPhraseTemplate(sessionId: string, p: { id: string; text: string; posPattern: string }): UnifiedTemplate {
  const posTags = p.posPattern.split('-');                  // e.g., ["DET","NOUN","VERB"]
  const baseWords = tokenizeSurface(p.text);                // align by whitespace for now

  const tokens: TemplateToken[] = posTags.map((tag, i) => {
    const [posStr, morphStr] = tag.split(':') as [POS, any];
    return {
      kind: 'slot',
      pos: posStr as POS,
      morph: morphStr,
      selectionPolicy: ['LOCKED', 'CONTEXT', 'LITERAL', 'BANK'],
      fallbackLiteral: baseWords[i] ?? undefined,
      raw: `[${tag}]`,
    };
  });

  const text = `[${posTags.join(' ')}]`;
  const tpl: UnifiedTemplate = {
    id: `phrase:${p.id}`,
    text,
    tokens,
    bindings: buildBindings(tokens),
    createdInSessionId: sessionId,
    origin: 'phrase',
  };
  return tpl;
}

function tokenizeSurface(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

// Utility: convert POS pattern ("ADV-NOUN-VERB-…") to unnumbered slots
export function posPatternToSlots(pattern: string): SlotDescriptor[] {
  const parts = pattern.split('-').map(s => s.trim().toUpperCase()) as POS[];
  return parts.map((pos) => {
    return { kind: 'slot', pos };  // No auto-numbering
  });
}

// Parse template text to extract slots with proper morphological and numbering support
export function parseTemplateText(templateText: string): SlotDescriptor[] {
  const slots: SlotDescriptor[] = [];
  
  // Handle both individual slots [VERB] [ADJ] [NOUN] and dash-separated [VERB-ADJ-NOUN]
  if (templateText.includes('[') && templateText.includes(']')) {
    // Extract content between brackets
    const bracketMatch = templateText.match(/\[([^\]]+)\]/);
    if (bracketMatch) {
      const content = bracketMatch[1];
      
      // Check if it's dash-separated (like VERB:past-ADJ-NOUN)
      if (content.includes('-')) {
        const parts = content.split('-').map(s => s.trim());
        return parts.map(part => parseSlotPart(part));
      } else {
        // Single slot
        return [parseSlotPart(content)];
      }
    }
  }
  
  // Fallback: treat as space-separated individual slots
  const spaceSeparated = templateText.split(/\s+/).filter(s => s.length > 0);
  return spaceSeparated.map(part => parseSlotPart(part));
}

// Parse individual slot part (e.g., "VERB:past", "VERB1", "ADJ:comparative", "VERB1:past")
function parseSlotPart(part: string): SlotDescriptor {
  // Remove brackets if present
  const cleanPart = part.replace(/[\[\]]/g, '');
  const raw = cleanPart; // Preserve original for debugging/validation
  
  // Check for combined numbering and morphology (e.g., VERB1:past, NOUN2:plural)
  const combinedMatch = cleanPart.match(/^([A-Z]+)(\d+):(.+)$/);
  if (combinedMatch) {
    const [, pos, index, morph] = combinedMatch;
    return { 
      kind: 'slot', 
      pos: pos as POS, 
      index: parseInt(index),
      morph: morph as MorphFeature,
      raw
    };
  }
  
  // Check for numbering only (e.g., VERB1, NOUN2)
  const numberMatch = cleanPart.match(/^([A-Z]+)(\d+)$/);
  if (numberMatch) {
    const [, pos, index] = numberMatch;
    return { 
      kind: 'slot', 
      pos: pos as POS, 
      index: parseInt(index),
      raw
    };
  }
  
  // Check for morphological specifier only (e.g., VERB:past, ADJ:comparative)
  if (cleanPart.includes(':')) {
    const [basePos, morph] = cleanPart.split(':');
    return { 
      kind: 'slot', 
      pos: basePos as POS,
      morph: morph as MorphFeature,
      raw
    };
  }
  
  // Regular POS tag
  return { 
    kind: 'slot', 
    pos: cleanPart as POS,
    raw
  };
}

// Create a UserTemplate from template text input
export function createTemplateFromText(templateText: string, sessionId: string, baseText?: string): UserTemplate {
  const slots = parseTemplateText(templateText);
  const id = `custom:${Date.now()}`;
  
  return {
    id,
    text: templateText,
    slots,
    createdInSessionId: sessionId,
    baseText, // ✅ keep the original phrase text when provided
  };
}

// UPDATE getAvailableTemplates to return UnifiedTemplate[]
export function getAvailableTemplates(ctx: ContextualNodeSets, sessionId: string): UnifiedTemplate[] {
  const phraseTpls: UnifiedTemplate[] = (ctx.phrases ?? []).map((p: any) =>
    buildPhraseTemplate(sessionId, p)
  );

  // Static/User/Chunk templates: always parse through unified parser
  const userTpls = listSessionTemplates(sessionId);
  const otherTpls: UnifiedTemplate[] = (userTpls ?? []).map((t: any) => {
    const tokens = parseTemplateTextToTokens(t.text);
    const tpl: UnifiedTemplate = {
      id: t.id,
      text: t.text,
      tokens,
      bindings: buildBindings(tokens),
      createdInSessionId: sessionId,
      pinned: t.pinned,
      tags: t.tags,
      origin: t.origin ?? 'user',
    };
    return tpl;
  });

  // Add static templates from TEMPLATES
  const staticTpls: UnifiedTemplate[] = TEMPLATES.map((t: any) => {
    const tokens = parseTemplateTextToTokens(t.text);
    const tpl: UnifiedTemplate = {
      id: t.id,
      text: t.text,
      tokens,
      bindings: buildBindings(tokens),
      createdInSessionId: sessionId,
      origin: 'static',
    };
    return tpl;
  });

  // Add chunk templates
  const chunkTpls: UnifiedTemplate[] = (ctx.chunks ?? []).map((c: any) => {
    const tokens = parseTemplateTextToTokens(`[CHUNK:[${c.posPattern}]]`);
    const tpl: UnifiedTemplate = {
      id: `chunk:${c.id}`,
      text: `[CHUNK:[${c.posPattern}]]`,
      tokens,
      bindings: buildBindings(tokens),
      createdInSessionId: sessionId,
      origin: 'chunk',
    };
    return tpl;
  });

  const merged = new Map<string, UnifiedTemplate>();
  [...phraseTpls, ...otherTpls, ...staticTpls, ...chunkTpls].forEach(t => merged.set(t.id, t));
  return [...merged.values()];
}

// Random helper (seeded optional)
function mulberry32(seed: number) {
  return function() {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Helper function to parse morphological specifiers from POS tags
function parseMorphSpecifier(pos: string): { basePos: string; morph?: string } {
  if (pos.includes(':')) {
    const [basePos, morph] = pos.split(':');
    return { basePos, morph };
  }
  return { basePos: pos };
}

// --- Morph helpers ----

/**
 * Tokenize base text into words for overlay
 */
function tokenizeBaseText(s: string): string[] {
  // Keep this simple; your pipeline already aligns POS↔words on phrases.
  // If you have a better tokenizer in the codebase, use it instead.
  return s.trim().split(/\s+/);
}


/**
 * Produce a "selection view" of slots that strips morphology (base POS only)
 * plus a parallel array mapping slotIndex -> morph feature.
 * This lets us keep your existing selection logic 100% intact.
 */
function normalizeSlotsForSelection(slots: SlotDescriptor[]) {
  const selectionSlots: SlotDescriptor[] = slots.map((s) => ({
    ...s,
    // IMPORTANT: selection happens by BASE POS only
    pos: s.pos,
    // Do not pass morph to selection logic
    morph: undefined,
  }));

  const morphBySlot: (MorphFeature | null)[] = slots.map((s) => s.morph ?? null);
  return { selectionSlots, morphBySlot };
}

/**
 * Apply morphology to a single token (if requested and applicable).
 * Safe no-op if morph is null or converter can't transform.
 */
async function applyMorphIfNeeded(
  surface: string,
  lemma: string | undefined,
  basePos: string,
  morph: MorphFeature | null
): Promise<string> {
  if (!morph || morph === 'base') return surface;
  // Prefer lemma when available; fall back to surface for regular forms.
  const seed = lemma && lemma.length ? lemma : surface;
  try {
    const converted = await tenseConverter.convertWord(seed, basePos, morph as MorphologicalType);
    // Keep capitalization if the original token was capitalized (sentence start, etc.)
    if (!converted || converted === seed) return surface;

    const isCapitalized = /^[A-Z]/.test(surface);
    return isCapitalized ? converted.charAt(0).toUpperCase() + converted.slice(1) : converted;
  } catch {
    return surface;
  }
}

// Fill a single template randomly, enforcing POS, locks first, then ctx, then bank.
export async function fillTemplateSlotsRandom(
  tpl: UserTemplate,
  ctx: ContextualNodeSets,
  locks: SessionLocks,
  rng: () => number
): Promise<{ text: string; bindings: EphemeralPrompt['bindings']; templateSignature: string } | null> {
  const bindings: EphemeralPrompt['bindings'] = [];
  const renderedTokens: string[] = [];

  // Index ctx words by POS
  const wordsByPOS = new Map<POS, any[]>();
  const POS_ALL: POS[] = ['NOUN','VERB','VERB:participle','VERB:past','VERB:present_3rd','ADJ','ADJ:comparative','ADJ:superlative','ADV','ADP','DET','PRON','PROPN','AUX','CCONJ'];
  POS_ALL.forEach(pos => wordsByPOS.set(pos, ctx.words.filter(w => w.pos?.includes(pos))));
  
  const pick = <T,>(arr: T[]) => (arr.length ? arr[Math.floor(rng() * arr.length)] : undefined);

  // Only memoize explicitly numbered slots
  const chosenByKey = new Map<string, { nodeId?: string; bank?: string }>();

  // Get base words if this template came from a phrase
  const baseWords = tpl.baseText ? tokenizeBaseText(tpl.baseText) : [];
  let baseWordIndex = 0;

  // Build prompt left to right, one word at a time
  for (let i = 0; i < tpl.slots.length; i++) {
    const slot = tpl.slots[i];
    
    if (slot.kind === 'chunk') {
      // Handle chunk slots
      const locked = new Set(locks.lockedChunkIds ?? []);
      const candidates = ctx.chunks.filter(c => c.posPattern === slot.chunkPattern);
      const lockedFirst = candidates.filter(c => locked.has(c.id)).concat(candidates.filter(c => !locked.has(c.id)));
      const chosen = pick(lockedFirst);

      if (!chosen) return null;
      bindings.push({ slot, nodeId: chosen.id });
      renderedTokens.push(chosen.text);
      continue;
    }

    // Handle word slots
    const key = slot.index !== undefined ? `${slot.pos}:${slot.index}` : null;
    
    // Check if we already chose this numbered slot
    if (key && chosenByKey.has(key)) {
      const chosen = chosenByKey.get(key)!;
      bindings.push({ slot, ...chosen });
      
      // Render the previously chosen word
      if (chosen.nodeId) {
        const w = ctx.words.find(x => x.id === chosen.nodeId);
        if (w) {
          const { morph } = parseMorphSpecifier(slot.pos);
          const surface = w.lemma || w.text;
          if (morph) {
            const rendered = await applyMorphIfNeeded(surface, w.lemma, slot.pos, morph);
            renderedTokens.push(rendered);
          } else {
            renderedTokens.push(surface);
          }
        } else {
          renderedTokens.push('');
        }
      } else {
        renderedTokens.push(chosen.bank ?? '');
      }
      continue;
    }

    // For unnumbered slots with baseText, use the original phrase word
    // For numbered slots or slots without baseText, randomize
    let chosenWord: any = null;
    let chosenBank: string | undefined = undefined;

    if (slot.index == null && tpl.baseText && baseWordIndex < baseWords.length) {
      // Use original phrase word for unnumbered slots
      const baseWord = baseWords[baseWordIndex];
      baseWordIndex++;
      
      // Find a word in context that matches this base word and POS
      const { basePos } = parseMorphSpecifier(slot.pos);
      chosenWord = ctx.words.find(w => 
        w.text.toLowerCase() === baseWord.toLowerCase() && 
        w.pos?.includes(basePos)
      );
      
      // If no exact match, use the base word as-is (will be added to word bank)
      if (!chosenWord) {
        chosenBank = baseWord;
      }
    } else {
      // Randomize from context/word bank
      const lockedSet = new Set(locks.lockedWordIds ?? []);
      const { basePos } = parseMorphSpecifier(slot.pos);
      
      // 1) Try locked words first
      const lockedPool = wordsByPOS.get(basePos as POS)?.filter(w => lockedSet.has(w.id)) || [];
      chosenWord = pick(lockedPool);

      // 2) Try context words
      if (!chosenWord) {
        const candidates = ctx.words.filter(w => w.pos?.includes(basePos));
        chosenWord = pick(candidates);
      }

      // 3) Fall back to word bank
      if (!chosenWord) {
        const bank = (wordBank[basePos as POS] ?? []);
        chosenBank = pick(bank);
        if (!chosenBank) return null;
      }
    }

    // Store the choice for numbered slots
    if (key) {
      const chosen = chosenWord ? { nodeId: chosenWord.id } : { bank: chosenBank };
      chosenByKey.set(key, chosen);
    }

    // Add to bindings
    if (chosenWord) {
      bindings.push({ slot, nodeId: chosenWord.id });
    } else {
      bindings.push({ slot, bank: chosenBank });
    }

    // Render the word
    if (chosenWord) {
      const { morph } = parseMorphSpecifier(slot.pos);
      const surface = chosenWord.lemma || chosenWord.text;
      if (morph) {
        const rendered = await applyMorphIfNeeded(surface, chosenWord.lemma, slot.pos, morph);
        renderedTokens.push(rendered);
      } else {
        renderedTokens.push(surface);
      }
    } else {
      renderedTokens.push(chosenBank ?? '');
    }
  }

  const finalText = renderedTokens.join(' ').trim();
  const rendered = finalText ? finalText[0].toUpperCase() + finalText.slice(1) : '';
  const signature = tpl.slots.map(s => s.kind === 'chunk' ? (s.chunkPattern ?? '') : `${s.pos}${s.index ?? ''}`).join('-');
  return { text: rendered, bindings, templateSignature: signature };
}

// Generate multiple ephemeral prompts (no storage). Respects locked templates first.
export async function generateEphemeralPrompts(
  graph: any, // keep generic to avoid tight coupling here
  ctx: ContextualNodeSets,
  sessionId: string,
  count = 20,
  seed?: number
): Promise<EphemeralPrompt[]> {
  const rng = mulberry32(seed ?? Math.floor(Math.random() * 1e9));
  const templates = getAvailableTemplates(ctx, sessionId);
  const locks = getSessionLocks(graph, sessionId);

  // prioritize pinned or explicitly locked templates
  const hardTplIds = new Set([...(locks.lockedTemplateIds ?? [])]);
  const hard = templates.filter(t => hardTplIds.has(t.id) || t.pinned);
  const soft = templates.filter(t => !hardTplIds.has(t.id) && !t.pinned);
  const ordered = hard.concat(soft);

  const recentTexts = new Set<string>();
  const out: EphemeralPrompt[] = [];

  for (let i = 0; i < count; i++) {
    const tpl = ordered[Math.floor(rng() * ordered.length)];
    if (!tpl) break;

    // Convert to new unified template format if needed
    const unifiedTpl: UnifiedTemplate = tpl as UnifiedTemplate;
    const lockedSet = new Set([...(locks.lockedWordIds ?? [])]);
    
    const filled = await realizeTemplate({ 
      tpl: unifiedTpl, 
      ctx, 
      lockedSet, 
      wordBank: wordBank 
    });
    
    if (!filled || !filled.surface) { continue; }

    // basic dedupe: avoid identical text within this burst
    if (recentTexts.has(filled.surface)) { continue; }
    recentTexts.add(filled.surface);

    // Create bindings array for compatibility
    const bindings: EphemeralPrompt['bindings'] = [];
    const signature = unifiedTpl.tokens.map(t => 
      t.kind === 'slot' ? `${t.pos}${t.bindId || ''}` : 
      t.kind === 'subtemplate' ? 'CHUNK' : 'LITERAL'
    ).join('-');

    out.push({
      templateId: tpl.id,
      templateSignature: signature,
      text: filled.surface,
      bindings,
      randomSeed: String(seed ?? 'r' + Math.floor(Math.random() * 1e9)),
    });
  }

  return out;
}

// REPLACE any usage of fillTemplateSlotsRandom with realizeTemplate
export async function realizeOne(tpl: UnifiedTemplate, ctx: any, lockedSet: Set<string>, wordBank: Record<string, string[]>) {
  return realizeTemplate({ tpl, ctx, lockedSet, wordBank });
}