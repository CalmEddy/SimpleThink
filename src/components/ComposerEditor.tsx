import React, { useEffect, useMemo, useState } from 'react';
import type { TemplateDoc, TemplateBlock, TextBlock, PhraseBlock, PhraseToken, MorphFeature, POS, TemplateToken } from '../types';
import { parseTML, serializeTML } from '../lib/tml';
import { analyzeFreeText, resolvePhraseTokens, generateFromDocAsync, convertTemplateDocToUnified } from '../lib/composer';
import { realizeTemplate } from '../lib/fillTemplate';
import { wordBank } from '../lib/templates';
import { parseTemplateTextToTokens } from '../lib/parseTemplateText';
import { addSessionTemplate, saveAllTemplates, loadTemplatesFromFile, listSessionTemplates, removeSessionTemplate, updateSessionTemplate } from '../lib/userTemplates.js';

type MorphMenuState = {
  open: boolean;
  x: number;
  y: number;
  blockIndex: number;
  tokenIndex: number;
} | null;

interface Props {
  sessionId: string;
  graph?: any;
  ctx?: {
    words: any[];
    chunks: any[];
    phrases: any[];
  };
}

const POS_CHIPS: POS[] = [
  'NOUN', 
  'VERB', 
  'ADJ', 
  'ADV', 
  'ADP', 
  'DET', 
  'PRON', 
  'PROPN', 
  'AUX'
];

// NOTE: Do not "optimize" this back to the legacy behavior.
// Detect if input is template DSL or free text
const isTemplateDSL = (text: string): boolean => {
  // Check for template patterns like [NOUN], [VERB], [CHUNK:[...]], etc.
  return /\[[A-Za-z0-9:]+(?:-[A-Za-z0-9:]+)*\]/.test(text);
};

// Convert TemplateDoc to template text string for unified parsing
export const convertTemplateDocToText = (doc: TemplateDoc): string => {
  const parts: string[] = [];
  
  for (const block of doc.blocks) {
    if (block.kind === 'text') {
      const textBlock = block as TextBlock;
      if (textBlock.text.trim()) {
        parts.push(textBlock.text);
      }
    } else if (block.kind === 'phrase') {
      const phraseBlock = block as PhraseBlock;
      const posPattern = phraseBlock.tokens
        .filter(token => token.randomize && token.pos)
        .map(token => token.pos)
        .join('-');

      if (posPattern && phraseBlock.tokens.length > 1) {
        parts.push(`[CHUNK:[${posPattern}]]`);
      } else {
        const templatePattern = phraseBlock.tokens
          .map(token => {
            if (token.randomize && token.pos) {
              const morph = token.morph && token.morph !== 'base' ? `:${token.morph}` : '';
              const label = token.slotLabel ? `#${token.slotLabel}` : '';
              return `[${token.pos}${morph}${label}]`;
            } else {
              return token.text;
            }
          })
          .join(' ');
        parts.push(templatePattern);
      }
    }
  }
  
  return parts.join(' ');
};

// This parser must hydrate slot tokens with POS (and optional bind/morph)
// and must FLATTEN multi-POS patterns (e.g., [NOUN-VERB]) into real tokens.
export const parseTextPatternsToUTA = async (doc: TemplateDoc, graph: any): Promise<TemplateDoc> => {
  const parsedBlocks: TemplateBlock[] = [];

  for (const block of doc.blocks) {
    if (block.kind === 'text') {
      const textBlock = block as TextBlock;
      const text = textBlock.text;

      // Match bracketed patterns, including digits (bind ids) and morphs via colon.
      // Examples accepted:
      //  [NOUN-VERB-NOUN]
      //  [DET] [NOUN] [NOUN2]
      //  [VERB:participle] [ADJ] [PROPN1]
      const patternRegex = /\[([A-Za-z0-9:]+(?:-[A-Za-z0-9:]+)*)\]/g;
      const hasPatterns = patternRegex.test(text);

      if (hasPatterns) {
        // Reset regex for parsing
        patternRegex.lastIndex = 0;
        const tplTokens: TemplateToken[] = [];
        let lastIndex = 0;
        let match;

        while ((match = patternRegex.exec(text)) !== null) {
          // Add literal text before the pattern
          if (match.index > lastIndex) {
            const literalText = text.slice(lastIndex, match.index).trim();
            if (literalText) {
              tplTokens.push({
                kind: 'literal',
                surface: literalText
              });
            }
          }

          // Parse the pattern
          const pattern = match[1];
          const posTags = pattern.split('-');

          if (posTags.length === 1) {
            // Single POS slot like [NOUN]
            const raw = posTags[0];
            const m = /^([A-Za-z]+)(\d+)?(?::([A-Za-z]+))?$/u.exec(raw);
            const base = (m?.[1] ?? 'NOUN').toUpperCase();
            const bind = m?.[2];
            const morph = m?.[3]?.toLowerCase();
            // Special shorthand: allow lone "participle" -> VERB:participle
            const pos = base === 'PARTICIPLE' ? 'VERB' : base;
            tplTokens.push({
              kind: 'slot',
              pos: pos as any,
              morph: morph as any,
              bindId: bind
            });
          } else {
            // Multi-POS chunk like [VERB-DET-NOUN]
            // Keep original hyphen joiner by inserting literal '-' between slots.
            const chunkTokens: TemplateToken[] = [];
            posTags.forEach((raw, idx) => {
              const m = /^([A-Za-z]+)(\d+)?(?::([A-Za-z]+))?$/u.exec(raw);
              const base = (m?.[1] ?? 'NOUN').toUpperCase();
              const bind = m?.[2];
              const morph = m?.[3]?.toLowerCase();
              const pos = base === 'PARTICIPLE' ? 'VERB' : base;
              chunkTokens.push({
                kind: 'slot',
                pos: pos as any,
                morph: morph as any,
                bindId: bind
              });
              if (idx < posTags.length - 1) {
                chunkTokens.push({
                  kind: 'literal',
                  surface: '-'  // preserve hyphen joiner
                });
              }
            });
            // FLATTEN the chunk into the outer token stream (no opaque subtemplate)
            tplTokens.push(...chunkTokens);
          }

          lastIndex = match.index + match[0].length;
        }

        // Add remaining literal text
        if (lastIndex < text.length) {
          const literalText = text.slice(lastIndex).trim();
          if (literalText) {
            tplTokens.push({
              kind: 'literal',
              surface: literalText
            });
          }
        }

        // Create ONLY a phrase block with parsed tokens (no text block)
        if (tplTokens.length > 0) {
          // Map template tokens to PhraseBlock tokens with POS fully hydrated.
          const phraseTokens = tplTokens.flatMap((t) => {
            if (t.kind === 'literal') {
              return [{
                text: t.surface,
                randomize: false,
                slotLabel: null,
                lemma: t.surface,
                morph: null
              } as PhraseToken];
            }
            // Slot token → randomized phrase token with POS (and optional bind/morph)
            return [{
              text: `[${t.pos}]`,
              lemma: '',
              pos: (t.pos as any),
              posSet: [t.pos as any],
              randomize: true,
              slotLabel: (t as any).bindId ?? null,
              morph: (t as any).morph ?? null
            } as PhraseToken];
          });

          parsedBlocks.push({
            kind: 'phrase',
            phraseText: text,
            tokens: phraseTokens
          } as PhraseBlock);
        }
      } else {
        // No patterns, keep as text block
        parsedBlocks.push(block);
      }
    } else {
      // Keep other blocks as-is
      parsedBlocks.push(block);
    }
  }

  return {
    ...doc,
    blocks: parsedBlocks
  };
};

export default function ComposerEditor({ sessionId, graph, ctx }: Props) {
  const [doc, setDoc] = useState<TemplateDoc>(() => ({
    id: `doc_${sessionId}`,
    blocks: [{ kind: 'text', text: '' }] as TemplateBlock[],
    createdInSessionId: sessionId,
  }));
  const [preview, setPreview] = useState<string>('');
  const [morphMenu, setMorphMenu] = useState<MorphMenuState>(null);
  const [rawTextMode, setRawTextMode] = useState<boolean>(false);
  const [rawText, setRawText] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [userTemplates, setUserTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Get phrases from context
  const phrases = useMemo(() => {
    console.log('🔍 ComposerEditor: ctx.phrases:', ctx?.phrases);
    if (!ctx?.phrases) return [];
    return ctx.phrases;
  }, [ctx?.phrases]);

  // Load user templates on component mount
  useEffect(() => {
    const templates = listSessionTemplates(sessionId);
    setUserTemplates(templates);
  }, [sessionId]);

  // Load a template into the composer
  const loadTemplateIntoComposer = async (template: any) => {
    try {
      setSelectedTemplateId(template.id);
      
      // Convert UnifiedTemplate to TemplateDoc
      const templateText = template.text;
      
      // Parse the template text to create blocks
      if (isTemplateDSL(templateText)) {
        // Parse as template DSL
        const parsed = parseTemplateTextToTokens(templateText);
        const blocks: TemplateBlock[] = [];
        
        // Convert tokens to blocks
        for (const token of parsed) {
          if (token.kind === 'literal') {
            blocks.push({
              kind: 'text',
              text: token.surface
            });
          } else if (token.kind === 'slot') {
            blocks.push({
              kind: 'text',
              text: `[${token.pos}]`
            });
          }
        }
        
        setDoc({
          id: template.id,
          blocks: blocks,
          createdInSessionId: sessionId
        });
      } else {
        // Parse as free text
        const blocks: TemplateBlock[] = [{
          kind: 'text',
          text: templateText
        }];
        
        setDoc({
          id: template.id,
          blocks: blocks,
          createdInSessionId: sessionId
        });
      }
      
      // Update preview
      setPreview(templateText);
    } catch (error) {
      console.error('Failed to load template:', error);
      alert('Failed to load template. Check console for details.');
    }
  };

  // Save current composer state back to template
  const saveCurrentTemplate = async () => {
    if (!selectedTemplateId) {
      alert('No template selected to save');
      return;
    }

    try {
      const currentText = convertTemplateDocToText(doc);
      await updateSessionTemplate(sessionId, selectedTemplateId, {
        text: currentText
      });
      
      // Refresh templates list
      const templates = listSessionTemplates(sessionId);
      setUserTemplates(templates);
      
      alert('Template saved successfully!');
    } catch (error) {
      console.error('Failed to save template:', error);
      alert('Failed to save template. Check console for details.');
    }
  };

  // Delete a template
  const deleteTemplate = async (templateId: string) => {
    if (!confirm('Are you sure you want to delete this template?')) {
      return;
    }

    try {
      await removeSessionTemplate(sessionId, templateId);
      
      // Refresh templates list
      const templates = listSessionTemplates(sessionId);
      setUserTemplates(templates);
      
      // Clear selection if deleted template was selected
      if (selectedTemplateId === templateId) {
        setSelectedTemplateId(null);
      }
      
      alert('Template deleted successfully!');
    } catch (error) {
      console.error('Failed to delete template:', error);
      alert('Failed to delete template. Check console for details.');
    }
  };

  // Get unique chunks from context, filtered by pattern
  const chunks = useMemo(() => {
    console.log('🔍 ComposerEditor: ctx.chunks:', ctx?.chunks);
    if (!ctx?.chunks) return [];
    // Filter to show only unique patterns
    const uniqueChunks = new Map();
    ctx.chunks.forEach(chunk => {
      if (!uniqueChunks.has(chunk.posPattern)) {
        uniqueChunks.set(chunk.posPattern, chunk);
      }
    });
    const result = Array.from(uniqueChunks.values());
    console.log('🔍 ComposerEditor: unique chunks:', result);
    return result;
  }, [ctx?.chunks]);

  // ===== Generate function for raw text mode =====
  const generatePreview = async () => {
    if (!rawText.trim()) {
      setPreview('');
      return;
    }

    setIsGenerating(true);
    try {
      // Create a temporary doc with the raw text
      const tempDoc: TemplateDoc = {
        id: `temp_${Date.now()}`,
        blocks: [{ kind: 'text', text: rawText }],
        createdInSessionId: sessionId
      };

      // Route to appropriate parser based on input type
      if (isTemplateDSL(rawText)) {
        // Template DSL: use parseTemplateTextToTokens
        const tokens = parseTemplateTextToTokens(rawText);
        const unifiedTemplate = { tokens };
        const result = await realizeTemplate({
          tpl: unifiedTemplate,
          ctx: { 
            words: graph?.getNodesByType('WORD') || [], 
            phrases: graph?.getNodesByType('PHRASE') || [] 
          },
          lockedSet: new Set(),
          wordBank: { ...wordBank, ...(ctx?.words ? {} : {}) }
        });
        setPreview(result.surface);
      } else {
        // Free text: use analyzeFreeText and generateFromDocAsync
        const analysis = await analyzeFreeText(rawText, graph);
        const s = await generateFromDocAsync(analysis, { graph });
        setPreview(s);
      }
    } catch (error) {
      console.error('Error generating preview:', error);
      setPreview('Error generating preview');
    } finally {
      setIsGenerating(false);
    }
  };

  // ===== Stable preview (only for non-raw-text mode) =====
  useEffect(() => {
    if (rawTextMode) return; // Don't auto-generate in raw text mode
    
    (async () => {
      // Use original parseTextPatternsToUTA pipeline for TemplateDoc
      const parsedDoc = await parseTextPatternsToUTA(doc, graph);
      const unifiedTemplate = convertTemplateDocToUnified(parsedDoc);
      const result = await realizeTemplate({
        tpl: unifiedTemplate,
        ctx: { 
          words: graph?.getNodesByType('WORD') || [], 
          phrases: graph?.getNodesByType('PHRASE') || [] 
        },
        lockedSet: new Set(),
        wordBank: { ...wordBank, ...(ctx?.words ? {} : {}) }
      });
      setPreview(result.surface);
    })();
  }, [doc, graph, rawTextMode]);

  // Update text editor when doc changes (but not in raw text mode)
  useEffect(() => {
    if (!rawTextMode) {
      updateTextEditorFromDoc(doc);
    }
  }, [doc, rawTextMode]);


  // === Token interactions (stable)
  const onTokenClick = (bi: number, ti: number, e: React.MouseEvent) => {
    setDoc(d => {
      const copy = structuredClone(d);
      const block = copy.blocks[bi] as PhraseBlock;
      const tok = block.tokens[ti];
      if (e.shiftKey) {
        // Cycle label: 1 -> 2 -> 3 -> off
        const order = [null, '1', '2', '3'] as const;
        const idx = Math.max(0, order.indexOf((tok.slotLabel as any) ?? null));
        const next = order[(idx + 1) % order.length];
        tok.slotLabel = next as any;
        // Auto-enable randomize when labeling
        tok.randomize = tok.randomize ?? true;
      } else {
        tok.randomize = !tok.randomize;
      }
      
      // Update the text editor to reflect changes
      updateTextEditorFromDoc(copy);
      
      return copy;
    });
  };

  // Update text editor to show current template syntax
  const updateTextEditorFromDoc = (doc: TemplateDoc) => {
    const templateParts: string[] = [];
    
    for (const block of doc.blocks) {
      if (block.kind === 'text') {
        const textBlock = block as TextBlock;
        if (textBlock.text.trim()) {
          templateParts.push(textBlock.text);
        }
      } else if (block.kind === 'phrase') {
        const phraseBlock = block as PhraseBlock;
        
        // Check if this is a chunk (has posPattern that looks like ADJ-NOUN-NOUN)
        const posPattern = phraseBlock.tokens
          .filter(token => token.randomize && token.pos)
          .map(token => token.pos)
          .join('-');
        
        if (posPattern && phraseBlock.tokens.length > 1) {
          // This is a chunk - show as [CHUNK:[POS-POS-POS]]
          templateParts.push(`[CHUNK:[${posPattern}]]`);
        } else {
          // This is a regular phrase - convert to template syntax
          const templatePattern = phraseBlock.tokens
            .map(token => {
              if (token.randomize && token.pos) {
                const morph = token.morph && token.morph !== 'base' ? `:${token.morph}` : '';
                const label = token.slotLabel ? `#${token.slotLabel}` : '';
                return `[${token.pos}${morph}${label}]`;
              } else {
                return token.text;
              }
            })
            .join(' ');
          templateParts.push(templatePattern);
        }
      }
    }
    
    const templateText = templateParts.join(' ');
    // Update the raw text if we're in raw text mode
    if (rawTextMode) {
      setRawText(templateText);
    }
  };

  const onTokenContextMenu = (bi: number, ti: number, e: React.MouseEvent) => {
    e.preventDefault();
    setMorphMenu({ open: true, x: e.clientX, y: e.clientY, blockIndex: bi, tokenIndex: ti });
  };

  const applyMorph = (feat: MorphFeature | 'clear') => {
    if (!morphMenu) return;
    setDoc(d => {
      const copy = structuredClone(d);
      const pb = copy.blocks[morphMenu.blockIndex] as PhraseBlock;
      const tok = pb.tokens[morphMenu.tokenIndex];
      tok.morph = feat === 'clear' ? null : feat;
      // If user sets morph, ensure randomize is on so conversion applies.
      tok.randomize = tok.randomize ?? true;
      return copy;
    });
    setMorphMenu(null);
  };

  // ==== Render tokens inside phrase chip ====
  const renderPhraseChip = (b: PhraseBlock, bi: number) => {
    return (
      <span className="inline-flex items-center gap-1 rounded-2xl bg-slate-100 px-2 py-1 shadow-sm border border-slate-200">
        {b.tokens.map((t, ti) => {
          const randomized = !!t.randomize;
          const hasMorph = !!t.morph && t.morph !== 'base';
          return (
            <span
              key={ti}
              onClick={(e) => onTokenClick(bi, ti, e)}
              onContextMenu={(e) => onTokenContextMenu(bi, ti, e)}
              title={tokenTitle(t)}
              className={[
                'cursor-pointer rounded px-1 py-0.5',
                randomized ? 'bg-amber-100 ring-1 ring-amber-300' : 'hover:bg-slate-200',
              ].join(' ')}
            >
              {t.text}
              {t.slotLabel ? <sup className="ml-0.5 text-[10px] text-slate-500">{t.slotLabel}</sup> : null}
              {hasMorph ? <sup className="ml-0.5 text-[10px] text-indigo-600">{t.morph}</sup> : null}
            </span>
          );
        })}
      </span>
    );
  };

  const tokenTitle = (t: PhraseToken) => {
    const pos = t.pos ? `pos=${t.pos}` : '';
    const set = t.posSet?.length ? ` posSet=[${t.posSet.join(',')}]` : '';
    const morph = t.morph ? ` morph=${t.morph}` : '';
    return `${t.text} ${pos}${set}${morph}`.trim();
  };

  // Append a phrase from tray (stable: add after current content)
  const addTrayPhrase = async (p: string) => {
    const tokens = await resolvePhraseTokens(p, graph);
    setDoc(d => {
      const newDoc = {
        ...d,
        blocks: [...d.blocks, { kind: 'phrase', phraseText: p, tokens } as PhraseBlock],
      };
      // Update the text editor to reflect changes
      updateTextEditorFromDoc(newDoc);
      return newDoc;
    });
  };

  // Add a POS slot to the current text block
  const addPOSSlot = (pos: POS) => {
    setDoc(d => {
      const copy = structuredClone(d);
      // Ensure we have a text block
      if (!copy.blocks.length || copy.blocks[0].kind !== 'text') {
        copy.blocks.unshift({ kind: 'text', text: '' } as TextBlock);
      }
      
      const textBlock = copy.blocks[0] as TextBlock;
      // Add the POS slot to the text
      const slotText = `[${pos}]`;
      textBlock.text = textBlock.text + (textBlock.text ? ' ' : '') + slotText;
      
      // Re-analyze the text to update the analysis
      analyzeFreeText(textBlock.text, graph).then(analysis => {
        textBlock.analysis = analysis;
      });
      
      // Update the text editor to reflect changes
      updateTextEditorFromDoc(copy);
      
      return copy;
    });
  };

  // Add a chunk to the current text block (same as phrases)
  const addChunk = async (chunk: any) => {
    // Use the chunk's actual text content, not just the POS pattern
    const chunkText = chunk.text || `[${chunk.posPattern}]`;
    const tokens = await resolvePhraseTokens(chunkText, graph);
    
    // Mark all tokens as randomize to ensure they're treated as slots
    const chunkTokens = tokens.map(token => ({
      ...token,
      randomize: true
    }));
    
    setDoc(d => {
      const newDoc = {
        ...d,
        blocks: [...d.blocks, { kind: 'phrase', phraseText: chunkText, tokens: chunkTokens } as PhraseBlock],
      };
      // Update the text editor to reflect changes
      updateTextEditorFromDoc(newDoc);
      return newDoc;
    });
  };


  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4">
        {/* Tray */}
        <div className="w-64 shrink-0">
          <div className="mb-2 text-sm font-semibold">Phrases</div>
          <div className="max-h-48 overflow-y-auto space-y-2 mb-4">
            {phrases.length > 0 ? (
              phrases.map((phrase, idx) => (
                <button
                  key={idx}
                  className="text-left rounded border bg-white px-2 py-1 hover:bg-slate-50 w-full"
                  onClick={() => addTrayPhrase(phrase.text)}
                  title={phrase.text}
                >
                  <div className="font-medium text-sm">{phrase.text}</div>
                  <div className="text-xs text-gray-500 mt-1">POS: {phrase.posPattern}</div>
                </button>
              ))
            ) : (
              <div className="text-sm text-gray-500 italic">No phrases available</div>
            )}
          </div>
          
          <div className="mb-2 text-sm font-semibold">Chunks</div>
          <div className="max-h-48 overflow-y-auto space-y-2">
            {chunks.length > 0 ? (
              chunks.map((chunk, idx) => (
                <button
                  key={idx}
                  className="text-left rounded border bg-white px-2 py-1 hover:bg-slate-50 w-full"
                  onClick={() => addChunk(chunk)}
                  title={chunk.text}
                >
                  <div className="font-medium text-sm">{chunk.posPattern}</div>
                  <div className="text-xs text-gray-500 truncate">{chunk.text}</div>
                </button>
              ))
            ) : (
              <div className="text-sm text-gray-500 italic">No chunks available</div>
            )}
          </div>
          
          {/* User Templates */}
          <div className="mb-2 text-sm font-semibold mt-6">User Templates</div>
          <div className="max-h-48 overflow-y-auto space-y-2">
            {userTemplates.length > 0 ? (
              userTemplates.map((template, idx) => (
                <div
                  key={template.id}
                  className={`text-left rounded border px-2 py-1 w-full ${
                    selectedTemplateId === template.id 
                      ? 'bg-blue-100 border-blue-300' 
                      : 'bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <button
                      className="flex-1 text-left"
                      onClick={() => loadTemplateIntoComposer(template)}
                      title={template.text}
                    >
                      <div className="font-medium text-sm truncate">{template.text}</div>
                      {template.tags && template.tags.length > 0 && (
                        <div className="text-xs text-gray-500 mt-1">
                          Tags: {template.tags.join(', ')}
                        </div>
                      )}
                    </button>
                    <button
                      className="ml-2 text-red-500 hover:text-red-700 p-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteTemplate(template.id);
                      }}
                      title="Delete template"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-500 italic">No user templates yet</div>
            )}
          </div>
          
          {/* Template Actions */}
          {selectedTemplateId && (
            <div className="mt-3 pt-3 border-t">
              <div className="text-xs text-gray-600 mb-2">Template Actions:</div>
              <button
                className="w-full px-3 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                onClick={saveCurrentTemplate}
              >
                💾 Save Changes
              </button>
            </div>
          )}
        </div>
        {/* Inline composer (always shows preview) */}
        <div className="flex-1">
          <div className="mb-2 text-sm font-semibold">Inline Composer</div>
          <div className="min-h-[96px] rounded border bg-white p-3 leading-7">
            {rawTextMode ? (
              // In raw text mode, show the preview from generation
              <div className="text-gray-700">
                {preview || 'Enter template pattern and click Generate Preview'}
              </div>
            ) : (
              // In interactive mode, show phrase chips for all blocks
              doc.blocks.map((b, bi) => {
                if (b.kind === 'text') {
                  const textBlock = b as TextBlock;
                  // Parse text blocks to show as phrase chips
                  if (textBlock.text.trim()) {
                    return (
                      <span key={`t-${bi}`} className="inline-block align-middle mx-1">
                        <span className="inline-flex items-center gap-1 rounded-2xl bg-blue-100 px-2 py-1 shadow-sm border border-blue-200">
                          <span className="text-blue-800 font-medium">{textBlock.text}</span>
                        </span>
                      </span>
                    );
                  }
                  return null;
                } else {
                  return (
                    <span key={`p-${bi}`} className="inline-block align-middle mx-1">
                      {renderPhraseChip(b as PhraseBlock, bi)}
                    </span>
                  );
                }
              })
            )}
          </div>
          {/* POS Chips */}
          <div className="mt-3">
            <div className="mb-2 text-sm font-medium">Add POS Slots</div>
            <div className="flex flex-wrap gap-2">
              {POS_CHIPS.map(pos => (
                <button
                  key={pos}
                  className="px-3 py-1 rounded-full border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors text-sm font-medium"
                  onClick={() => addPOSSlot(pos)}
                >
                  + {pos}
                </button>
              ))}
            </div>
          </div>

          {/* Controls */}
          <div className="mt-3 flex flex-col gap-3">
            {/* Mode Toggle */}
            <div className="flex items-center gap-2">
              <button
                className={`px-3 py-1 rounded text-sm font-medium ${
                  !rawTextMode 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
                onClick={() => setRawTextMode(false)}
              >
                Interactive Mode
              </button>
              <button
                className={`px-3 py-1 rounded text-sm font-medium ${
                  rawTextMode 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
                onClick={() => setRawTextMode(true)}
              >
                Raw Text Mode
              </button>
            </div>

            {/* Text Input */}
            <div>
              <div className="mb-1 text-sm font-medium">
                {rawTextMode ? 'Raw Template Text' : 'Text'}
              </div>
              {rawTextMode ? (
                <div className="space-y-2">
                  <textarea
                    className="w-full min-h-[72px] rounded border bg-white p-2 font-mono text-sm"
                    placeholder="Type template pattern here, e.g., [NOUN] [VERB] [CHUNK:[DET-ADJ-NOUN]] [ADV]"
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                      onClick={generatePreview}
                      disabled={isGenerating || !rawText.trim()}
                    >
                      {isGenerating ? 'Generating...' : 'Generate Preview'}
                    </button>
                    <button
                      className="px-3 py-2 bg-gray-200 text-gray-700 rounded text-sm font-medium hover:bg-gray-300"
                      onClick={() => {
                        setRawText('');
                        setPreview('');
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="text-xs text-gray-600 space-y-1">
                    <div><strong>Supported patterns:</strong></div>
                    <div>• Basic slots: <code className="bg-gray-100 px-1 rounded">[NOUN] [VERB] [ADJ]</code></div>
                    <div>• Nested chunks: <code className="bg-gray-100 px-1 rounded">[CHUNK:[DET-ADJ-NOUN]]</code></div>
                    <div>• Morphology: <code className="bg-gray-100 px-1 rounded">[VERB:past] [ADJ:comparative]</code></div>
                    <div>• Mixed: <code className="bg-gray-100 px-1 rounded">[NOUN] [VERB] [CHUNK:[DET-ADJ-NOUN]] [ADV]</code></div>
                  </div>
                </div>
              ) : (
                <textarea
                  className="w-full min-h-[72px] rounded border bg-white p-2 font-mono text-sm"
                  placeholder="Template will appear here as you build it..."
                  value={(() => {
                    // Build template syntax from doc blocks (same logic as updateTextEditorFromDoc)
                    const templateParts: string[] = [];
                    
                    for (const block of doc.blocks) {
                      if (block.kind === 'text') {
                        const textBlock = block as TextBlock;
                        if (textBlock.text.trim()) {
                          templateParts.push(textBlock.text);
                        }
                      } else if (block.kind === 'phrase') {
                        const phraseBlock = block as PhraseBlock;
                        
                        // Check if this is a chunk (has posPattern that looks like ADJ-NOUN-NOUN)
                        const posPattern = phraseBlock.tokens
                          .filter(token => token.randomize && token.pos)
                          .map(token => token.pos)
                          .join('-');
                        
                        if (posPattern && phraseBlock.tokens.length > 1) {
                          // This is a chunk - show as [CHUNK:[POS-POS-POS]]
                          templateParts.push(`[CHUNK:[${posPattern}]]`);
                        } else {
                          // This is a regular phrase - convert to template syntax
                          const templatePattern = phraseBlock.tokens
                            .map(token => {
                              if (token.randomize && token.pos) {
                                const morph = token.morph && token.morph !== 'base' ? `:${token.morph}` : '';
                                const label = token.slotLabel ? `#${token.slotLabel}` : '';
                                return `[${token.pos}${morph}${label}]`;
                              } else {
                                return token.text;
                              }
                            })
                            .join(' ');
                          templateParts.push(templatePattern);
                        }
                      }
                    }
                    
                    return templateParts.join(' ');
                  })()}
                  readOnly
                />
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="rounded bg-slate-900 text-white px-3 py-1 text-sm"
                onClick={() => {
                  const tml = serializeTML(doc);
                  navigator.clipboard.writeText(tml);
                }}
              >
                Copy .tml
              </button>
              <button
                className="rounded border px-3 py-1 text-sm"
                onClick={async () => {
                  const tml = prompt('Paste .tml');
                  if (!tml) return;
                  const parsed = parseTML(tml, sessionId);
                  // Resolve tokens for any new phrase blocks
                  const resolvedBlocks: TemplateBlock[] = [];
                  for (const b of parsed.blocks) {
                    if (b.kind === 'phrase') {
                      const pb = b as PhraseBlock;
                      const tokens = await resolvePhraseTokens(pb.tokens.map(t => t.text).join(' '), graph);
                      // merge randomize/slotLabel/morph from parsed tokens (align by order)
                      pb.tokens = pb.tokens.map((t, i) => ({
                        ...tokens[i],
                        randomize: t.randomize,
                        slotLabel: t.slotLabel ?? null,
                        morph: t.morph ?? null,
                      }));
                      resolvedBlocks.push(pb);
                    } else {
                      const tb = b as TextBlock;
                      tb.analysis = await analyzeFreeText(tb.text, graph);
                      resolvedBlocks.push(tb);
                    }
                  }
                  setDoc(d => ({ ...parsed, blocks: resolvedBlocks, createdInSessionId: d.createdInSessionId || parsed.createdInSessionId }));
                }}
              >
                Import .tml
              </button>
            </div>
            
            {/* File Operations */}
            <div className="border-t pt-3 mt-3">
              <div className="text-sm font-semibold mb-2">Template File Operations</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="rounded bg-blue-600 text-white px-3 py-1 text-xs flex items-center justify-center gap-1"
                  onClick={async () => {
                    try {
                      const templateText = convertTemplateDocToText(doc);
                      await addSessionTemplate(sessionId, {
                        text: templateText,
                        pinned: false,
                        tags: ['composer'],
                        origin: 'user'
                      });
                      
                      // Refresh templates list
                      const templates = listSessionTemplates(sessionId);
                      setUserTemplates(templates);
                      
                      alert('Template saved to session successfully!');
                    } catch (error) {
                      console.error('Failed to save template:', error);
                      alert('Failed to save template to session. Check console for details.');
                    }
                  }}
                >
                  💾 Save to Session
                </button>
                
                <button
                  className="rounded border border-blue-600 text-blue-600 px-3 py-1 text-xs flex items-center justify-center gap-1"
                  onClick={async () => {
                    try {
                      await saveAllTemplates();
                      alert('All templates saved to file successfully!');
                    } catch (error) {
                      console.error('Failed to save all templates:', error);
                      alert('Failed to save all templates to file. Check console for details.');
                    }
                  }}
                >
                  💾 Save
                </button>
                
                <button
                  className="rounded border border-green-600 text-green-600 px-3 py-1 text-xs flex items-center justify-center gap-1"
                  onClick={async () => {
                    try {
                      await loadTemplatesFromFile();
                      alert('Templates loaded from file successfully!');
                      // Refresh the templates list
                      setUserTemplates(listSessionTemplates(sessionId));
                    } catch (error) {
                      console.error('Failed to load templates:', error);
                      alert('Failed to load templates from file. Check console for details.');
                    }
                  }}
                >
                  📂 Load
                </button>
              </div>
              <div className="text-xs text-gray-600 mt-2">
                <div>• <strong>Save to Session:</strong> Add current template to session templates</div>
                <div>• <strong>Save:</strong> Save all templates from all sessions to file</div>
                <div>• <strong>Load:</strong> Load templates from file and merge with existing</div>
              </div>
            </div>
            {/* Preview */}
            <div>
              <div className="text-sm font-semibold mb-1">
                Preview
                {rawTextMode && (
                  <span className="text-xs text-gray-500 ml-2">
                    (Raw Text Mode - Click Generate to update)
                  </span>
                )}
              </div>
              <div className="whitespace-pre-wrap rounded border bg-white p-3 min-h-[60px]">
                {preview || (rawTextMode ? 'Enter template pattern and click Generate Preview' : 'No preview available')}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Morph Menu */}
      {morphMenu?.open ? (
        <div
          className="fixed z-50 rounded-md border bg-white shadow-lg p-1"
          style={{ left: morphMenu.x, top: morphMenu.y }}
          onMouseLeave={() => setMorphMenu(null)}
        >
          <MorphMenuContent
            token={(doc.blocks[morphMenu.blockIndex] as PhraseBlock).tokens[morphMenu.tokenIndex]}
            onPick={applyMorph}
          />
        </div>
      ) : null}
    </div>
  );
}

function MorphMenuContent({ token, onPick }: { token: PhraseToken; onPick: (m: MorphFeature | 'clear') => void }) {
  const base = token.pos?.split(':')[0] ?? 'NOUN';
  const opts: MorphFeature[] = ['base'];
  const posSet = new Set([base, ...(token.posSet ?? []).map(p => p.split(':')[0])]);
  if (posSet.has('VERB')) opts.push('past', 'participle', 'present_3rd');
  if (posSet.has('ADJ')) opts.push('comparative', 'superlative');
  if (posSet.has('NOUN')) opts.push('plural');
  return (
    <div className="flex flex-col">
      {opts.map(o => (
        <button
          key={o}
          className="text-left px-2 py-1 hover:bg-slate-100 rounded"
          onClick={() => onPick(o === 'base' ? 'clear' : o)}
        >
          {o === 'base' ? 'Clear morph' : o}
        </button>
      ))}
    </div>
  );
}