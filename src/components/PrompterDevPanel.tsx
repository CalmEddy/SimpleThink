import React, { useMemo, useState } from "react";
import seedrandom from "seedrandom";
import type { TemplateDoc, TemplateBlock, PhraseBlock, PhraseToken, POS } from "../types/index.js";
import type { SemanticGraphLite } from "../lib/semanticGraphLite.js";
import { Prompter, mutatorJitter30, mutatorAutoBind, mutatorEnsure2Random, mutatorRandomizeNouns, type TemplateSource, type TemplateMutator } from "../lib/prompter/index.js";
import { parseTextPatternsToUTA } from "./ComposerEditor";
import { convertTemplateDocToUnified } from "../lib/composer";
import { useActiveNodesWithGraph } from "../contexts/ActiveNodesContext";
// NOTE: We intentionally avoid resolvePhraseTokens to prevent runtime errors.

/**
 * PrompterDevPanel
 * A playground to tinker with template mutations and generate prompts using the existing UTA pipeline.
 * - Toggle built-in mutators
 * - Configure POS-based randomization (probabilities per POS)
 * - Configure regex-based phrase targeting and randomization
 * - Set RNG seed for determinism
 * - Generate prompt + inspect debug
 */

interface PrompterDevPanelProps {
  source: TemplateSource;
  graph?: SemanticGraphLite;
  bank?: Record<string, string[]>;
  className?: string;
}

// ---------- Utility: POS list for controls ----------
const ALL_POS: POS[] = [
  "NOUN", "VERB", "ADJ", "ADV", "DET", "PRON", "ADP", "AUX", "CONJ", "SCONJ", "PART", "NUM", "INTJ", "PROPN"
] as const as POS[];
const ALLOWED_POS = new Set(ALL_POS); // includes DET, PROPN, etc.

// Simple UI Components that match the existing styling
const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`card rounded-lg p-6 shadow-lg ${className}`}>
    {children}
  </div>
);

const CardHeader: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`mb-4 ${className}`}>
    {children}
  </div>
);

const CardTitle: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <h3 className={`text-lg font-semibold text-gray-800 ${className}`}>
    {children}
  </h3>
);

const CardContent: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={className}>
    {children}
  </div>
);

const Button: React.FC<{ 
  children: React.ReactNode; 
  onClick?: () => void; 
  disabled?: boolean; 
  variant?: 'primary' | 'secondary';
  className?: string;
}> = ({ children, onClick, disabled = false, variant = 'primary', className = "" }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
      variant === 'primary' 
        ? 'btn-primary text-white' 
        : 'btn-secondary text-gray-700'
    } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
  >
    {children}
  </button>
);

const Input: React.FC<{ 
  value: string; 
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; 
  placeholder?: string;
  id?: string;
  className?: string;
}> = ({ value, onChange, placeholder, id, className = "" }) => (
  <input
    id={id}
    type="text"
    value={value}
    onChange={onChange}
    placeholder={placeholder}
    className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${className}`}
  />
);

const Label: React.FC<{ children: React.ReactNode; htmlFor?: string; className?: string }> = ({ children, htmlFor, className = "" }) => (
  <label htmlFor={htmlFor} className={`block text-sm font-medium text-gray-700 mb-1 ${className}`}>
    {children}
  </label>
);

const Switch: React.FC<{ 
  checked: boolean; 
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}> = ({ checked, onCheckedChange, className = "" }) => (
  <button
    onClick={() => onCheckedChange(!checked)}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
      checked ? 'bg-blue-600' : 'bg-gray-200'
    } ${className}`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

const Slider: React.FC<{ 
  value: number[]; 
  onValueChange: (value: number[]) => void; 
  max?: number; 
  step?: number;
  className?: string;
}> = ({ value, onValueChange, max = 100, step = 1, className = "" }) => (
  <input
    type="range"
    min="0"
    max={max}
    step={step}
    value={value[0] || 0}
    onChange={(e) => onValueChange([parseInt(e.target.value)])}
    className={`slider w-full ${className}`}
  />
);

const Textarea: React.FC<{ 
  value: string; 
  readOnly?: boolean; 
  className?: string;
}> = ({ value, readOnly = false, className = "" }) => (
  <textarea
    value={value}
    readOnly={readOnly}
    className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none ${className}`}
  />
);

const Badge: React.FC<{ 
  children: React.ReactNode; 
  variant?: 'default' | 'outline';
  className?: string;
}> = ({ children, variant = 'default', className = "" }) => (
  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
    variant === 'default' 
      ? 'bg-blue-100 text-blue-800' 
      : 'bg-gray-100 text-gray-800 border border-gray-300'
  } ${className}`}>
    {children}
  </span>
);

export default function PrompterDevPanel({ source, graph, bank, className }: PrompterDevPanelProps) {
  // 🔗 Hook into the ACTIVE NODE POOL (same context Composer uses)
  const { ctx: activeCtx } = useActiveNodesWithGraph(graph as any);
  
  // Seed + RNG
  const [seed, setSeed] = useState<string>("");
  const rng = useMemo(() => (seed ? { next: seedrandom(seed) } : undefined), [seed]);

  // Built-in mutator toggles
  const [useJitter, setUseJitter] = useState<boolean>(true);
  const [jitterP, setJitterP] = useState<number>(30);
  const [useAutoBind, setUseAutoBind] = useState<boolean>(true);
  const [useEnsure2, setUseEnsure2] = useState<boolean>(true);
  const [useRandNouns, setUseRandNouns] = useState<boolean>(false);

  // POS-based randomization config
  const [posRandomP, setPosRandomP] = useState<Record<POS, number>>(
    () => ALL_POS.reduce((acc, pos) => (acc[pos] = 0, acc), {} as Record<POS, number>)
  );

  // Regex-based phrase targeting
  const [regexText, setRegexText] = useState<string>("");
  const [regexRandomizeP, setRegexRandomizeP] = useState<number>(0);

  // Template locking
  const [lockedDoc, setLockedDoc] = useState<TemplateDoc | null>(null);
  const [phraseInput, setPhraseInput] = useState<string>("");
  const [patternInput, setPatternInput] = useState<string>("");
  const [useActivePool, setUseActivePool] = useState<boolean>(true); // default ON to mirror Composer
  const [patternFilter, setPatternFilter] = useState<string>("");
  const [inputError, setInputError] = useState<string>("");

  // --- Helpers to build a TemplateDoc directly from nodes using guaranteed fields ---
  function tokenizeSurfaceWords(s: string): string[] {
    // simple tokenization that preserves word order; adequate for dev panel locking
    return s.trim().split(/\s+/);
  }

  function buildDocFromPhraseNode(ph: any): TemplateDoc {
    // Guaranteed: ph.text (phrase string), ph.posPattern (e.g., "NOUN-VERB-NOUN")
    const words = tokenizeSurfaceWords(String(ph.text));
    const pos = String(ph.posPattern).split("-").map((p) => p.trim()).filter(Boolean);
    // Try to align words to pos list; if lengths differ, still create tokens with best effort
    const len = Math.max(words.length, pos.length);
    const tokens = Array.from({ length: len }).map((_, i) => {
      const w = words[i] ?? ""; // literal surface if available
      const p = (pos[i] ?? (pos[pos.length - 1] ?? "NOUN")) as POS;
      return {
        text: w || `[${p}]`,
        lemma: "",           // not required for dev locking
        pos: p,
        posSet: [p],
        randomize: false,    // start literal; mutators will toggle
        slotLabel: null,
        morph: null,
      } as PhraseToken;
    });
    return {
      id: ph.id ?? `locked_phrase_${Date.now()}`,
      createdInSessionId: "devpanel",
      blocks: [{
        kind: "phrase",
        phraseText: String(ph.text),
        tokens
      } as PhraseBlock]
    };
  }

  function buildDocFromChunkNode(ch: any): TemplateDoc {
    // Guaranteed: ch.text (chunk string), ch.posPattern (e.g., "ADJ-NOUN")
    const words = tokenizeSurfaceWords(String(ch.text));
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
      createdInSessionId: "devpanel",
      blocks: [{
        kind: "phrase",
        phraseText: String(ch.text),
        tokens
      } as PhraseBlock]
    };
  }

  // Output
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState<string>("");
  const [debug, setDebug] = useState<any>(null);
  const [chosenTemplateId, setChosenTemplateId] = useState<string>("");
  const [templateText, setTemplateText] = useState<string>("");

  // --------- On-the-fly configurable mutators ---------
  const configurableMutators: TemplateMutator[] = useMemo(() => {
    const result: TemplateMutator[] = [];

    if (useJitter) {
      const p = Math.max(0, Math.min(100, jitterP)) / 100;
      // Wrap jitter with chosen probability
      result.push(function jitterScaled(doc, utils) {
        return utils.jitterSlots(doc, p);
      });
    }
    if (useAutoBind) result.push(mutatorAutoBind);
    if (useEnsure2) result.push(mutatorEnsure2Random);
    if (useRandNouns) result.push(mutatorRandomizeNouns);

    // POS-based randomization mutator
    const anyPOS = ALL_POS.some(pos => (posRandomP[pos] ?? 0) > 0);
    if (anyPOS) {
      result.push(function posRandomizer(doc) {
        const blocks = doc.blocks.map((b: TemplateBlock) => {
          if (b.kind !== "phrase") return b;
          const pb = b as PhraseBlock;
          const tokens = pb.tokens.map((t: PhraseToken) => {
            const candidates: POS[] = t.pos ? [t.pos] : (t.posSet ?? []);
            const maxP = candidates.reduce((m, pos) => Math.max(m, (posRandomP[pos as POS] ?? 0) / 100), 0);
            if (maxP > 0 && /[A-Za-z]/.test(t.text)) {
              if (Math.random() < maxP) return { ...t, randomize: true };
            }
            return t;
          });
          return { ...pb, tokens } as PhraseBlock;
        });
        return { ...doc, blocks };
      });
    }

    // Regex-based randomization mutator
    if (regexText.trim().length > 0 && regexRandomizeP > 0) {
      let re: RegExp | null = null;
      try { re = new RegExp(regexText, "i"); } catch { re = null; }
      if (re) {
        const p = Math.max(0, Math.min(100, regexRandomizeP)) / 100;
        result.push(function regexRandomizer(doc) {
          const blocks = doc.blocks.map((b: TemplateBlock) => {
            if (b.kind !== "phrase") return b;
            const pb = b as PhraseBlock;
            if (!re!.test(pb.phraseText)) return pb;
            const tokens = pb.tokens.map((t: PhraseToken) => {
              if (/[A-Za-z]/.test(t.text) && Math.random() < p) return { ...t, randomize: true };
              return t;
            });
            return { ...pb, tokens } as PhraseBlock;
          });
          return { ...doc, blocks };
        });
      }
    }

    return result;
  }, [useJitter, jitterP, useAutoBind, useEnsure2, useRandNouns, posRandomP, regexText, regexRandomizeP]);

  // --------- Helpers: normalize & validate pattern input ---------
  function normalizePatternInput(raw: string): { ok: boolean; normalized?: string; msg?: string } {
    const s = raw.trim();
    if (!s) return { ok: false, msg: "Pattern is empty." };

    // Accept two styles:
    //   [NOUN-VERB-NOUN]
    //   [DET] [NOUN2] [VERB:participle]
    const multiBlocks = s.match(/\[[^\]]+\]/g);
    let tokens: string[] = [];

    if (multiBlocks && multiBlocks.length > 1) {
      // Multiple bracketed tokens separated by spaces
      tokens = multiBlocks.map(b => b.slice(1, -1).trim());
    } else {
      // Single bracket or bare text -> normalize to one bracket set and split on '-'
      const inside = s.startsWith("[") && s.endsWith("]") ? s.slice(1, -1) : s;
      tokens = inside.split("-").map(p => p.trim());
    }

    // Validate each token: POS, optional bind id, optional morph (via colon)
    // Allowed forms: NOUN | NOUN1 | VERB:participle | PROPN2:base
    const norm = tokens.map(tok => {
      const m = /^([A-Za-z]+)(\d+)?(?::([A-Za-z]+))?$/u.exec(tok);
      if (!m) return { ok:false, msg:`Unsupported token: ${tok}` };
      const pos = (m[1] || "").toUpperCase();
      const bind = m[2]; // optional digits
      const morph = m[3]?.toLowerCase();
      const resolvedPOS = pos === "PARTICIPLE" ? "VERB" : pos;
      if (!ALLOWED_POS.has(resolvedPOS as POS)) {
        return { ok:false, msg:`Unsupported POS: ${tok}. Use tags like NOUN, VERB, ADJ, PROPN, etc.` };
      }
      return { ok:true, out: `${resolvedPOS}${bind ? bind : ""}${morph ? `:${morph}` : ""}` };
    });

    const bad = norm.find(x => !x.ok);
    if (bad) return { ok:false, msg:(bad as any).msg };
    const serialized = norm.map(x => (x as any).out).join("-");
    return { ok:true, normalized:`[${serialized}]` };
  }

  // Build TemplateDoc[] from the ACTIVE POOL (phrases + chunks) — using node fields only
  const activeSource: TemplateSource = useMemo(() => {
    return async () => {
      // If a template is locked, respect that.
      if (lockedDoc) return [lockedDoc];
      const out: TemplateDoc[] = [];

      // 1) Phrase-derived docs — build from node text + posPattern
      for (const ph of (activeCtx?.phrases ?? [])) {
        const doc = buildDocFromPhraseNode(ph);
        out.push(doc);
      }

      // 2) Chunk-derived docs — build from node text + posPattern
      for (const ch of (activeCtx?.chunks ?? [])) {
        const doc = buildDocFromChunkNode(ch);
        out.push(doc);
      }
      return out;
    };
  }, [activeCtx, graph, lockedDoc]);

  // --------- Generate handler ---------
  const handleGenerate = async () => {
    setLoading(true);
    try {
      // Guard: when using the active pool, require it to have data (Topic required)
      if (useActivePool) {
        const pCount = activeCtx?.phrases?.length ?? 0;
        const cCount = activeCtx?.chunks?.length ?? 0;
        const wCount = activeCtx?.words?.length ?? 0;
        if (pCount + cCount === 0 || wCount === 0) {
          setLoading(false);
          alert("Topic required: Active pool is empty. Select a topic or add phrases/words.");
          return;
        }
      }

      const prompter = new Prompter({
        // If toggled on, drive from ACTIVE POOL; else use panel's provided source
        source: useActivePool ? activeSource : (lockedDoc ? [lockedDoc] : source),
        rng: rng as any,
        mutators: configurableMutators,
      });
      // Pass ACTIVE POOL as ctxOverride so selection matches Composer's current context
      const res = await prompter.generate({
        graph,
        bank,
        ctxOverride: {
          words: activeCtx?.words ?? [],
          phrases: activeCtx?.phrases ?? []
        }
      });
      setPrompt(res.prompt);
      setDebug(res.debug);
      setChosenTemplateId(res.templateId);
      setTemplateText(res.templateText);
    } catch (err: any) {
      console.error(err);
      // Simple toast-like notification
      alert(err?.message ?? "Failed to generate prompt");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt || "");
      // Simple toast-like notification
      alert("Prompt copied to clipboard");
    } catch {
      alert("Failed to copy to clipboard");
    }
  };

  // --------- Lock from phrase/chunk row click ---------
  async function lockFromPhraseNodeClick(ph: any) {
    const doc = buildDocFromPhraseNode(ph);
    setLockedDoc(doc);
    alert("Locked to this template.");
  }

  async function lockFromChunkNodeClick(ch: any) {
    const doc = buildDocFromChunkNode(ch);
    setLockedDoc(doc);
    alert("Locked to this template.");
  }

  return (
    <div className={`w-full max-w-6xl mx-auto p-4 ${className ?? ""}`}>
      <Card className="shadow-xl border border-gray-200">
        <CardHeader>
          <CardTitle className="text-xl">Prompter Dev Panel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* ---------- Top Three Columns: Generate/Prompt/Debug ---------- */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Generate Controls */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="seed">Seed (optional)</Label>
                <Input id="seed" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="e.g. session-42" />
              </div>
              <div className="flex flex-col gap-2">
                <Button onClick={handleGenerate} disabled={loading} className="w-full">
                  {loading ? "Generating…" : "Generate"}
                </Button>
                <Button variant="secondary" onClick={handleCopy} disabled={!prompt} className="w-full">
                  Copy Prompt
                </Button>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Use Active Pool</Label>
                  <Switch checked={useActivePool} onCheckedChange={setUseActivePool} />
                </div>
                {prompt && (
                  <Badge variant="outline" className="w-fit">Template: {chosenTemplateId}</Badge>
                )}
              </div>
            </div>

            {/* Generated Prompt */}
            <div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Generated Prompt</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea value={prompt} readOnly className="min-h-[180px] font-mono" />
                </CardContent>
              </Card>
            </div>

            {/* Debug Info */}
            <div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Debug</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-xs grid grid-cols-3 gap-2 mb-2">
                    <div className="rounded bg-gray-100 p-2">
                      <div className="font-medium">Active Phrases</div>
                      <div>{activeCtx?.phrases?.length ?? 0}</div>
                    </div>
                    <div className="rounded bg-gray-100 p-2">
                      <div className="font-medium">Active Chunks</div>
                      <div>{activeCtx?.chunks?.length ?? 0}</div>
                    </div>
                    <div className="rounded bg-gray-100 p-2">
                      <div className="font-medium">Active Words</div>
                      <div>{activeCtx?.words?.length ?? 0}</div>
                    </div>
                  </div>
                  <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-72">{JSON.stringify({ id: chosenTemplateId, templateText, debug }, null, 2)}</pre>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* ---------- Two Columns: Available Patterns / Build from Phrase ---------- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Available Patterns */}
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">Available Patterns (Active Pool)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="pf">Filter</Label>
                    <Input id="pf" value={patternFilter} onChange={(e) => setPatternFilter(e.target.value)} placeholder="Type to filter by text or POS (e.g., lemon or NOUN-VERB)" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">Phrases: {activeCtx?.phrases?.length ?? 0}</Badge>
                    <Badge variant="outline">Chunks: {activeCtx?.chunks?.length ?? 0}</Badge>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Phrases column */}
                  <div>
                    <div className="text-xs font-medium mb-2">Phrases</div>
                    <div className="h-80 overflow-auto rounded border p-2 space-y-2">
                      {(activeCtx?.phrases ?? [])
                        .filter((ph:any) => {
                          const q = patternFilter.trim().toLowerCase();
                          if (!q) return true;
                          return ph.text.toLowerCase().includes(q) || String(ph.posPattern).toLowerCase().includes(q);
                        })
                        .slice(0, 200)
                        .map((ph:any) => (
                          <button
                            key={`ph_${ph.id}`}
                            onClick={() => lockFromPhraseNodeClick(ph)}
                            className="w-full text-left rounded border p-2 hover:bg-gray-50 transition"
                            title="Click to lock this template"
                          >
                            <div className="text-sm font-medium truncate">{ph.text}</div>
                            <div className="text-xs text-gray-500 mt-1">POS: {ph.posPattern}</div>
                          </button>
                        ))}
                    </div>
                  </div>

                  {/* Chunks column */}
                  <div>
                    <div className="text-xs font-medium mb-2">Chunks</div>
                    <div className="h-80 overflow-auto rounded border p-2 space-y-2">
                      {(activeCtx?.chunks ?? [])
                        .filter((ch:any) => {
                          const q = patternFilter.trim().toLowerCase();
                          if (!q) return true;
                          return ch.text.toLowerCase().includes(q) || String(ch.posPattern).toLowerCase().includes(q);
                        })
                        .slice(0, 200)
                        .map((ch:any) => (
                          <button
                            key={`ch_${ch.id}`}
                            onClick={() => lockFromChunkNodeClick(ch)}
                            className="w-full text-left rounded border p-2 hover:bg-gray-50 transition"
                            title="Click to lock this template"
                          >
                            <div className="text-sm font-medium truncate">{ch.text}</div>
                            <div className="text-xs text-gray-500 mt-1">POS: {ch.posPattern}</div>
                            <div className="text-xs text-gray-500">Score: {typeof ch.score === "number" ? ch.score : "—"}</div>
                          </button>
                        ))}
                    </div>
                  </div>
                </div>

                {(activeCtx?.phrases?.length ?? 0) + (activeCtx?.chunks?.length ?? 0) === 0 && (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                    Topic required: There are no phrases/chunks in the active pool. Select a topic first.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Build from Phrase */}
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">Build Template From Phrase</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Label htmlFor="phrase">Paste a phrase (e.g., "dog chases scared cat")</Label>
                <Input id="phrase" value={phraseInput} onChange={(e) => setPhraseInput(e.target.value)} placeholder="Type a phrase…" />
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      setInputError("");
                      const raw = phraseInput.trim();
                      if (!raw) { setInputError("Please enter a phrase."); return; }
                      // Only allow phrases that exist in the ACTIVE POOL (so POS is guaranteed)
                      const match = (activeCtx?.phrases ?? []).find((ph:any) => String(ph.text).toLowerCase() === raw.toLowerCase());
                      if (!match) { setInputError("That phrase isn't in the active pool. Pick one from the list below."); return; }
                      await lockFromPhraseNodeClick(match);
                    }}
                  >
                    Lock Template
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => { setLockedDoc(null); alert("Unlocked—using panel source again."); }}
                  >
                    Unlock
                  </Button>
                </div>
                {inputError && <p className="text-xs text-red-600">{inputError}</p>}
                <p className="text-xs text-gray-600">
                  When locked, Generate will mutate this template only—no new patterns are invented.
                </p>
                {lockedDoc ? (
                  <div className="text-xs rounded bg-gray-100 p-2">
                    <div className="font-medium mb-1">Locked Template</div>
                    <div>{(lockedDoc.blocks[0] as any).phraseText}</div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {/* ---------- Two Columns: Built-in Mutators / POS-based Randomization ---------- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Built-in Mutators */}
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">Built-in Mutators</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Switch checked={useJitter} onCheckedChange={setUseJitter} />
                    <span className="font-medium">Jitter Slots</span>
                  </div>
                  <div className="w-48">
                    <Label className="text-xs">Flip Probability: {jitterP}%</Label>
                    <Slider value={[jitterP]} onValueChange={(v) => setJitterP(v[0] ?? 30)} max={100} step={1} />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Switch checked={useAutoBind} onCheckedChange={setUseAutoBind} />
                    <span className="font-medium">Auto Bind (slot reuse)</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Switch checked={useEnsure2} onCheckedChange={setUseEnsure2} />
                    <span className="font-medium">Ensure ≥ 2 randomized tokens</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Switch checked={useRandNouns} onCheckedChange={setUseRandNouns} />
                    <span className="font-medium">Randomize all NOUN tokens</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* POS-based Randomization */}
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">POS-based Randomization</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-gray-600">Set probability per POS to force tokens of that POS to randomize.</p>
                <div className="grid grid-cols-2 gap-3">
                  {ALL_POS.map((pos) => (
                    <div key={pos} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">{pos} — {posRandomP[pos]}%</Label>
                        <Badge variant={posRandomP[pos] > 0 ? "default" : "outline"}>
                          {posRandomP[pos] > 0 ? "on" : "off"}
                        </Badge>
                      </div>
                      <Slider
                        value={[posRandomP[pos]]}
                        onValueChange={(v) => setPosRandomP((prev) => ({ ...prev, [pos]: v[0] ?? 0 }))}
                        max={100}
                        step={5}
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ---------- Two Columns: Build from Pattern / Phrase Pattern Regex ---------- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Build from Pattern */}
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">Build Template From Pattern</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Label htmlFor="pattern">Type a POS pattern (e.g., <code>[NOUN-VERB-NOUN]</code>)</Label>
                <Input id="pattern" value={patternInput} onChange={(e) => setPatternInput(e.target.value)} placeholder="[NOUN-VERB-NOUN]" />
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      setInputError("");
                      const { ok, normalized, msg } = normalizePatternInput(patternInput);
                      if (!ok || !normalized) { setInputError(msg || "Invalid pattern."); return; }
                      // Build a minimal TemplateDoc with a text block, then parse it (same as Composer)
                      const seedDoc: TemplateDoc = {
                        id: `locked_pattern_${Date.now()}`,
                        createdInSessionId: "devpanel",
                        blocks: [{ kind: "text", text: normalized }]
                      } as any;
                      const parsed = await parseTextPatternsToUTA(seedDoc, graph);
                      setLockedDoc(parsed);
                      alert("Locked to this pattern template.");
                    }}
                  >
                    Lock Pattern
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => { setLockedDoc(null); alert("Unlocked—using panel source again."); }}
                  >
                    Unlock
                  </Button>
                </div>
                {inputError && <p className="text-xs text-red-600">{inputError}</p>}
                <p className="text-xs text-gray-600">
                  Tips: Use either <code>[NOUN-VERB-NOUN]</code> or <code>[DET] [NOUN] [NOUN2]</code>. You can add binds (e.g., NOUN1) and morphs (e.g., VERB:participle).
                </p>
              </CardContent>
            </Card>

            {/* Phrase Pattern Regex */}
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">Phrase Pattern Randomization (Regex)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <div className="md:col-span-2 space-y-2">
                    <Label htmlFor="regex">Regex to match phraseText</Label>
                    <Input id="regex" placeholder="e.g. ^When life" value={regexText} onChange={(e) => setRegexText(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Randomize Probability: {regexRandomizeP}%</Label>
                    <Slider value={[regexRandomizeP]} onValueChange={(v) => setRegexRandomizeP(v[0] ?? 0)} max={100} step={5} />
                  </div>
                </div>
                <p className="text-xs text-gray-600">If the phrase's <code className="bg-gray-100 px-1 rounded">phraseText</code> matches, tokens will be toggled to randomized with the given probability.</p>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}