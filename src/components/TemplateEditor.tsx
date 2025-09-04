import { useMemo, useState, useEffect, useRef } from 'react';
import { useActiveNodesWithGraph } from '../contexts/ActiveNodesContext';
import { SlotDescriptor, POS } from '../types/index.js';
import { addSessionTemplate, updateSessionTemplate, removeSessionTemplate, listSessionTemplates } from '../lib/sessionTemplates.js';
import type { SemanticGraphLite } from '../lib/semanticGraphLite.js';

type Props = { sessionId: string; onClose?: () => void; graph: SemanticGraphLite };

const POS_ORDER: POS[] = [
  'NOUN', 
  'VERB', 'VERB:participle', 'VERB:past', 'VERB:present_3rd',
  'ADJ', 'ADJ:comparative', 'ADJ:superlative',
  'ADV', 'ADP', 'DET', 'PRON', 'PROPN', 'AUX'
];

export default function TemplateEditor({ sessionId, onClose, graph }: Props) {
  const { ctx } = useActiveNodesWithGraph(graph);
  const [tokens, setTokens] = useState<SlotDescriptor[]>([]);
  const [pinned, setPinned] = useState<boolean>(false);
  const [testPrompt, setTestPrompt] = useState<string | null>(null);
  const [textInput, setTextInput] = useState<string>('');
  const [showTextInput, setShowTextInput] = useState<boolean>(false);
  
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

  // If your "Test" button lives inside a form, prevent accidental submit refresh in text mode.
  const handleTestClick = (e?: React.MouseEvent<HTMLButtonElement>) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    testTemplate();
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

  // Helper function to parse morphological specifiers from POS tags
  function parseMorphSpecifier(pos: string): { basePos: string; morph?: string } {
    if (pos.includes(':')) {
      const [basePos, morph] = pos.split(':');
      console.log('🔍 parseMorphSpecifier:', pos, '-> basePos:', basePos, 'morph:', morph);
      return { basePos, morph };
    }
    console.log('🔍 parseMorphSpecifier:', pos, '-> no morph');
    return { basePos: pos };
  }

  function addPOS(pos: POS) {
    const newTokens: SlotDescriptor[] = [...tokens, { kind: 'slot', pos }];
    setTokens(newTokens);
    if (showTextInput) {
      setTextInput(tokensToText(newTokens));
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
      setTextInput(tokensToText(newTokens));
    }
  }
  function removeAt(idx: number) {
    const newTokens = tokens.filter((_, i) => i !== idx);
    setTokens(newTokens);
    if (showTextInput) {
      setTextInput(tokensToText(newTokens));
    }
  }
  function clearAll() {
    setTokens([]);
    setTextInput('');
  }
  function save() {
    const text = '[' + tokens.map(t => t.kind === 'chunk' ? (t.chunkPattern ?? '') : `${t.pos}${t.index ?? ''}`).join(' ') + ']';
    addSessionTemplate(sessionId, { text, slots: tokens, pinned, tags: ['user'] });
    clearAll(); setPinned(false);
  }

  function testTemplate() {
    const slots = tokens; // IMPORTANT: do not auto-number here
    console.log('🔍 testTemplate called with slots:', slots);
    console.log('🔍 showTextInput mode:', showTextInput);
    console.log('🔍 textInput value:', textInput);
    if (!slots || slots.length === 0) {
      console.log('🔍 No slots, setting testPrompt to error message');
      setTestPrompt('No template to test. Add some slots or chunks first.');
      return;
    }

    // Preview for logs
    const patternPreview = slots
      .map(s => (s.kind === 'chunk' ? `[${s.chunkPattern}]` : `${s.pos}${s.index ?? ''}`))
      .join(' ');
    console.log('🎯 Template pattern:', `[${patternPreview}]`);

      // Helper: remove digits from POS tokens (NOUN1 -> NOUN)
  const stripDigits = (s: string) => s.replace(/\d+/g, '');

  // Cache base text (chunk or phrase) by normalized POS pattern for this test run
  const baseByPattern = new Map<string, string>();
  const findBaseTextForPattern = (normalizedPattern: string): string => {
    if (baseByPattern.has(normalizedPattern)) return baseByPattern.get(normalizedPattern)!;
    // Prefer chunk first (more "local"), then phrase fallback
    const chunk = ctx.chunks?.find((ch: any) => ch.posPattern === normalizedPattern);
    if (chunk?.text) {
      baseByPattern.set(normalizedPattern, chunk.text);
      return chunk.text;
    }
    const phrase = ctx.phrases?.find((p: any) => p.posPattern === normalizedPattern);
    if (phrase?.text) {
      baseByPattern.set(normalizedPattern, phrase.text);
      return phrase.text;
    }
    baseByPattern.set(normalizedPattern, '');
    return '';
  };

  // Try a base phrase only if ALL top-level slots are word slots
    const isAllWordSlots = slots.every(s => s.kind === 'slot');
    let baseText = '';
    if (isAllWordSlots) {
      const normalizedPattern = slots.map(s => stripDigits(s.pos)).join('-');
      const basePhrase = ctx.phrases.find(p => p.posPattern === normalizedPattern);
      if (basePhrase) {
        console.log('✅ Found matching phrase:', basePhrase.text);
        baseText = basePhrase.text;
      }
    }

    const baseWords = baseText ? baseText.split(/\s+/) : [];

    // Build POS → ctx words for random picks
    const wordsByPOS = new Map<POS, any[]>();
    POS_ORDER.forEach(pos => {
      const words = ctx.words.filter(w => w.pos?.includes(pos));
      console.log('🔍 wordsByPOS for', pos, ':', words.length, 'words');
      wordsByPOS.set(pos, words);
    });

    const usedIds = new Set<string>();
    const chosenByKey = new Map<string, string>(); // `${POS}:${index}` => chosen lemma/text

    // Lightweight fallback bank (or import your central wordBank)
    const bank: Record<POS, string[]> = {
      NOUN: ['cat','dog','bird','fish','tree','house','car','book','hand','eye'],
      VERB: ['ate','ran','jumped','sang','danced','walked','drove','read','wrote','saw'],
      'VERB:participle': ['eating','running','jumping','singing','dancing','walking','driving','reading','writing','seeing'],
      'VERB:past': ['ate','ran','jumped','sang','danced','walked','drove','read','wrote','saw'],
      'VERB:present_3rd': ['eats','runs','jumps','sings','dances','walks','drives','reads','writes','sees'],
      ADJ: ['big','small','red','blue','green','happy','sad','fast','slow','loud'],
      'ADJ:comparative': ['bigger','smaller','redder','bluer','greener','happier','sadder','faster','slower','louder'],
      'ADJ:superlative': ['biggest','smallest','reddest','bluest','greenest','happiest','saddest','fastest','slowest','loudest'],
      ADV: ['quickly','slowly','quietly','loudly','carefully','suddenly','always','never','often','sometimes'],
      ADP: ['in','on','at','by','with','about','against','between','into','through'],
      DET: ['a','an','the','this','that','these','those','my','your','his'],
      PRON: ['I','you','he','she','it','we','they','me','him','her'],
      PROPN: ['Alice','Bob','Charlie','Diana','Eve','Frank','Grace','Henry','Ivy','Jack'],
      AUX: ['is','are','was','were','be','been','being','have','has','had']
    } as any;

    const pickRandomForPOS = (pos: POS): string => {
      console.log('🔍 pickRandomForPOS called with pos:', pos);
      const pool = (wordsByPOS.get(pos) || []).filter((w: any) => !usedIds.has(w.id));
      console.log('🔍 Pool for', pos, ':', pool.length, 'words');
      if (pool.length) {
        const w = pool[Math.floor(Math.random() * pool.length)];
        usedIds.add(w.id);
        const result = w.lemma || w.text || '';
        console.log('🔍 Picked from pool:', result);
        return result;
      }
      const b = bank[pos] || [];
      const result = b[Math.floor(Math.random() * b.length)] || pos.toLowerCase();
      console.log('🔍 Picked from bank:', result, 'for pos:', pos);
      return result;
    };

    const resolveWordSlot = (slot: SlotDescriptor, position: number): string => {
      console.log('🔍 resolveWordSlot called with slot:', slot, 'position:', position);
      // Parse morphological specifier
      const { basePos, morph } = parseMorphSpecifier(slot.pos);
      
      // Numbered → pick once and reuse per `${POS}:${index}`
      if (slot.index !== undefined) {
        const key = `${slot.pos}:${slot.index}`;
        if (!chosenByKey.has(key)) {
          // Try to find word with matching morphological feature
          if (morph) {
            const morphWord = ctx.words.find(w => 
              w.pos?.includes(basePos) && w.morphFeature === morph
            );
            if (morphWord) {
              chosenByKey.set(key, morphWord.originalForm || morphWord.lemma || morphWord.text);
            } else {
              chosenByKey.set(key, pickRandomForPOS(slot.pos));
            }
          } else {
            chosenByKey.set(key, pickRandomForPOS(slot.pos));
          }
        }
        return chosenByKey.get(key)!;
      }
      
      // Unnumbered → keep base word at this position if available
      if (baseWords.length && position < baseWords.length) {
        return baseWords[position];
      }
      
      // Try to find word with matching morphological feature
      if (morph) {
        console.log('🔍 Looking for morph word with basePos:', basePos, 'morph:', morph);
        const morphWord = ctx.words.find(w => 
          w.pos?.includes(basePos) && w.morphFeature === morph
        );
        console.log('🔍 Found morph word:', morphWord);
        if (morphWord) {
          const result = morphWord.originalForm || morphWord.lemma || morphWord.text;
          console.log('🔍 Returning morph word result:', result);
          return result;
        }
      }
      
      // Else random
      return pickRandomForPOS(slot.pos);
    };

      const resolveChunkSlot = (slot: SlotDescriptor): string => {
    const raw = slot.chunkPattern || '';
    const normalized = raw.split(/[- ]+/).map(stripDigits).join('-'); // remove any digit suffixes
    const parts = raw.split(/[- ]+/);

    console.log('🔍 resolveChunkSlot called with pattern:', raw, 'parts:', parts);

    // New: lookup base text by pattern (chunk first, then phrase fallback)
    const baseTextForPattern = findBaseTextForPattern(normalized);

    // If no stored chunk/phrase found, synthesize (keep numbered memoization semantics)
    if (!baseTextForPattern) {
      return parts
        .map(part => {
          console.log('🔍 Processing chunk part:', part);
          // Handle morphological features like ADJ:comparative
          if (part.includes(':')) {
            const { basePos, morph } = parseMorphSpecifier(part);
            console.log('🔍 Morphological part:', part, '-> basePos:', basePos, 'morph:', morph);
            
            // Try to find word with matching morphological feature
            if (morph) {
              const morphWord = ctx.words.find(w => 
                w.pos?.includes(basePos) && w.morphFeature === morph
              );
              if (morphWord) {
                const result = morphWord.originalForm || morphWord.lemma || morphWord.text;
                console.log('🔍 Found morph word in chunk:', result);
                return result;
              }
            }
            
            // Fall back to word bank
            const result = pickRandomForPOS(part as POS);
            console.log('🔍 Fallback for morph part:', result);
            return result;
          }
          
          // Handle regular POS with optional numbers
          const m = part.match(/^([A-Z]+)(\d+)?$/);
          if (!m) return part;
          const pos = m[1] as POS;
          const idx = m[2] ? parseInt(m[2], 10) : undefined;
          if (idx !== undefined) {
            const key = `${pos}:${idx}`;
            if (!chosenByKey.has(key)) chosenByKey.set(key, pickRandomForPOS(pos));
            return chosenByKey.get(key)!;
          }
          return pickRandomForPOS(pos);
        })
        .join(' ');
    }

    // Use base chunk/phrase text for unnumbered subparts; randomize only numbered
    const baseWords = baseTextForPattern.split(/\s+/);
    return parts
      .map((part, i) => {
        // Handle morphological features in base text
        if (part.includes(':')) {
          const { basePos, morph } = parseMorphSpecifier(part);
          if (morph) {
            const morphWord = ctx.words.find(w => 
              w.pos?.includes(basePos) && w.morphFeature === morph
            );
            if (morphWord) {
              return morphWord.originalForm || morphWord.lemma || morphWord.text;
            }
          }
          return pickRandomForPOS(part as POS);
        }
        
        const m = part.match(/^([A-Z]+)(\d+)?$/);
        if (!m) return part;
        const pos = m[1] as POS;
        const idx = m[2] ? parseInt(m[2], 10) : undefined;
        if (idx !== undefined) {
          const key = `${pos}:${idx}`;
          if (!chosenByKey.has(key)) chosenByKey.set(key, pickRandomForPOS(pos));
          return chosenByKey.get(key)!;
        }
        // Unnumbered → keep base word at same sub-index if available
        return baseWords[i] ?? pickRandomForPOS(pos);
      })
      .join(' ');
  };

    const out = slots.map((slot, position) => {
      console.log('🔍 Processing slot at position', position, ':', slot);
      if (slot.kind === 'chunk') {
        return resolveChunkSlot(slot);
      } else {
        return resolveWordSlot(slot, position);
      }
    });

    const text = out.join(' ').trim();
    const finalText = text ? text[0].toUpperCase() + text.slice(1) : '';
    console.log('✅ Generated prompt:', finalText);
    console.log('🔍 Setting testPrompt to:', finalText);
    console.log('🔍 Current testPrompt state before setTestPrompt:', testPrompt);
    
    // Use setTimeout to ensure state update happens after current render cycle
    setTimeout(() => {
      setTestPrompt(finalText);
      console.log('🔍 setTestPrompt called with:', finalText);
    }, 0);
  }

  // Parse text input to tokens
  function parseTextToTokens(text: string): SlotDescriptor[] {
    const tokens: SlotDescriptor[] = [];
    // Remove any outer brackets if present
    const cleanText = text.trim().replace(/^\[|\]$/g, '');
    const parts = cleanText.split(/\s+/);
    
    console.log('🔍 Parsing text:', text, '-> cleanText:', cleanText, '-> parts:', parts);
    
    for (const part of parts) {
      // Handle chunk patterns like [ADJ NOUN ADP NOUN] or [NOUN1-NOUN2]
      if (part.startsWith('[') && part.endsWith(']')) {
        const pattern = part.slice(1, -1);
        tokens.push({
          kind: 'chunk',
          pos: 'NOUN',
          chunkPattern: pattern
        });
      }
      // Handle hyphenated patterns like DET-ADJ-NOUN1 (treat as chunk)
      else if (part.includes('-') && /^[A-Z]+(:[a-z_]+)?(\d+)?(-[A-Z]+(:[a-z_]+)?(\d+)?)*$/.test(part)) {
        console.log('🔍 Parsing hyphenated pattern as chunk:', part);
        tokens.push({
          kind: 'chunk',
          pos: 'NOUN',
          chunkPattern: part
        });
      }
      // Handle POS slots like NOUN1, VERB, VERB:participle, ADJ:comparative, etc.
      else if (/^[A-Z]+(:[a-z_]+)?(\d+)?$/.test(part)) {
        const match = part.match(/^([A-Z]+)(:[a-z_]+)?(\d+)?$/);
        if (match) {
          const pos = (match[1] + (match[2] || '')) as POS;
          const index = match[3] ? parseInt(match[3], 10) : undefined;
          console.log('🔍 Parsed POS:', pos, 'index:', index);
          tokens.push({
            kind: 'slot',
            pos,
            index
          });
        }
      } else {
        console.log('🔍 Skipping unrecognized part:', part);
      }
    }
    
    console.log('🔍 Final parsed tokens:', tokens);
    return tokens;
  }

  // Convert tokens to text representation
  function tokensToText(tokens: SlotDescriptor[]): string {
    return tokens.map(t => {
      if (t.kind === 'chunk') {
        return `[${t.chunkPattern}]`;
      } else {
        return `${t.pos}${t.index ?? ''}`;
      }
    }).join(' ');
  }

  // Handle text input change
  function handleTextInputChange(value: string) {
    console.log('🔍 handleTextInputChange called with value:', value);
    setTextInput(value);
    const newTokens = parseTextToTokens(value);
    console.log('🔍 Parsed tokens from text input:', newTokens);
    setTokens(newTokens);
    console.log('🔍 Tokens state updated to:', newTokens);
  }

  // Toggle between chip view and text input
  function toggleTextInput() {
    if (showTextInput) {
      // Switching to chip view - parse current text
      const newTokens = parseTextToTokens(textInput);
      setTokens(newTokens);
    } else {
      // Switching to text view - convert current tokens to text
      setTextInput(tokensToText(tokens));
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
            className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
            onClick={onClose}
          >
            ✕ Close
          </button>
        </div>
      </div>

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
            {ctx.chunks.map(ch => (
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
            {ctx.phrases.map(ph => (
              <div key={ph.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                <div className="truncate text-sm flex-1 mr-2">{ph.text}</div>
                <div className="flex items-center gap-2">
                  <span className="bg-gray-200 px-2 py-1 rounded text-xs">{ph.posPattern}</span>
                  <button
                    className="btn-secondary px-2 py-1 rounded text-xs"
                    onClick={() => {
                      // replace editor tokens with phrase as a chunk pattern
                      console.log('🎯 Using phrase:', ph.text);
                      console.log('🎯 Phrase pattern:', ph.posPattern);
                      setTokens([{ 
                        kind: 'chunk', 
                        pos: 'NOUN', 
                        chunkPattern: ph.posPattern 
                      }]);
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
                <span className="bg-gray-200 px-2 py-1 rounded text-xs">{t.source}</span>
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
        </div>
      </div>
    </div>
  );
}
