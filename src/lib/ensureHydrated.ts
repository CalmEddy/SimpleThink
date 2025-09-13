import type { TemplateDoc, TemplateBlock, PhraseBlock, POS } from '../types/index.js';
import { parseTextPatternsToUTA } from '../components/ComposerEditor.js';

/**
 * Ensures a TemplateDoc is properly hydrated with phrase tokens.
 * If the doc only has text blocks, it parses them into phrase blocks with tokens.
 */
export async function ensureHydrated(doc: TemplateDoc): Promise<TemplateDoc> {
  if (!doc || !Array.isArray(doc.blocks)) {
    return doc;
  }

  const hydratedBlocks: TemplateBlock[] = [];
  
  for (const block of doc.blocks) {
    if (block.kind === 'phrase') {
      // Already hydrated
      hydratedBlocks.push(block);
    } else if (block.kind === 'text') {
      // Need to hydrate text block into phrase block
      const textContent = (block as any).text || '';
      if (textContent.trim()) {
        try {
          // Parse the text to get tokens
          const parsed = await parseTextPatternsToUTA({
            id: doc.id,
            text: textContent,
            blocks: [block],
            createdInSessionId: doc.createdInSessionId
          });
          
          // Convert to phrase block
          if (parsed.blocks.length > 0 && parsed.blocks[0].kind === 'phrase') {
            hydratedBlocks.push(parsed.blocks[0]);
          } else {
            // Fallback: create a simple phrase block
            hydratedBlocks.push({
              kind: 'phrase',
              phraseText: textContent,
              tokens: textContent.split(/\s+/).map((word: string) => ({
                text: word,
                lemma: word.toLowerCase(),
                pos: 'NOUN' as POS,
                posSet: ['NOUN' as POS],
                randomize: false,
                slotLabel: null,
                morph: null
              }))
            } as PhraseBlock);
          }
        } catch (error) {
          console.warn('Failed to parse text block, using fallback:', error);
          // Fallback: create a simple phrase block
          hydratedBlocks.push({
            kind: 'phrase',
            phraseText: textContent,
            tokens: textContent.split(/\s+/).map((word: string) => ({
              text: word,
              lemma: word.toLowerCase(),
              pos: 'NOUN' as POS,
              posSet: ['NOUN' as POS],
              randomize: false,
              slotLabel: null,
              morph: null
            }))
          } as PhraseBlock);
        }
      }
    } else {
      // Unknown block type, keep as-is
      hydratedBlocks.push(block);
    }
  }

  return {
    ...doc,
    blocks: hydratedBlocks
  };
}
