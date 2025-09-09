import { useMemo, useState, useEffect, useRef } from 'react';
import { useActiveNodesWithGraph } from '../contexts/ActiveNodesContext';
import { SlotDescriptor, POS } from '../types/index.js';
import { addSessionTemplate, updateSessionTemplate, removeSessionTemplate, listSessionTemplates } from '../lib/sessionTemplates.js';
import { createTemplateFromText, fillTemplateSlotsRandom } from '../lib/promptEngine.js';
import type { SemanticGraphLite } from '../lib/semanticGraphLite.js';
import ComposerEditor from './ComposerEditor';

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

  const sessionTemplates = listSessionTemplates(sessionId);

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
      const text = '[' + newTokens.map(t => t.kind === 'chunk' ? (t.chunkPattern ?? '') : `${t.pos}${t.index ?? ''}`).join('-') + ']';
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
      const text = '[' + newTokens.map(t => t.kind === 'chunk' ? (t.chunkPattern ?? '') : `${t.pos}${t.index ?? ''}`).join('-') + ']';
      setTextInput(text);
    }
  }
  function removeAt(idx: number) {
    const newTokens = tokens.filter((_, i) => i !== idx);
    setTokens(newTokens);
    if (showTextInput) {
      const text = '[' + newTokens.map(t => t.kind === 'chunk' ? (t.chunkPattern ?? '') : `${t.pos}${t.index ?? ''}`).join('-') + ']';
      setTextInput(text);
    }
  }
  function clearAll() {
    setTokens([]);
    setTextInput('');
    setOriginalPhraseText(null);
  }
  function save() {
    const text = '[' + tokens.map(t => t.kind === 'chunk' ? (t.chunkPattern ?? '') : `${t.pos}${t.index ?? ''}`).join('-') + ']';
    try {
      const template = createTemplateFromText(text, sessionId, originalPhraseText || undefined);
      addSessionTemplate(sessionId, { ...template, pinned, tags: ['user'] });
      clearAll(); setPinned(false);
    } catch (error) {
      console.log('🔍 Error creating template for save:', error);
      // Fallback to direct creation if parsing fails
      addSessionTemplate(sessionId, { text, slots: tokens, baseText: originalPhraseText || undefined, pinned, tags: ['user'] });
      clearAll(); setPinned(false);
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
      // Create a template from the current text input or tokens
      const templateText = showTextInput ? textInput : '[' + tokens.map(t => t.kind === 'chunk' ? (t.chunkPattern ?? '') : `${t.pos}${t.index ?? ''}`).join('-') + ']';
      
      // Create template with base text if available
      console.log('🔍 originalPhraseText in testTemplate:', originalPhraseText);
      const template = createTemplateFromText(templateText, sessionId, originalPhraseText ?? undefined);
      
      // Use centralized fillTemplateSlotsRandom for testing
      const result = await fillTemplateSlotsRandom(template, ctx, { lockedWordIds: [], lockedChunkIds: [], lockedTemplateIds: [] }, Math.random);
      
      if (result) {
        const finalText = result.text;
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
  function handleTextInputChange(value: string) {
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
    try {
      const template = createTemplateFromText(value, sessionId);
      console.log('🔍 Parsed template from text input:', template);
      setTokens(template.slots);
      console.log('🔍 Tokens state updated to:', template.slots);
    } catch (error) {
      console.log('🔍 Error parsing template:', error);
      setTokens([]);
    }
  }

  // Toggle between chip view and text input
  function toggleTextInput() {
    if (showTextInput) {
      // Switching to chip view - parse current text
      try {
        const template = createTemplateFromText(textInput, sessionId);
        setTokens(template.slots);
      } catch (error) {
        console.log('🔍 Error parsing template in toggle:', error);
        setTokens([]);
      }
    } else {
      // Switching to text view - convert current tokens to text
      const text = '[' + tokens.map(t => t.kind === 'chunk' ? (t.chunkPattern ?? '') : `${t.pos}${t.index ?? ''}`).join('-') + ']';
      setTextInput(text);
    }
    setShowTextInput(!showTextInput);
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
          <div className="text-sm text-gray-600">{sessionTemplates.length} total</div>
        </div>
        <div className="space-y-2">
          {sessionTemplates.map(t => (
            <div key={t.id} className="flex items-center justify-between border rounded px-2 py-1">
              <div className="truncate text-sm">{t.text}</div>
              <div className="flex items-center gap-2">
                <span className="bg-gray-200 px-2 py-1 rounded text-xs">template</span>
                <button
                  className="btn-secondary px-2 py-1 rounded text-xs"
                  onClick={() => updateSessionTemplate(sessionId, t.id, { pinned: !t.pinned })}
                >
                  {t.pinned ? '🔓 Unlock' : '🔒 Lock'}
                </button>
                <button
                  className="btn-secondary px-2 py-1 rounded text-xs"
                  onClick={() => removeSessionTemplate(sessionId, t.id)}
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
          {!sessionTemplates.length && <div className="text-sm text-muted-foreground">No session templates yet.</div>}
        </div>
      </div>
        </>
      )}
        </div>
      </div>
    </div>
  );
}
