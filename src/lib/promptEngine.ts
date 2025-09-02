import type { SemanticGraphLite } from './semanticGraphLite.js';
import type { PhraseNode, PromptNode, PromptSlotBinding } from '../types/index.js';
import { TEMPLATES, getRandomWordForSlot, getWordsForSlot } from './templates.js';
import { surfaceRelatedPhrases } from './retrieve.js';

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
