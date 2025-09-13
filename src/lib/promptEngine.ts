import type { SemanticGraphLite } from './semanticGraphLite.js';
import type { PhraseNode, PromptNode, PromptSlotBinding, UserTemplate, SlotDescriptor, POS, SessionLocks, EphemeralPrompt, WordNode, MorphFeature, UnifiedTemplate, TemplateToken, TemplateDoc, TemplateBlock, PhraseBlock, PhraseToken } from '../types/index.js';
import type { TemplateMutator, MutatorUtils } from './prompter/index.js';
import type { ContextualNodeSets } from '../contexts/ActiveNodesContext.js';
import { TEMPLATES, getRandomWordForSlot } from './templates.js';
import { surfaceRelatedPhrases } from './retrieve.js';
import { listSessionTemplates, listSessionTemplateDocs } from './userTemplates';
import { getSessionLocks } from './sessionLocks.js';
import { ensureDefaultProfileExists } from './sessionProfiles.js';
import wordBank from './templates.js';
import { tenseConverter, type MorphologicalType } from './tenseConverter.js';
import { parseTemplateTextToTokens, buildBindings } from './parseTemplateText.js';
import { realizeTemplate } from './fillTemplate.js';
import { Prompter, mutatorJitter30, mutatorAutoBind, mutatorEnsure2Random, mutatorRandomizeNouns, type TemplateSource, type RNG } from './prompter/index.js';
import { templateDocsFromGraph } from './prompter/unifiedSource.js';
import { parseTextPatternsToUTA } from '../components/ComposerEditor.js';
import { convertTemplateDocToUnified } from './composer.js';
import { 
  UnifiedRandomizationService, 
  RandomizationConfigManager,
  type RandomizationConfig,
  type SlotRandomizationConfig
} from './randomization/index.js';

export interface PromptResult {
  promptText: string;
  bindings: PromptSlotBinding[];
  promptNode: PromptNode;
}

export class PromptEngine {
  private static instance: PromptEngine;
  
  // Single Prompter instance for reuse
  private prompter: Prompter | null = null;
  
  // Unified randomization service
  private randomizationService: UnifiedRandomizationService;
  private configManager: RandomizationConfigManager;
  
  // Cached mutators to avoid recreation
  private cachedMutators: TemplateMutator[] | null = null;
  private lastMutatorConfig: string = "";
  
  // Track if engine has been initialized with default profile
  private initializedFromDefaultProfile: boolean = false;
  
  // Configuration for advanced mutators - loaded from default profile
  private useJitter: boolean = false;
  private jitterP: number = 30;
  private useAutoBind: boolean = false;
  private useEnsure2: boolean = false;
  private useRandNouns: boolean = false;
  private useMaxRandomization: boolean = false;
  private maxRandomSlots: number = 2;
  private usePositionBasedRandom: boolean = false;
  private targetPOS: POS = 'NOUN';
  private targetPosition: number = 1;
  private useClickableSelection: boolean = false;
  private selectedPhrase: any = null;
  private selectedWordIndices: Set<number> = new Set();
  private posRandomP: Record<POS, number> = {};
  private regexText: string = "";
  private regexRandomizeP: number = 0;
  
  private constructor() {
    // Initialize POS randomization probabilities
    const ALL_POS: POS[] = [
      "NOUN", "VERB", "ADJ", "ADV", "DET", "PRON", "ADP", "AUX", "CONJ", "SCONJ", "PART", "NUM", "INTJ", "PROPN"
    ] as const as POS[];
    this.posRandomP = ALL_POS.reduce((acc, pos) => (acc[pos] = 0, acc), {} as Record<POS, number>);
    
    // Initialize unified randomization service
    this.configManager = RandomizationConfigManager.getInstance();
    this.randomizationService = null as any; // Will be initialized in loadFromDefaultProfile
  }

  static getInstance(): PromptEngine {
    if (!PromptEngine.instance) {
      PromptEngine.instance = new PromptEngine();
    }
    return PromptEngine.instance;
  }

  /**
   * Load configuration from the default profile
   */
  async loadFromDefaultProfile(sessionId: string): Promise<void> {
    try {
      const defaultProfile = ensureDefaultProfileExists(sessionId);
      
      // Load mutator settings from default profile
      this.useJitter = defaultProfile.useJitter;
      this.jitterP = defaultProfile.jitterP;
      this.useAutoBind = defaultProfile.useAutoBind;
      this.useEnsure2 = defaultProfile.useEnsure2;
      this.useRandNouns = defaultProfile.useRandNouns;
      this.useMaxRandomization = defaultProfile.useMaxRandomization;
      this.maxRandomSlots = defaultProfile.maxRandomSlots;
      this.usePositionBasedRandom = defaultProfile.usePositionBasedRandom;
      this.targetPOS = defaultProfile.targetPOS;
      this.targetPosition = defaultProfile.targetPosition;
      this.useClickableSelection = defaultProfile.useClickableSelection;
      this.selectedPhrase = defaultProfile.selectedPhraseId ? { id: defaultProfile.selectedPhraseId } : null;
      this.selectedWordIndices = new Set(defaultProfile.selectedWordIndices);
      this.posRandomP = { ...defaultProfile.posRandomP };
      this.regexText = defaultProfile.regexText;
      this.regexRandomizeP = defaultProfile.regexRandomizeP;
      
      // Update unified randomization service configuration
      this.configManager.loadFromProfile(defaultProfile);
      this.randomizationService = await this.configManager.createService();
      
      // Clear cached mutators to force rebuild with new settings
      this.cachedMutators = null;
      this.lastMutatorConfig = "";
    } catch (error) {
      console.warn('Failed to load default profile, using fallback settings:', error);
      // Keep current settings (which are initialized to false/empty)
    }
  }

  /**
   * Update mutator configuration (used by dev panel)
   */
  updateMutatorConfig(config: {
    useJitter?: boolean;
    jitterP?: number;
    useAutoBind?: boolean;
    useEnsure2?: boolean;
    useRandNouns?: boolean;
    useMaxRandomization?: boolean;
    maxRandomSlots?: number;
    usePositionBasedRandom?: boolean;
    targetPOS?: POS;
    targetPosition?: number;
    useClickableSelection?: boolean;
    selectedPhrase?: any;
    selectedWordIndices?: Set<number>;
    posRandomP?: Record<POS, number>;
    regexText?: string;
    regexRandomizeP?: number;
  }): void {
    if (config.useJitter !== undefined) this.useJitter = config.useJitter;
    if (config.jitterP !== undefined) this.jitterP = config.jitterP;
    if (config.useAutoBind !== undefined) this.useAutoBind = config.useAutoBind;
    if (config.useEnsure2 !== undefined) this.useEnsure2 = config.useEnsure2;
    if (config.useRandNouns !== undefined) this.useRandNouns = config.useRandNouns;
    if (config.useMaxRandomization !== undefined) this.useMaxRandomization = config.useMaxRandomization;
    if (config.maxRandomSlots !== undefined) this.maxRandomSlots = config.maxRandomSlots;
    if (config.usePositionBasedRandom !== undefined) this.usePositionBasedRandom = config.usePositionBasedRandom;
    if (config.targetPOS !== undefined) this.targetPOS = config.targetPOS;
    if (config.targetPosition !== undefined) this.targetPosition = config.targetPosition;
    if (config.useClickableSelection !== undefined) this.useClickableSelection = config.useClickableSelection;
    if (config.selectedPhrase !== undefined) this.selectedPhrase = config.selectedPhrase;
    if (config.selectedWordIndices !== undefined) this.selectedWordIndices = config.selectedWordIndices;
    if (config.posRandomP !== undefined) this.posRandomP = { ...config.posRandomP };
    if (config.regexText !== undefined) this.regexText = config.regexText;
    if (config.regexRandomizeP !== undefined) this.regexRandomizeP = config.regexRandomizeP;
    
    // Update unified randomization service with new configuration
    this.updateRandomizationServiceConfig();
    
    // Clear cached mutators to force rebuild with new settings
    this.cachedMutators = null;
    this.lastMutatorConfig = "";
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
          const fallbackWord = await this.getFallbackWord(slot, graph);
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

  private async getFallbackWord(slot: string, graph: SemanticGraphLite): Promise<any> {
    // FIRST: Try word bank (controlled vocabulary)
    const wordText = await getRandomWordForSlot(slot);
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

  /**
   * Initialize or update the single Prompter instance
   */
  private initializePrompter(activeSource: TemplateDoc[], configurableMutators: TemplateMutator[], rng?: RNG): void {
    if (!this.prompter) {
      // Create new instance
      this.prompter = new Prompter({
        source: activeSource,
        rng: rng as any,
        mutators: configurableMutators,
      });
    } else {
      // Update existing instance configuration
      this.prompter.updateConfig({
        source: activeSource,
        rng: rng as any,
        mutators: configurableMutators,
      });
    }
  }

  // ===== NEW ENHANCED TEMPLATE BUILDING SYSTEM =====

  /**
   * Build a TemplateDoc from a phrase node (moved from PrompterDevPanel)
   */
  buildDocFromPhraseNode(ph: any): TemplateDoc {
    const words = this.tokenizeSurfaceWords(String(ph.text));
    const pos = String(ph.posPattern).split("-").map((p) => p.trim()).filter(Boolean);
    const len = Math.max(words.length, pos.length);
    const tokens = Array.from({ length: len }).map((_, i) => {
      const w = words[i] ?? "";
      const p = (pos[i] ?? (pos[pos.length - 1] ?? "NOUN")) as POS;
      return {
        text: w || `[${p}]`,
        lemma: "",
        pos: p,
        posSet: [p],
        randomize: false,
        slotLabel: null,
        morph: null,
      } as PhraseToken;
    });
    return {
      id: ph.id ?? `locked_phrase_${Date.now()}`,
      createdInSessionId: "promptengine",
      blocks: [{
        kind: "phrase",
        phraseText: String(ph.text),
        tokens
      } as PhraseBlock]
    };
  }

  /**
   * Build a TemplateDoc from a chunk node (moved from PrompterDevPanel)
   */
  buildDocFromChunkNode(ch: any): TemplateDoc {
    const words = this.tokenizeSurfaceWords(String(ch.text));
    const pos = String(ch.posPattern).split("-").map((p) => p.trim()).filter(Boolean);
    const len = Math.max(words.length, pos.length);
    const tokens = Array.from({ length: len }).map((_, i) => {
      const w = words[i] ?? "";
      const p = (pos[i] ?? (pos[pos.length - 1] ?? "NOUN")) as POS;
      return {
        text: w || `[${p}]`,
        lemma: "",
        pos: p,
        posSet: [p],
        randomize: false,
        slotLabel: null,
        morph: null,
      } as PhraseToken;
    });
    return {
      id: ch.id ?? `locked_chunk_${Date.now()}`,
      createdInSessionId: "promptengine",
      blocks: [{
        kind: "phrase",
        phraseText: String(ch.text),
        tokens
      } as PhraseBlock]
    };
  }

  /**
   * Simple tokenization that preserves word order
   */
  private tokenizeSurfaceWords(s: string): string[] {
    return s.trim().split(/\s+/);
  }

  /**
   * Build active source from contextual nodes (moved from PrompterDevPanel)
   */
  buildActiveSource(activeCtx: ContextualNodeSets, lockedDoc?: TemplateDoc, lockedTemplateId?: string, sessionId?: string, templateMixRatio = 0.5): TemplateSource {
    return async () => {
      if (lockedDoc) return [lockedDoc];
      
      // If we have a locked template ID, find and return only that template
      if (lockedTemplateId) {
        // Look for the locked template in phrases and chunks
        for (const ph of (activeCtx?.phrases ?? [])) {
          if (ph.id === lockedTemplateId) {
            const doc = this.buildDocFromPhraseNode(ph);
            return [doc];
          }
        }
        for (const ch of (activeCtx?.chunks ?? [])) {
          if (ch.id === lockedTemplateId) {
            const doc = this.buildDocFromChunkNode(ch);
            return [doc];
          }
        }
        // If locked template not found, return empty array
        return [];
      }
      
      const out: TemplateDoc[] = [];

      // Get user templates if sessionId is provided
      let userTemplates: TemplateDoc[] = [];
      if (sessionId) {
        userTemplates = listSessionTemplateDocs(sessionId);
      }

      // Use ALL available templates - let the randomization pipeline cycle through them
      // to achieve the requested count, rather than limiting the pool size
      
      // 1) Add ALL user templates
      if (userTemplates.length > 0) {
        const shuffledUserTemplates = [...userTemplates].sort(() => this.randomizationService?.pickFromArray([-1, 1]) ?? 0);
        out.push(...shuffledUserTemplates);
      }

      // 2) Add ALL phrase-derived docs
      if (activeCtx?.phrases && activeCtx.phrases.length > 0) {
        const shuffledPhrases = [...activeCtx.phrases].sort(() => this.randomizationService?.pickFromArray([-1, 1]) ?? 0);
        for (const phrase of shuffledPhrases) {
          const doc = this.buildDocFromPhraseNode(phrase);
          out.push(doc);
        }
      }

      // 3) Add ALL chunk-derived docs
      if (activeCtx?.chunks && activeCtx.chunks.length > 0) {
        const shuffledChunks = [...activeCtx.chunks].sort(() => this.randomizationService?.pickFromArray([-1, 1]) ?? 0);
        for (const chunk of shuffledChunks) {
          const doc = this.buildDocFromChunkNode(chunk);
          out.push(doc);
        }
      }

      return out;
    };
  }


  /**
   * Build configurable mutators system (moved from PrompterDevPanel) with caching
   */
  buildConfigurableMutators(): TemplateMutator[] {
    // Create a config signature to check if mutators need to be rebuilt
    const configSignature = JSON.stringify({
      useJitter: this.useJitter,
      jitterP: this.jitterP,
      useAutoBind: this.useAutoBind,
      useEnsure2: this.useEnsure2,
      useRandNouns: this.useRandNouns,
      useMaxRandomization: this.useMaxRandomization,
      maxRandomSlots: this.maxRandomSlots,
      usePositionBasedRandom: this.usePositionBasedRandom,
      targetPOS: this.targetPOS,
      targetPosition: this.targetPosition,
      useClickableSelection: this.useClickableSelection,
      regexText: this.regexText,
      regexRandomizeP: this.regexRandomizeP
    });

    // Return cached mutators if configuration hasn't changed
    if (this.cachedMutators && this.lastMutatorConfig === configSignature) {
      return this.cachedMutators;
    }

    const result: TemplateMutator[] = [];

    if (this.useJitter) {
      const p = Math.max(0, Math.min(100, this.jitterP)) / 100;
      result.push(function jitterScaled(doc, utils) {
        return utils.jitterSlots(doc, p);
      });
    }
    if (this.useAutoBind) result.push(mutatorAutoBind);
    if (this.useEnsure2) result.push(mutatorEnsure2Random);
    if (this.useRandNouns) result.push(mutatorRandomizeNouns);

    // Advanced slot randomization mutators
    if (this.useMaxRandomization) {
      result.push((doc) => {
        const blocks = doc.blocks.map((b: TemplateBlock) => {
          if (b.kind !== "phrase") return b;
          const pb = b as PhraseBlock;
          const randomizableTokens = pb.tokens
            .map((t, i) => ({ token: t, index: i }))
            .filter(({ token }) => /[A-Za-z]/.test(token.text) && !token.randomize);
          
          const toRandomize = Math.min(this.maxRandomSlots, randomizableTokens.length);
          const selected = new Set<number>();
          while (selected.size < toRandomize && selected.size < randomizableTokens.length) {
            const randomIndex = Math.floor((this.randomizationService?.pickFromArray([0, 1]) ?? 0) * randomizableTokens.length);
            selected.add(randomizableTokens[randomIndex].index);
          }
          
          const tokens = pb.tokens.map((t, i) => 
            selected.has(i) ? { ...t, randomize: true } : t
          );
          return { ...pb, tokens } as PhraseBlock;
        });
        return { ...doc, blocks };
      });
    }

    if (this.usePositionBasedRandom) {
      result.push((doc) => {
        const blocks = doc.blocks.map((b: TemplateBlock) => {
          if (b.kind !== "phrase") return b;
          const pb = b as PhraseBlock;
          
          const matchingTokens = pb.tokens
            .map((t, i) => ({ token: t, index: i }))
            .filter(({ token }) => 
              token.pos === this.targetPOS || (token.posSet && token.posSet.includes(this.targetPOS))
            );
          
          if (matchingTokens.length >= this.targetPosition) {
            const targetIndex = matchingTokens[this.targetPosition - 1].index;
            const tokens = pb.tokens.map((t, i) => 
              i === targetIndex ? { ...t, randomize: true } : t
            );
            return { ...pb, tokens } as PhraseBlock;
          }
          
          return pb;
        });
        return { ...doc, blocks };
      });
    }

    if (this.useClickableSelection && this.selectedPhrase && this.selectedWordIndices.size > 0) {
      result.push((doc) => {
        const blocks = doc.blocks.map((b: TemplateBlock) => {
          if (b.kind !== "phrase") return b;
          const pb = b as PhraseBlock;
          
          if (pb.phraseText !== this.selectedPhrase.text) return pb;
          
          const tokens = pb.tokens.map((t, i) => 
            this.selectedWordIndices.has(i) ? { ...t, randomize: true } : t
          );
          return { ...pb, tokens } as PhraseBlock;
        });
        return { ...doc, blocks };
      });
    }

    // POS-based randomization mutator
    const anyPOS = Object.values(this.posRandomP).some(p => p > 0);
    if (anyPOS) {
      result.push((doc) => {
        const blocks = doc.blocks.map((b: TemplateBlock) => {
          if (b.kind !== "phrase") return b;
          const pb = b as PhraseBlock;
          const tokens = pb.tokens.map((t: PhraseToken) => {
            const candidates: POS[] = t.pos ? [t.pos] : (t.posSet ?? []);
            const maxP = candidates.reduce((m, pos) => Math.max(m, (this.posRandomP[pos as POS] ?? 0) / 100), 0);
            if (maxP > 0 && /[A-Za-z]/.test(t.text)) {
              if ((this.randomizationService?.pickFromArray([0, 1]) ?? 0) < maxP) return { ...t, randomize: true };
            }
            return t;
          });
          return { ...pb, tokens } as PhraseBlock;
        });
        return { ...doc, blocks };
      });
    }

    // Regex-based randomization mutator
    if (this.regexText.trim().length > 0 && this.regexRandomizeP > 0) {
      let re: RegExp | null = null;
      try { re = new RegExp(this.regexText, "i"); } catch { re = null; }
      if (re) {
        const p = Math.max(0, Math.min(100, this.regexRandomizeP)) / 100;
        result.push((doc) => {
          const blocks = doc.blocks.map((b: TemplateBlock) => {
            if (b.kind !== "phrase") return b;
            const pb = b as PhraseBlock;
            if (!re!.test(pb.phraseText)) return pb;
            const tokens = pb.tokens.map((t: PhraseToken) => {
              if (/[A-Za-z]/.test(t.text) && (this.randomizationService?.pickFromArray([0, 1]) ?? 0) < p) return { ...t, randomize: true };
              return t;
            });
            return { ...pb, tokens } as PhraseBlock;
          });
          return { ...doc, blocks };
        });
      }
    }

    // Cache the result and config signature
    this.cachedMutators = result;
    this.lastMutatorConfig = configSignature;

    return result;
  }

  // ===== CONFIGURATION METHODS =====

  /**
   * Get randomization logs for debugging
   */
  getRandomizationLogs(): any[] {
    if (!this.randomizationService) {
      return [];
    }
    return this.randomizationService.getLogs();
  }

  /**
   * Clear randomization logs
   */
  clearRandomizationLogs(): void {
    if (!this.randomizationService) {
      return;
    }
    this.randomizationService.clearLogs();
  }

  /**
   * Update the unified randomization service configuration
   */
  private updateRandomizationServiceConfig(): void {
    // Only update if the randomization service has been initialized
    if (!this.randomizationService) {
      return;
    }

    const slotConfig: SlotRandomizationConfig = {
      jitterP: this.jitterP / 100,
      posRandomP: this.posRandomP,
      maxRandomSlots: this.maxRandomSlots,
      usePositionBasedRandom: this.usePositionBasedRandom,
      targetPOS: this.targetPOS,
      targetPosition: this.targetPosition,
      useClickableSelection: this.useClickableSelection,
      selectedWordIndices: this.selectedWordIndices,
      regexText: this.regexText,
      regexRandomizeP: this.regexRandomizeP
    };

    // Update the randomization service configuration
    this.randomizationService.updateConfig({
      enableLogging: true // Enable logging for debugging
    });
  }

  /**
   * Configure mutator settings
   */
  configureMutators(config: {
    useJitter?: boolean;
    jitterP?: number;
    useAutoBind?: boolean;
    useEnsure2?: boolean;
    useRandNouns?: boolean;
    useMaxRandomization?: boolean;
    maxRandomSlots?: number;
    usePositionBasedRandom?: boolean;
    targetPOS?: POS;
    targetPosition?: number;
    useClickableSelection?: boolean;
    selectedPhrase?: any;
    selectedWordIndices?: Set<number>;
    posRandomP?: Record<POS, number>;
    regexText?: string;
    regexRandomizeP?: number;
  }) {
    if (config.useJitter !== undefined) this.useJitter = config.useJitter;
    if (config.jitterP !== undefined) this.jitterP = config.jitterP;
    if (config.useAutoBind !== undefined) this.useAutoBind = config.useAutoBind;
    if (config.useEnsure2 !== undefined) this.useEnsure2 = config.useEnsure2;
    if (config.useRandNouns !== undefined) this.useRandNouns = config.useRandNouns;
    if (config.useMaxRandomization !== undefined) this.useMaxRandomization = config.useMaxRandomization;
    if (config.maxRandomSlots !== undefined) this.maxRandomSlots = config.maxRandomSlots;
    if (config.usePositionBasedRandom !== undefined) this.usePositionBasedRandom = config.usePositionBasedRandom;
    if (config.targetPOS !== undefined) this.targetPOS = config.targetPOS;
    if (config.targetPosition !== undefined) this.targetPosition = config.targetPosition;
    if (config.useClickableSelection !== undefined) this.useClickableSelection = config.useClickableSelection;
    if (config.selectedPhrase !== undefined) this.selectedPhrase = config.selectedPhrase;
    if (config.selectedWordIndices !== undefined) this.selectedWordIndices = config.selectedWordIndices;
    if (config.posRandomP !== undefined) this.posRandomP = config.posRandomP;
    if (config.regexText !== undefined) this.regexText = config.regexText;
    if (config.regexRandomizeP !== undefined) this.regexRandomizeP = config.regexRandomizeP;
    
    // Clear cache when configuration changes
    this.cachedMutators = null;
    this.lastMutatorConfig = "";
  }

  // ===== ENHANCED GENERATION METHODS =====

  /**
   * Generate prompt using the enhanced Prompter system
   */
  async generateEnhancedPrompt(
    activeCtx: ContextualNodeSets,
    graph: SemanticGraphLite,
    sessionId: string,
    rng?: RNG,
    lockedDoc?: TemplateDoc,
    lockedTemplateId?: string,
    templateMixRatio = 0.5
  ): Promise<{ prompt: string; templateId: string; templateText: string; debug: any }> {
    // Initialize from default profile only once
    if (!this.initializedFromDefaultProfile) {
      this.loadFromDefaultProfile(sessionId);
      this.initializedFromDefaultProfile = true;
    }
    
    const activeSource = this.buildActiveSource(activeCtx, lockedDoc, lockedTemplateId, sessionId, templateMixRatio);
    const configurableMutators = this.buildConfigurableMutators();
    
    // Initialize or update the single Prompter instance
    this.initializePrompter(activeSource as TemplateDoc[], configurableMutators, rng);

    const res = await this.prompter!.generate({
      graph,
      ctxOverride: {
        words: activeCtx?.words ?? [],
        phrases: activeCtx?.phrases ?? []
      }
    });

    return res;
  }

  /**
   * Generate multiple ephemeral prompts using the enhanced system
   */
  async generateEphemeralPromptsEnhanced(
    graph: SemanticGraphLite,
    activeCtx: ContextualNodeSets,
    sessionId: string,
    count = 20,
    seed?: number,
    templateMixRatio = 0.5
  ): Promise<EphemeralPrompt[]> {
    // Use the unified randomization service for consistent RNG
    const rng = seed ? { next: () => this.randomizationService?.pickFromArray([0, 1]) ?? 0 } : undefined;
    const out: EphemeralPrompt[] = [];
    const recentTexts = new Set<string>();
    
    // Infinite loop protection
    const maxAttempts = count * 10; // Allow up to 10x attempts to find unique prompts
    let attempts = 0;
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = 50; // Stop if we can't generate new prompts after 50 attempts

    for (let i = 0; i < count && attempts < maxAttempts && consecutiveFailures < maxConsecutiveFailures; i++) {
      attempts++;
      
      try {
        const res = await this.generateEnhancedPrompt(activeCtx, graph, sessionId, rng, undefined, undefined, templateMixRatio);
        
        // Check for duplicates, but retry instead of skipping
        if (recentTexts.has(res.prompt)) {
          consecutiveFailures++;
          i--; // Decrement i to retry this iteration
          continue;
        }
        
        // Reset consecutive failures counter on successful generation
        consecutiveFailures = 0;
        recentTexts.add(res.prompt);

        // Generate random seed using unified service
        const randomSeed = seed ? String(seed) : 'r' + Math.floor((this.randomizationService?.pickFromArray([0, 1]) ?? 0) * 1e9);

        out.push({
          templateId: res.templateId,
          templateSignature: 'ENHANCED-GENERATED',
          text: res.prompt,
          bindings: [], // Prompter doesn't provide detailed bindings yet
          randomSeed,
        });
      } catch (error) {
        console.warn('Enhanced prompt generation failed:', error);
        consecutiveFailures++;
        i--; // Decrement i to retry this iteration
      }
    }

    // Log warning if we couldn't generate the requested number of unique prompts
    if (out.length < count) {
      console.warn(`Generated ${out.length} prompts instead of requested ${count}. This may be due to limited template variety or word availability.`);
    }

    return out;
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


// Generate multiple ephemeral prompts (no storage). Now uses enhanced system by default.
export async function generateEphemeralPrompts(
  graph: any, // keep generic to avoid tight coupling here
  ctx: ContextualNodeSets,
  sessionId: string,
  count = 20,
  seed?: number
): Promise<EphemeralPrompt[]> {
  // Use the enhanced system by default
  return await promptEngine.generateEphemeralPromptsEnhanced(graph, ctx, sessionId, count, seed);
}


/**
 * 🚫 If anyone adds a new export here that calls realizeTemplate directly,
 * throw loudly so the test suite and manual runs fail fast.
 */
export function __FORBID_DIRECT_REALIZE_TEMPLATE__(): never {
  throw new Error(
    "Direct realizeTemplate usage from promptEngine is forbidden. Use Prompter (UTA) instead."
  );
}