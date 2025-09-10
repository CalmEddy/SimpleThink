import React, { useEffect, useMemo, useState } from 'react';
import type { TemplateDoc, TemplateBlock, TextBlock, PhraseBlock, PhraseToken, MorphFeature, POS, TemplateToken } from '../types';
import { parseTML, serializeTML } from '../lib/tml';
import { analyzeFreeText, resolvePhraseTokens, generateFromDocAsync } from '../lib/composer';

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

  // Get phrases from context
  const phrases = useMemo(() => {
    console.log('🔍 ComposerEditor: ctx.phrases:', ctx?.phrases);
    if (!ctx?.phrases) return [];
    return ctx.phrases;
  }, [ctx?.phrases]);

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

  // ===== Stable preview =====
  useEffect(() => {
    (async () => {
      // Parse text patterns into UTA format
      const parsedDoc = await parseTextPatternsToUTA(doc, graph);
      const s = await generateFromDocAsync(parsedDoc, { graph });
      setPreview(s);
    })();
  }, [doc, graph]);


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
      return copy;
    });
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
    setDoc(d => ({
      ...d,
      blocks: [...d.blocks, { kind: 'phrase', phraseText: p, tokens } as PhraseBlock],
    }));
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
      
      return copy;
    });
  };

  // Add a chunk to the current text block (same as phrases)
  const addChunk = async (chunk: any) => {
    // Use the chunk's actual text content, not just the POS pattern
    const chunkText = chunk.text || `[${chunk.posPattern}]`;
    const tokens = await resolvePhraseTokens(chunkText, graph);
    setDoc(d => ({
      ...d,
      blocks: [...d.blocks, { kind: 'phrase', phraseText: chunkText, tokens } as PhraseBlock],
    }));
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
        </div>
        {/* Inline composer (read-only visual) */}
        <div className="flex-1">
          <div className="mb-2 text-sm font-semibold">Inline Composer</div>
          <div className="min-h-[96px] rounded border bg-white p-3 leading-7">
            {doc.blocks.map((b, bi) =>
              b.kind === 'text' ? (
                <span key={`t-${bi}`} className="whitespace-pre-wrap">{(b as TextBlock).text}</span>
              ) : (
                <span key={`p-${bi}`} className="inline-block align-middle mx-1">{renderPhraseChip(b as PhraseBlock, bi)}</span>
              )
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
            <div>
              <div className="mb-1 text-sm font-medium">Text</div>
              <textarea
                className="w-full min-h-[72px] rounded border bg-white p-2"
                placeholder="Type literal text here…"
                value={(() => {
                  // Build complete template in raw text form
                  const templateParts: string[] = [];
                  
                  for (const block of doc.blocks) {
                    if (block.kind === 'text') {
                      // Text blocks - check if they contain patterns
                      const textBlock = block as TextBlock;
                      const text = textBlock.text;
                      
                      // Check if text contains patterns like [NOUN]
                      const patternRegex = /\[([A-Z]+(?:-[A-Z]+)*)\]/g;
                      if (patternRegex.test(text)) {
                        // Text contains patterns, add as-is
                        templateParts.push(text);
                      } else {
                        // Plain text, add as-is
                        templateParts.push(text);
                      }
                    } else if (block.kind === 'phrase') {
                      // Phrase blocks - reconstruct the raw template pattern
                      const phraseBlock = block as PhraseBlock;
                      const templatePattern = phraseBlock.tokens
                        .map(token => {
                          if (token.randomize && token.pos) {
                            // This is a slot - show as {word^morph#label}
                            const morph = token.morph && token.morph !== 'base' ? `^${token.morph}` : '';
                            const label = token.slotLabel ? `#${token.slotLabel}` : '';
                            return `{${token.text}${morph}${label}}`;
                          } else {
                            // This is literal text
                            return token.text;
                          }
                        })
                        .join(' ');
                      templateParts.push(templatePattern);
                    }
                  }
                  
                  // Join all parts and wrap in brackets if there are multiple blocks or patterns
                  const result = templateParts.join(' ');
                  return result;
                })()}
                onChange={async (e) => {
                  const text = e.target.value;
                  const analysis = await analyzeFreeText(text, graph);
                  setDoc(d => {
                    const copy = structuredClone(d);
                    if (!copy.blocks.length || copy.blocks[0].kind !== 'text') {
                      copy.blocks.unshift({ kind: 'text', text, analysis } as TextBlock);
                    } else {
                      (copy.blocks[0] as TextBlock).text = text;
                      (copy.blocks[0] as TextBlock).analysis = analysis;
                    }
                    return copy;
                  });
                }}
              />
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
            {/* Preview */}
            <div>
              <div className="text-sm font-semibold mb-1">Preview</div>
              <div className="whitespace-pre-wrap rounded border bg-white p-3">{preview}</div>
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