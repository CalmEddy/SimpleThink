import React, { useEffect, useMemo, useState } from 'react';
import type { TemplateDoc, TemplateBlock, TextBlock, PhraseBlock, PhraseToken, MorphFeature } from '../types';
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
}

export default function ComposerEditor({ sessionId, graph }: Props) {
  const [doc, setDoc] = useState<TemplateDoc>(() => ({
    id: `doc_${sessionId}`,
    blocks: [{ kind: 'text', text: '' }] as TemplateBlock[],
    createdInSessionId: sessionId,
  }));
  const [preview, setPreview] = useState<string>('');
  const [morphMenu, setMorphMenu] = useState<MorphMenuState>(null);

  // ===== Stable preview =====
  useEffect(() => {
    (async () => {
      const s = await generateFromDocAsync(doc, { graph });
      setPreview(s);
    })();
  }, [doc, graph]);

  // ==== Phrase tray demo (replace with your real tray if needed) ====
  const demoTray = useMemo(
    () => [
      'Life is a circus, but the clowns are running late.',
      'Life is a parade where the tuba always drowns you out.',
      'Life is a board game missing three dice and most of the instructions.',
      'Life is a pizza delivery that shows up cold but still charges extra.',
      'Life is a soap bubble—shiny, fun, and always one sneeze away from ending.',
    ],
    []
  );

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4">
        {/* Tray */}
        <div className="w-64 shrink-0">
          <div className="mb-2 text-sm font-semibold">Phrase Tray</div>
          <div className="flex flex-col gap-2">
            {demoTray.map((p, idx) => (
              <button
                key={idx}
                className="text-left rounded border bg-white px-2 py-1 hover:bg-slate-50"
                onClick={() => addTrayPhrase(p)}
              >
                {p}
              </button>
            ))}
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
          {/* Controls */}
          <div className="mt-3 flex flex-col gap-3">
            <div>
              <div className="mb-1 text-sm font-medium">Text</div>
              <textarea
                className="w-full min-h-[72px] rounded border bg-white p-2"
                placeholder="Type literal text here…"
                value={(doc.blocks[0] && doc.blocks[0].kind === 'text') ? (doc.blocks[0] as TextBlock).text : ''}
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