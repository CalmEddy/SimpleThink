import type { SemanticGraphLite } from './semanticGraphLite.js';
import type { PhraseNode, PromptNode, PromptSlotBinding, UserTemplate, SlotDescriptor, POS, SessionLocks, EphemeralPrompt } from '../types/index.js';
import type { ContextualNodeSets } from '../contexts/ActiveNodesContext.js';
import { TEMPLATES, getRandomWordForSlot } from './templates.js';
import { surfaceRelatedPhrases } from './retrieve.js';
import { listSessionTemplates } from './sessionTemplates.js';
import { getSessionLocks } from './sessionLocks.js';
import wordBank from './templates.js';

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

  buildPromptFromPhrase(
    phrase: PhraseNode, 
    template: typeof TEMPLATES[0], 
    graph: SemanticGraphLite
  ): { promptText: string; bindings: PromptSlotBinding[] } {
    const bindings: PromptSlotBinding[] = [];
    let promptText = template.text;

    // Try to map slots from phrase words by POS
    const phraseWords = this.getWordsFromPhrase(phrase, graph);
    const usedWords = new Set<string>();

    template.slots.forEach((slot, index) => {
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
        promptText = promptText.replace(`[${slot}]`, matchingWord.text);
      } else {
        // Try to find from related phrases
        const relatedWord = this.findWordFromRelatedPhrases(phrase, slot, graph, usedWords);
        
        if (relatedWord) {
          bindings.push({
            slot,
            fillerNodeId: relatedWord.id,
          });
          usedWords.add(relatedWord.id);
          promptText = promptText.replace(`[${slot}]`, relatedWord.text);
        } else {
          // Fall back to word bank
          const fallbackWord = this.getFallbackWord(slot, graph);
          bindings.push({
            slot,
            fillerNodeId: fallbackWord.id,
          });
          promptText = promptText.replace(`[${slot}]`, fallbackWord.text);
        }
      }
    });

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

  createPromptFromPhrase(
    phrase: PhraseNode,
    template: typeof TEMPLATES[0],
    graph: SemanticGraphLite
  ): PromptResult {
    const { promptText, bindings } = this.buildPromptFromPhrase(phrase, template, graph);
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
    // Try to find existing word in graph first
    const existingWords = graph.getNodesByType('WORD');
    const matchingWord = existingWords.find(word => word.pos.includes(slot));
    
    if (matchingWord) {
      return matchingWord;
    }

    // Create new word from word bank
    const wordText = getRandomWordForSlot(slot);
    return graph.upsertWord(wordText, wordText.toLowerCase(), [slot]);
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
}

// Export singleton instance and convenience functions
export const promptEngine = PromptEngine.getInstance();

export const buildPromptFromPhrase = (
  phrase: PhraseNode,
  template: typeof TEMPLATES[0],
  graph: SemanticGraphLite
) => promptEngine.buildPromptFromPhrase(phrase, template, graph);

export const createPromptFromPhrase = (
  phrase: PhraseNode,
  template: typeof TEMPLATES[0],
  graph: SemanticGraphLite
) => promptEngine.createPromptFromPhrase(phrase, template, graph);

// NEW: Enhanced Template system functions

// Utility: convert POS pattern ("ADV-NOUN-VERB-…") to unnumbered slots
export function posPatternToSlots(pattern: string): SlotDescriptor[] {
  const parts = pattern.split('-').map(s => s.trim().toUpperCase()) as POS[];
  return parts.map((pos) => {
    return { kind: 'slot', pos };  // No auto-numbering
  });
}

// Build available templates: context phrases -> POS templates, context chunks -> chunk templates, plus user session templates
export function getAvailableTemplates(ctx: ContextualNodeSets, sessionId: string): UserTemplate[] {
  const userTpls = listSessionTemplates(sessionId);
  const phraseTpls: UserTemplate[] = ctx.phrases.map(p => ({
    id: `phrase:${p.id}`,
    text: `[${p.posPattern.replace(/-/g, ' ')}]`,
    slots: posPatternToSlots(p.posPattern),
    source: 'phrase',
    createdInSessionId: sessionId,
    baseText: p.text,  // Add base text for phrase templates
  }));
  const chunkTpls: UserTemplate[] = ctx.chunks.map(c => ({
    id: `chunk:${c.id}`,
    text: `[${c.posPattern}]`,
    slots: [{ kind: 'chunk', pos: 'NOUN', chunkPattern: c.posPattern }],
    source: 'chunk',
    createdInSessionId: sessionId,
  }));
  const merged = new Map<string, UserTemplate>();
  [...phraseTpls, ...chunkTpls, ...userTpls].forEach(t => merged.set(t.id, t));
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

// Fill a single template randomly, enforcing POS, locks first, then ctx, then bank.
export function fillTemplateSlotsRandom(
  tpl: UserTemplate,
  ctx: ContextualNodeSets,
  locks: SessionLocks,
  rng: () => number
): { text: string; bindings: EphemeralPrompt['bindings']; templateSignature: string } | null {
  const bindings: EphemeralPrompt['bindings'] = [];
  
  // Get base text if this is a phrase template
  let baseWords: string[] = [];
  if (tpl.source === 'phrase' && tpl.baseText) {
    baseWords = tpl.baseText.split(/\s+/);
  }

  // Index ctx words by POS
  const wordsByPOS = new Map<POS, any[]>();
  const POS_ALL: POS[] = ['NOUN','VERB','VERB:participle','VERB:past','VERB:present_3rd','ADJ','ADJ:comparative','ADJ:superlative','ADV','ADP','DET','PRON','PROPN','AUX'];
  POS_ALL.forEach(pos => wordsByPOS.set(pos, ctx.words.filter(w => w.pos?.includes(pos))));

  const pick = <T,>(arr: T[]) => (arr.length ? arr[Math.floor(rng() * arr.length)] : undefined);

  // Only memoize explicitly numbered slots
  const chosenByKey = new Map<string, { nodeId?: string; bank?: string }>();

  for (let i = 0; i < tpl.slots.length; i++) {
    const slot = tpl.slots[i];
    
    if (slot.kind === 'chunk') {
      // Handle chunk slots (unchanged)
      const locked = new Set(locks.lockedChunkIds ?? []);
      const candidates = ctx.chunks.filter(c => c.posPattern === slot.chunkPattern);
      const lockedFirst = candidates.filter(c => locked.has(c.id)).concat(candidates.filter(c => !locked.has(c.id)));
      const chosen = pick(lockedFirst);
      if (!chosen) return null;
      bindings.push({ slot, nodeId: chosen.id });
      continue;
    }

    // Handle word slots
    const key = slot.index !== undefined ? `${slot.pos}:${slot.index}` : null;
    
    // Check if we already chose this numbered slot
    if (key && chosenByKey.has(key)) {
      bindings.push({ slot, ...chosenByKey.get(key)! });
      continue;
    }

    // For unnumbered slots, try base text first
    if (slot.index === undefined && baseWords.length > i) {
      const baseWord = baseWords[i];
      
      // Try to find word with matching morphological feature
      const { basePos, morph } = parseMorphSpecifier(slot.pos);
      if (morph) {
        const morphWord = ctx.words.find(w => 
          w.lemma === baseWord && w.morphFeature === morph
        );
        if (morphWord) {
          bindings.push({ slot, nodeId: morphWord.id });
          continue;
        }
      }
      
      // Fall back to regular base word
      bindings.push({ slot, nodeId: 'base', bank: baseWord });
      continue;
    }

    // For numbered slots or when no base text available, randomize
    const lockedSet = new Set(locks.lockedWordIds ?? []);

    // Enhanced word finding with morphological matching
    const findWordByMorph = (pos: string) => {
      const { basePos, morph } = parseMorphSpecifier(pos);
      
      if (morph) {
        // Try to find word with matching morphological feature
        const morphWord = ctx.words.find(w => 
          w.pos?.includes(basePos) && w.morphFeature === morph
        );
        if (morphWord) return morphWord;
      }
      
      // Fall back to regular matching
      return ctx.words.find(w => w.pos?.includes(basePos));
    };

    // 1) Try locked words first
    const lockedPool = wordsByPOS.get(slot.pos)!.filter(w => lockedSet.has(w.id));
    let chosenWord = pick(lockedPool);

    // 2) Try context words with morphological matching
    if (!chosenWord) {
      const morphWord = findWordByMorph(slot.pos);
      if (morphWord) {
        chosenWord = morphWord;
      } else {
        // Fall back to regular context words
        const ctxPool = wordsByPOS.get(slot.pos)!;
        chosenWord = pick(ctxPool);
      }
    }

    // 3) Fall back to word bank
    if (!chosenWord) {
      const bank = (wordBank[slot.pos] ?? []);
      const chosenLemma = pick(bank);
      if (!chosenLemma) return null;
      const chosen = { bank: chosenLemma };
      if (key) chosenByKey.set(key, chosen);
      bindings.push({ slot, ...chosen });
      continue;
    }

    const chosen = { nodeId: chosenWord.id };
    if (key) chosenByKey.set(key, chosen);
    bindings.push({ slot, ...chosen });
  }

  // Render final text
  const out = bindings.map(b => {
    if (b.slot.kind === 'chunk') {
      const ch = ctx.chunks.find(x => x.id === b.nodeId);
      return ch?.text ?? '';
    }
    if (b.nodeId === 'base') {
      return b.bank ?? '';
    }
    if (b.nodeId) {
      const w = ctx.words.find(x => x.id === b.nodeId);
      return w?.lemma ?? '';
    }
    return b.bank ?? '';
  }).join(' ').trim();

  const rendered = out ? out[0].toUpperCase() + out.slice(1) : '';
  const signature = tpl.slots.map(s => s.kind === 'chunk' ? (s.chunkPattern ?? '') : `${s.pos}${s.index ?? ''}`).join('-');
  return { text: rendered, bindings, templateSignature: signature };
}

// Generate multiple ephemeral prompts (no storage). Respects locked templates first.
export function generateEphemeralPrompts(
  graph: any, // keep generic to avoid tight coupling here
  ctx: ContextualNodeSets,
  sessionId: string,
  count = 20,
  seed?: number
): EphemeralPrompt[] {
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

    const filled = fillTemplateSlotsRandom(tpl, ctx, locks, rng);
    if (!filled) { continue; }

    // basic dedupe: avoid identical text within this burst
    if (recentTexts.has(filled.text)) { continue; }
    recentTexts.add(filled.text);

    out.push({
      templateId: tpl.id,
      templateSignature: filled.templateSignature,
      text: filled.text,
      bindings: filled.bindings,
      randomSeed: String(seed ?? 'r' + Math.floor(Math.random() * 1e9)),
    });
  }

  return out;
}
