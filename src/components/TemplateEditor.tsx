import { useMemo, useState, useEffect, useRef } from 'react';
import { useActiveNodesWithGraph } from '../contexts/ActiveNodesContext';
import { SlotDescriptor, POS } from '../types/index.js';
import { TemplateStore } from '../lib/templateStore';
import { ensureHydrated } from '../lib/ensureHydrated';
// import { saveTemplateRobust } from '../lib/templateSaving'; // Not used anymore
import { convertTemplateDocToUnified } from '../lib/composer';
import { realizeTemplate } from '../lib/fillTemplate';
import type { TemplateDoc } from '../types';
import type { SemanticGraphLite } from '../lib/semanticGraphLite.js';
import ComposerEditor from './ComposerEditor';

// const docToPattern = (doc: TemplateDoc) => {
//   const parts: string[] = [];
//   for (const b of doc.blocks || []) {
//     if ((b as any).kind === 'phrase') {
//       for (const t of (b as any).tokens || []) {
//         if (t.randomize && t.pos) parts.push(`[${t.pos}]`);
//         else if (t.text) parts.push(t.text);
//       }
//     } else if ((b as any).kind === 'text') {
//       const txt = (b as any).text || '';
//       if (txt.trim()) parts.push(txt);
//     }
//   }
//   return parts.join(' ').replace(/\s+/g, ' ').trim();
// };

type Props = { sessionId: string; onClose?: () => void; graph: SemanticGraphLite };

const POS_ORDER: POS[] = [
  'NOUN', 
  'VERB', 'VERB:participle', 'VERB:past', 'VERB:present_3rd',
  'ADJ', 'ADJ:comparative', 'ADJ:superlative',
  'ADV', 'ADP', 'DET', 'PRON', 'PROPN', 'AUX'
];

export default function TemplateEditor({ sessionId, onClose, graph }: Props) {
  const { ctx } = useActiveNodesWithGraph(graph);
  const [mode, setMode] = useState<'classic'|'composer'>('composer'); // default to new flow
  const [tokens, setTokens] = useState<SlotDescriptor[]>([]);
  const [pinned, setPinned] = useState<boolean>(false);
  const [testPrompt, setTestPrompt] = useState<string | null>(null);
  const [textInput, setTextInput] = useState<string>('');
  const [showTextInput, setShowTextInput] = useState<boolean>(false);
  const [originalPhraseText, setOriginalPhraseText] = useState<string | null>(null);
  const [isSettingFromUseButton, setIsSettingFromUseButton] = useState<boolean>(false);

  const lastPreviewDocRef = useRef<TemplateDoc | null>(null);
  
  // Stable ref to the test prompt box so we can ensure visibility
  const testPromptRef = useRef<HTMLDivElement | null>(null);

  // Helper that avoids truthy short-circuit pitfalls & whitespace-only strings
  const hasTestPrompt = testPrompt !== null && testPrompt.trim().length > 0;
  console.log('🔍 hasTestPrompt calculation:', { testPrompt, hasTestPrompt });

  // Display-only chips with visual numbering (doesn't mutate original tokens)
  const displayChips = useMemo(() => {
    const counts: Partial<Record<POS, number>> = {};
    return tokens.map(t => {
      if (t.kind === 'chunk') return { label: `[${t.chunkPattern}]`, slot: t };
      const next = (counts[t.pos] = (counts[t.pos] ?? 0) + 1);
      // show an inferred number if slot.index is undefined (visual only)
      const label = `${t.pos}${t.index ?? next}`;
      return { label, slot: t };
    });
  }, [tokens]);

  const effectiveSessionId = sessionId || '__global__';
  const [userTemplates, setUserTemplates] = useState<Array<{id:string,text:string,tags?:string[],pinned?:boolean}>>([]);

  const refreshUserTemplates = async () => {
    try {
      const list = await TemplateStore.list(effectiveSessionId, { includeGlobal: true });
      setUserTemplates(list.map(t => ({ 
        id: t.id, 
        text: t.displayText, 
        tags: ['user'], 
        pinned: false 
      })));
    } catch {
      setUserTemplates([]);
    }
  };

  // initial + on session change
  useEffect(() => {
    refreshUserTemplates();
  }, [effectiveSessionId]);

  // listen for store changes & cross-tab updates
  useEffect(() => {
    const onChange = (e:any) => {
      if (!e?.detail || !e.detail.sessionId || e.detail.sessionId === effectiveSessionId) {
        refreshUserTemplates();
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'OTS_TEMPLATES') refreshUserTemplates();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('prompter:templates-changed', onChange);
      window.addEventListener('storage', onStorage);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('prompter:templates-changed', onChange);
        window.removeEventListener('storage', onStorage);
      }
    };
  }, [effectiveSessionId]);

  // Debug: Track testPrompt changes
  useEffect(() => {
    console.log('🔍 testPrompt state changed to:', testPrompt);
  }, [testPrompt]);

  // Debug: Track originalPhraseText changes
  useEffect(() => {
    console.log('🔍 originalPhraseText state changed to:', originalPhraseText);
  }, [originalPhraseText]);

  // If your "Test" button lives inside a form, prevent accidental submit refresh in text mode.
  const handleTestClick = async (e?: React.MouseEvent<HTMLButtonElement>) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    await testTemplate();
  };

  // Ensure the box scrolls into view after updates (and isn't visually hidden below the fold)
  useEffect(() => {
    console.log('🔍 useEffect triggered for hasTestPrompt:', hasTestPrompt);
    if (hasTestPrompt && testPromptRef.current) {
      try {
        testPromptRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch {
        // no-op
      }
    }
  }, [hasTestPrompt]);

  // Force re-render when testPrompt changes
  useEffect(() => {
    console.log('🔍 testPrompt changed, forcing re-render');
  }, [testPrompt]);


  function addPOS(pos: POS) {
    const newTokens: SlotDescriptor[] = [...tokens, { kind: 'slot', pos }];
    setTokens(newTokens);
    if (showTextInput) {
      const text = tokensToPatternString(newTokens);
      setTextInput(text);
    }
  }
  function addChunk(pattern: string) {
    // Find the chunk object to get its text
    const chunk = ctx.chunks.find(ch => ch.posPattern === pattern);
    if (chunk) {
      console.log('🎯 Adding chunk:', chunk.text, 'with pattern:', pattern);
    }
    
    const newTokens: SlotDescriptor[] = [...tokens, { kind: 'chunk', pos: 'NOUN', chunkPattern: pattern }];
    setTokens(newTokens);
    if (showTextInput) {
      const text = tokensToPatternString(newTokens);
      setTextInput(text);
    }
  }
  function removeAt(idx: number) {
    const newTokens = tokens.filter((_, i) => i !== idx);
    setTokens(newTokens);
    if (showTextInput) {
      const text = tokensToPatternString(newTokens);
      setTextInput(text);
    }
  }
  function clearAll() {
    setTokens([]);
    setTextInput('');
    setOriginalPhraseText(null);
  }
  async function save() {
    try {
      // Prefer the last hydrated preview; fallback to current text
      let hydrated = lastPreviewDocRef.current;
      if (!hydrated) {
        const pattern = showTextInput ? (textInput || '').trim() : tokensToPatternString(tokens);
        if (!pattern) throw new Error('Empty template (no tokens/no text)');
        const rawDoc: TemplateDoc = {
          id: `user_tpl_${Date.now()}`,
          createdInSessionId: 'user-templates',
          blocks: [{ kind: 'text', text: pattern }]
        } as any;
        hydrated = await ensureHydrated(rawDoc);
      }
      
      console.log('[TemplateEditor] SAVE (hydrated preview) attempt', { 
        sid: effectiveSessionId, 
        blocks: hydrated.blocks.length
      });
      
      const rec = await TemplateStore.save({
        sessionId: effectiveSessionId,
        doc: hydrated
      });
      
      console.log('[TemplateEditor] SAVE ok', rec);
      clearAll(); setPinned(false);
      refreshUserTemplates();
    } catch (error) {
      console.error('Failed to save template:', error);
      alert(`Failed to save: ${(error as Error).message}`);
    }
  }

  async function testTemplate() {
    const slots = tokens; // IMPORTANT: do not auto-number here
    console.log('🔍 testTemplate called with slots:', slots);
    console.log('🔍 showTextInput mode:', showTextInput);
    console.log('🔍 textInput value:', textInput);
    if (!slots || slots.length === 0) {
      console.log('🔍 No slots, setting testPrompt to error message');
      setTestPrompt('No template to test. Add some slots or chunks first.');
      return;
    }

    try {
      const templateText = showTextInput ? (textInput || '') : tokensToPatternString(tokens);
      const rawDoc: TemplateDoc = {
        id: `test_tpl_${Date.now()}`,
        createdInSessionId: effectiveSessionId,
        blocks: [{ kind: 'text', text: templateText }]
      } as any;
      const hydrated = await ensureHydrated(rawDoc);
      lastPreviewDocRef.current = hydrated; // <-- capture hydrated doc used for preview
      const unified = convertTemplateDocToUnified(hydrated);
      const result = await realizeTemplate({
        tpl: unified,
        ctx: { words: ctx.words },
        lockedSet: new Set(),
        wordBank: {}
      });
      
      if (result) {
        const finalText = result.surface;
        console.log('✅ Generated prompt:', finalText);
        console.log('🔍 Setting testPrompt to:', finalText);
        
        // Use setTimeout to ensure state update happens after current render cycle
        setTimeout(() => {
          setTestPrompt(finalText);
          console.log('🔍 setTestPrompt called with:', finalText);
        }, 0);
      } else {
        setTestPrompt('Failed to generate test prompt');
      }
    } catch (error) {
      console.log('🔍 Error in testTemplate:', error);
      setTestPrompt('Error generating test prompt');
    }
  }



  // Handle text input change
  async function handleTextInputChange(value: string) {
    console.log('🔍 handleTextInputChange called with value:', value);
    console.log('🔍 isSettingFromUseButton:', isSettingFromUseButton);
    setTextInput(value);
    
    // Clear original phrase text when user manually types (not from Use button)
    if (!isSettingFromUseButton) {
      setOriginalPhraseText(null);
    } else {
      // Reset the flag after handling the Use button case
      setIsSettingFromUseButton(false);
    }
    // Parse current text into slot tokens via hydrator → phrase tokens
    try {
      const doc: TemplateDoc = {
        id: 'tmp_parse',
        createdInSessionId: effectiveSessionId,
        blocks: [{ kind: 'text', text: value }]
      } as any;
      const hydrated = await ensureHydrated(doc);
      const slots: SlotDescriptor[] = [];
      for (const b of hydrated.blocks) {
        if ((b as any).kind === 'phrase') {
          for (const t of (b as any).tokens || []) {
            if (t.randomize && t.pos) {
              slots.push({ kind: 'slot', pos: t.pos as POS });
            }
          }
        }
      }
      setTokens(slots);
    } catch (error) {
      console.log('🔍 Error parsing template:', error);
      setTokens([]);
    }
  }

  // Toggle between chip view and text input
  function toggleTextInput() {
    if (showTextInput) {
      // Switching to chip view - parse current text using hydrator
      handleTextInputChange(textInput);
    } else {
      // Switching to text view - convert current tokens to text
      setTextInput(tokensToPatternString(tokens));
    }
    setShowTextInput(!showTextInput);
  }

  // Build a correct pattern string from slots/chunks: separate tokens by spaces.
  function tokensToPatternString(list: SlotDescriptor[]): string {
    return list.map(t =>
      t.kind === 'chunk'
        ? `[CHUNK:[${t.chunkPattern ?? ''}]]`
        : `[${t.pos}${t.index ?? ''}]`
    ).join(' ');
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Template Editor</h2>
        <div className="space-x-2">
          <button
            className={`px-2 py-1 rounded ${mode==='composer'?'bg-blue-600 text-white':'bg-gray-200'}`}
            onClick={() => setMode('composer')}
          >
            Composer
          </button>
          <button
            className={`px-2 py-1 rounded ${mode==='classic'?'bg-blue-600 text-white':'bg-gray-200'}`}
            onClick={() => setMode('classic')}
          >
            Classic
          </button>
          <button
            className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
            onClick={onClose}
          >
            ✕ Close
          </button>
        </div>
      </div>

      {mode === 'composer' ? (
        <ComposerEditor sessionId={sessionId} graph={graph} ctx={ctx} />
      ) : (
        <>

      {/* Pools */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Words by POS */}
        <div className="card p-6 rounded-lg shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Words by POS</h3>
            <div className="text-sm text-gray-600">{ctx.words.length} words</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {POS_ORDER.map(pos => (
              <button
                key={pos}
                className="btn-secondary px-3 py-1 rounded text-sm font-medium"
                onClick={() => addPOS(pos)}
              >
                + {pos}
              </button>
            ))}
          </div>
          <div className="mt-3 text-xs text-gray-600">
            <div><strong>Tense-aware features:</strong></div>
            <div>• <code>VERB:participle</code> → eating, running</div>
            <div>• <code>VERB:past</code> → ate, ran</div>
            <div>• <code>ADJ:comparative</code> → bigger, faster</div>
            <div>• <code>ADJ:superlative</code> → biggest, fastest</div>
          </div>
        </div>

        {/* Chunks */}
        <div className="card p-6 rounded-lg shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Chunks</h3>
            <div className="text-sm text-gray-600">{ctx.chunks.length} chunks</div>
          </div>
          <div className="max-h-56 overflow-auto space-y-2">
            {Array.from(
              new Map(ctx.chunks.map(ch => [ch.posPattern, ch])).values()
            ).map(ch => (
              <div key={ch.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                <span className="bg-gray-200 px-2 py-1 rounded text-xs mr-2">{ch.posPattern}</span>
                <button
                  className="btn-secondary px-2 py-1 rounded text-xs"
                  onClick={() => addChunk(ch.posPattern)}
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Phrases (convert to template pattern in one click) */}
        <div className="card p-6 rounded-lg shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Phrases → Template</h3>
            <div className="text-sm text-gray-600">{ctx.phrases.length} phrases</div>
          </div>
          <div className="max-h-56 overflow-auto space-y-2">
            {Array.from(
              new Map(ctx.phrases.map(ph => [ph.posPattern, ph])).values()
            ).map(ph => (
              <div key={ph.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                <div className="truncate text-sm flex-1 mr-2">{ph.text}</div>
                <div className="flex items-center gap-2">
                  <span className="bg-gray-200 px-2 py-1 rounded text-xs">{ph.posPattern}</span>
                  <button
                    className="btn-secondary px-2 py-1 rounded text-xs"
                    onClick={() => {
                      // replace editor tokens with phrase as individual slots
                      console.log('🎯 Using phrase:', ph.text);
                      console.log('🎯 Phrase pattern:', ph.posPattern);
                      console.log('🎯 Use button clicked!');
                      
                      // Parse the phrase pattern into individual slots
                      const patternSlots = ph.posPattern.split('-').map(pos => ({
                        kind: 'slot' as const,
                        pos: pos as POS
                      }));
                      
                      setTokens(patternSlots);
                      
                      // Store the original phrase text for template creation
                      setIsSettingFromUseButton(true);
                      setTextInput(`[${ph.posPattern}]`);
                      setOriginalPhraseText(ph.text);
                      console.log('🔍 Set originalPhraseText to:', ph.text);
                    }}
                  >
                    Use
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Editor Canvas */}
      <div className="card p-6 rounded-lg shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Template Canvas</h3>
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary px-3 py-2 rounded-lg text-sm font-medium"
              onClick={toggleTextInput}
            >
              {showTextInput ? '📋 Chips' : '✏️ Text'}
            </button>
            <button
              className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
              onClick={clearAll}
            >
              🗑️ Clear
            </button>
            <button
              className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
              onClick={handleTestClick}
              type="button"
            >
              🧪 Test
            </button>
            <button
              className="btn-primary px-4 py-2 rounded-lg text-sm font-medium"
              onClick={save}
            >
              💾 Save to Session
            </button>
          </div>
        </div>

        {/* Editor wrapper with overflow visible so children below aren't clipped in text mode */}
        <div className="overflow-visible">
          {showTextInput ? (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Template Pattern (Text Mode)
                </label>
                <textarea
                  value={textInput}
                  onChange={(e) => handleTextInputChange(e.target.value)}
                  placeholder="Type template pattern here, e.g., NOUN VERB:participle NOUN or ADJ:comparative NOUN"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                  rows={2}
                />
                {/* Ensure no parent <form> submit resets state; Test uses handleTestClick */}
              </div>
              <div className="text-xs text-gray-600 space-y-1">
                <div><strong>Format examples:</strong></div>
                <div>• Basic POS: <code className="bg-gray-100 px-1 rounded">NOUN VERB ADJ</code></div>
                <div>• Tense-aware verbs: <code className="bg-gray-100 px-1 rounded">NOUN VERB:participle NOUN</code> → "cat eating mouse"</div>
                <div>• Past tense: <code className="bg-gray-100 px-1 rounded">NOUN VERB:past NOUN</code> → "cat ate mouse"</div>
                <div>• Comparative adjectives: <code className="bg-gray-100 px-1 rounded">ADJ:comparative NOUN</code> → "bigger cat"</div>
                <div>• Numbered slots: <code className="bg-gray-100 px-1 rounded">NOUN1 VERB:past NOUN2</code></div>
                <div>• Chunk patterns: <code className="bg-gray-100 px-1 rounded">[ADJ NOUN ADP NOUN]</code></div>
              </div>
            </div>
          ) : (
          <div className="flex flex-wrap gap-2 border rounded-lg p-3 min-h-[54px]">
            {displayChips.map((chip, i) => (
              <span key={i} className="inline-flex items-center gap-2 px-2 py-1 rounded-full border">
                <span>{chip.label}</span>
                <button className="opacity-70 hover:opacity-100" onClick={() => removeAt(i)}>
                  ✕
                </button>
              </span>
            ))}
            {!displayChips.length && (
              <span className="text-sm text-muted-foreground">Add POS or chunks from the pools, or switch to text mode…</span>
            )}
          </div>
          )}
        </div>

        <div className="flex items-center gap-3 mt-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} />
            Pin (lock) this template for generation
          </label>
        </div>

        {/* Test Prompt Display - Moved to after editor content */}
        {hasTestPrompt ? (
          <div
            ref={testPromptRef}
            className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg relative z-10"
            // key ensures React doesn't reuse a stale subtree when switching modes
            key={`test-box-${showTextInput ? 'text' : 'chips'}`}
          >
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-blue-800">Test Prompt Example</h4>
              <button
                className="text-blue-600 hover:text-blue-800 text-sm"
                onClick={() => setTestPrompt(null)}
                type="button"
              >
                ✕
              </button>
            </div>
            <div className="text-blue-900 font-medium text-lg">
              "{testPrompt}"
            </div>
          </div>
        ) : (
          <div className="mt-2 text-xs text-red-500">
            DEBUG: hasTestPrompt is false, testPrompt = {testPrompt ? `"${testPrompt}"` : 'null'}
          </div>
        )}

        {/* Debug: Show testPrompt state */}
        <div className="mt-2 text-xs text-gray-500">
          Debug: testPrompt = {testPrompt ? `"${testPrompt}"` : 'null'}, showTextInput = {showTextInput.toString()}, hasTestPrompt = {hasTestPrompt.toString()}
        </div>
      </div>

      {/* Session Templates List (manage & lock) */}
      <div className="card p-6 rounded-lg shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Session Templates</h3>
          <div className="text-sm text-gray-600">{userTemplates.length} total</div>
        </div>
        <div className="space-y-2">
          {userTemplates.map(t => (
            <div key={t.id} className="flex items-center justify-between border rounded px-2 py-1">
              <div className="truncate text-sm">{t.text}</div>
              <div className="flex items-center gap-2">
                <span className="bg-gray-200 px-2 py-1 rounded text-xs">template</span>
                <button
                  className="btn-secondary px-2 py-1 rounded text-xs"
                  onClick={async () => {
                    try {
                      await TemplateStore.update(t.id, {});
                      // Note: pinned functionality will be added in a future update
                    } catch (error) {
                      console.error('Failed to update template:', error);
                    }
                  }}
                >
                  {t.pinned ? '🔓 Unlock' : '🔒 Lock'}
                </button>
                <button
                  className="btn-secondary px-2 py-1 rounded text-xs"
                  onClick={async () => {
                    try {
                      await TemplateStore.remove(t.id);
                      refreshUserTemplates();
                    } catch (error) {
                      console.error('Failed to remove template:', error);
                    }
                  }}
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
          {!userTemplates.length && <div className="text-sm text-muted-foreground">No session templates yet.</div>}
        </div>
      </div>

      {/* File Operations Section */}
      <div className="card p-6 rounded-lg shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">File Operations</h3>
          <div className="text-sm text-gray-600">Save/Load Templates</div>
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          <button
            className="btn-primary px-4 py-2 rounded text-sm flex items-center justify-center gap-2"
            onClick={async () => {
              alert('Export functionality will be implemented in the next update. Templates are now stored in the One True Store!');
            }}
          >
            💾 Save
          </button>
          
          <button
            className="btn-secondary px-4 py-2 rounded text-sm flex items-center justify-center gap-2"
            onClick={async () => {
              alert('File import will be implemented in the next update. Templates are now stored in the One True Store!');
            }}
          >
            📂 Load
          </button>
        </div>
        
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="text-sm text-blue-800">
            <strong>File Operations Help:</strong>
          </div>
          <div className="text-xs text-blue-700 mt-1 space-y-1">
            <div>• <strong>Save:</strong> Save all templates from all sessions to a local file</div>
            <div>• <strong>Load:</strong> Load templates from a file and merge them with existing templates</div>
            <div>• Templates are automatically saved to browser storage for persistence</div>
            <div>• Loading templates will not reset your app - they are merged safely</div>
          </div>
        </div>
      </div>
        </>
      )}
        </div>
      </div>
    </div>
  );
}
