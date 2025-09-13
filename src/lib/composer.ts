import type { TemplateDoc, TemplateBlock, PhraseToken, POS, WordNode, PhraseNode, AnalyzedToken, MorphFeature, TextBlock, PhraseBlock, UnifiedTemplate, TemplateToken } from '../types';
import type { SemanticGraphLite } from './semanticGraphLite';
import { wordBank } from './templates'; // fallback bank
import { TenseConverter } from './tenseConverter';
import { realizeTemplate } from './fillTemplate';
import { RandomizationConfigManager } from './randomization/index.js';

export interface GenerateOptions {
  graph: SemanticGraphLite;
  // Contextual words and phrases from the graph
  words?: WordNode[];
  phrases?: PhraseNode[];
  // Optional: let caller override bank or sampling
  bank?: Partial<Record<POS, string[]>>;
}

/**
 * POS-aware phrase resolver:
 * - Gets contextual POS + lemma per token
 * - Also attaches all potential POS tags for each lemma/word
 * It tries your existing pipeline first (posNormalization/UnifiedTextProcessor), with a safe fallback.
 */
export async function resolvePhraseTokens(phraseText: string, graph: SemanticGraphLite): Promise<PhraseToken[]> {
  const analyzed = await analyzeTextFull(phraseText, graph);
  return analyzed.map(a => ({
    text: a.text,
    lemma: a.lemma,
    pos: a.pos,
    posSet: a.posSet,
    randomize: false,
    slotLabel: null,
  }));
}

/**
 * Analyze arbitrary free text into tokens with lemma, contextual POS, and full POS set.
 * Use this for TextBlock.analysis.
 */
export async function analyzeFreeText(text: string, graph: SemanticGraphLite): Promise<AnalyzedToken[]> {
  return analyzeTextFull(text, graph);
}

export function generateFromDoc(doc: TemplateDoc, opts: GenerateOptions): string {
  // Build contextual word bank from graph data
  const contextualBank = buildContextualWordBank(opts.words, opts.phrases);
  const bank = { ...wordBank, ...contextualBank, ...(opts.bank ?? {}) };
  const labelLemma = new Map<string, { lemma: string; pos: ReturnType<typeof basePOSOf> }>(); // label -> chosen lemma (+ pos)
  const converter = TenseConverter.getInstance();

  const renderToken = async (tok: PhraseToken): Promise<string> => {
    if (!tok.randomize) {
      // Non-randomized tokens stay literal per spec.
      return tok.text;
    }
    const basePOS = basePOSOf(tok.pos, tok.posSet);
    const linked = tok.slotLabel ? labelLemma.get(tok.slotLabel) : undefined;
    let lemma = linked?.lemma;
    let posForLemma = linked?.pos ?? basePOS;
    if (!lemma) {
      const candidate = await chooseFromBank(basePOS);
      lemma = candidate.toLowerCase(); // simple lemma heuristic
      posForLemma = basePOS;
      if (tok.slotLabel) labelLemma.set(tok.slotLabel, { lemma, pos: posForLemma });
    }
    // Morph selection precedence: explicit token.morph > POS variant morph > 'base'
    const morph: MorphFeature | null = tok.morph ?? morphFromPOSVariant(tok.pos) ?? null;
    if (morph && morph !== 'base') {
      if (posForLemma === 'VERB' || posForLemma === 'ADJ' || posForLemma === 'NOUN') {
        try {
          const converted = await converter.convertWord(lemma, posForLemma, morph);
          return converted;
        } catch (error) {
          console.warn(`Morph conversion failed for ${lemma} (${posForLemma}) to ${morph}:`, error);
          return lemma;
        }
      }
    }
    return lemma;
  };

  // Build async then normalize
  const pieces: Array<Promise<string> | string> = [];
  for (const b of doc.blocks) {
    if (b.kind === 'text') {
      pieces.push((b as TextBlock).text);
    } else {
      const pb = b as PhraseBlock;
      const wordPromises = pb.tokens.map(t => renderToken(t));
      pieces.push(Promise.all(wordPromises).then(ws => ws.join(' ')));
    }
  }
  
  // Note: caller expects sync return; keep interface sync by resolving here.
  // If you need purely sync, pre-warm and avoid async. For now, block on promises.
  // Since we cannot await in this function signature, we emulate sync by running a micro-task loop.
  // In React usage we call generateFromDoc inside an effect and set preview from the awaited helper below.
  // However, keep a best-effort immediate string for legacy calls (may contain [pending] markers).
  // To keep API simple, we compute synchronously via deasync-like pattern using Atomics only if available; else return placeholder then a caller-provided effect can refresh. For now, we will do a quick-and-safe synchronous block:
  let final = '';
  const start = Date.now();
  const spin = (p: Promise<string>) => {
    const done = { v: false, out: '' as string };
    p.then(s => ((done.v = true), (done.out = s)));
    // Tight spin up to ~8ms to keep UI responsive; beyond that, return best-effort.
    while (!done.v && Date.now() - start < 8) {}
    return done.v ? done.out : '[…]';
  };
  final = spin(Promise.all(pieces.map(x => (x instanceof Promise ? x : Promise.resolve(x)))).then(vals => vals.join('')));
  // If still pending, caller's preview effect should refresh when generation re-runs.
  return normalizeSpaces(final).trim();
}

// New UTA-based version that uses the unified template architecture
export async function generateFromDocAsync(
  doc: TemplateDoc,
  { graph, bank }: { graph?: SemanticGraphLite; bank?: any }
): Promise<string> {
  console.log('🔍 UTA DEBUG: generateFromDocAsync called with UTA system');
  
  // Convert TemplateDoc to UnifiedTemplate
  const unifiedTemplate = convertTemplateDocToUnified(doc);
  console.log('🔍 UTA DEBUG: Converted to UnifiedTemplate:', unifiedTemplate);
  
  // Get contextual words from graph
  const ctx = {
    words: graph ? graph.getNodesByType('WORD') as WordNode[] : [],
    phrases: graph ? graph.getNodesByType('PHRASE') as PhraseNode[] : []
  };
  console.log('🔍 UTA DEBUG: Context words:', ctx.words.length);
  
  // Use the UTA system to realize the template
  const result = await realizeTemplate({
    tpl: unifiedTemplate,
    ctx,
    lockedSet: new Set(),
    wordBank: { ...wordBank, ...(bank || {}) }
  });
  
  console.log('🔍 UTA DEBUG: UTA result:', result);
  return result.surface;
}

// Convert TemplateDoc format to UnifiedTemplate format
// Exported for Prompter; no behavior change.
export function convertTemplateDocToUnified(doc: TemplateDoc): UnifiedTemplate {
  const tokens: TemplateToken[] = [];
  
  for (const block of doc.blocks) {
    if (block.kind === 'text') {
      // Text blocks become literal tokens
      const textBlock = block as TextBlock;
      if (textBlock.text.trim()) {
        tokens.push({
          kind: 'literal',
          surface: textBlock.text
        });
      }
    } else if (block.kind === 'phrase') {
      // Phrase blocks become subtemplate tokens
      const phraseBlock = block as PhraseBlock;
      const phraseTokens: TemplateToken[] = [];
      
      for (const token of phraseBlock.tokens) {
        if (token.randomize) {
          // Create a slot token
          const pos = token.pos || 'NOUN'; // fallback to NOUN
          const morph = token.morph || undefined;
          const bindId = token.slotLabel || undefined;
          
          phraseTokens.push({
            kind: 'slot',
            pos: pos as any,
            morph: morph as any,
            bindId: bindId
          });
        } else {
          // Create a literal token
          phraseTokens.push({
            kind: 'literal',
            surface: token.text
          });
        }
      }
      
      // Wrap phrase tokens in a subtemplate
      tokens.push({
        kind: 'subtemplate',
        tokens: phraseTokens
      });
    }
  }
  
  return {
    id: doc.id,
    text: serializeTemplateDoc(doc), // Create a text representation
    tokens,
    bindings: undefined, // Will be built by buildBindings if needed
    createdInSessionId: doc.createdInSessionId,
    source: 'user' as const
  };
}

// Helper to serialize TemplateDoc back to text (for the text field)
function serializeTemplateDoc(doc: TemplateDoc): string {
  const pieces: string[] = [];
  
  for (const block of doc.blocks) {
    if (block.kind === 'text') {
      pieces.push((block as TextBlock).text);
    } else if (block.kind === 'phrase') {
      const phraseBlock = block as PhraseBlock;
      const phraseText = phraseBlock.tokens.map(t => t.text).join(' ');
      pieces.push(`[${phraseText}]`); // Wrap phrases in brackets for clarity
    }
  }
  
  return pieces.join('');
}

// Legacy version kept for backward compatibility
export async function generateFromDocAsyncLegacy(
  doc: TemplateDoc,
  { graph }: { graph?: SemanticGraphLite; bank?: any }
): Promise<string> {
  const labelLemma = new Map<string, { lemma: string; pos: ReturnType<typeof basePOSOf> }>();
  const converter = TenseConverter.getInstance();
  const renderToken = async (tok: PhraseToken): Promise<string> => {
    if (!tok.randomize) return tok.text;
    const basePOS = basePOSOf(tok.pos, tok.posSet);
    const linked = tok.slotLabel ? labelLemma.get(tok.slotLabel) : undefined;
    let lemma = linked?.lemma;
    let posForLemma = linked?.pos ?? basePOS;
    if (!lemma) {
      const candidate = await chooseFromBank(basePOS);
      lemma = lemmaHeuristic(candidate);
      posForLemma = basePOS;
      if (tok.slotLabel) labelLemma.set(tok.slotLabel, { lemma, pos: posForLemma });
    }
    const morph: MorphFeature | null = tok.morph ?? morphFromPOSVariant(tok.pos) ?? null;
    if (morph && morph !== 'base' && (posForLemma === 'VERB' || posForLemma === 'ADJ' || posForLemma === 'NOUN')) {
      return converter.convertWord(lemma, posForLemma, morph);
    }
    return lemma;
  };
  const pieces: string[] = [];
  for (const b of doc.blocks) {
    if (b.kind === 'text') pieces.push((b as TextBlock).text);
    else pieces.push((await Promise.all((b as PhraseBlock).tokens.map(renderToken))).join(' '));
  }
  return normalizeSpacing(pieces.join(''));
}

function buildContextualWordBank(words?: WordNode[], phrases?: PhraseNode[]): Partial<Record<POS, string[]>> {
  const bank: Partial<Record<POS, string[]>> = {};
  
  // Add words from graph context
  if (words) {
    words.forEach(word => {
      const pos = word.primaryPOS as POS;
      if (pos) {
        if (!bank[pos]) bank[pos] = [];
        if (!bank[pos]!.includes(word.text)) {
          bank[pos]!.push(word.text);
        }
      }
    });
  }
  
  // Add words from phrases in graph context
  if (phrases) {
    phrases.forEach(phrase => {
      // Extract individual words from phrase text
      const phraseWords = phrase.text.split(/\s+/);
      phraseWords.forEach(wordText => {
        // Find the corresponding word node
        const wordNode = words?.find(w => w.text.toLowerCase() === wordText.toLowerCase());
        if (wordNode) {
          const pos = wordNode.primaryPOS as POS;
          if (pos) {
            if (!bank[pos]) bank[pos] = [];
            if (!bank[pos]!.includes(wordText)) {
              bank[pos]!.push(wordText);
            }
          }
        }
      });
    });
  }
  
  return bank;
}

function normalizeSpaces(s: string) {
  return s.replace(/\s+([,.;:?!])/g, '$1').replace(/\s+/g, ' ');
}

function normalizeSpacing(s: string) {
  return s.replace(/\s+([,.;:?!])/g, '$1').replace(/\s+/g, ' ');
}

function lemmaHeuristic(word: string): string {
  return word.toLowerCase();
}

// ===== Internal: unified analyzer with graceful fallback =====

async function analyzeTextFull(text: string, _graph: SemanticGraphLite): Promise<AnalyzedToken[]> {
  // 1) Try your existing POS normalization/tagging if available
  const viaLocal = await tryAnalyzeViaLocalPipeline(text);
  if (viaLocal?.length) return viaLocal;

  // 2) Try graph hints (if you expose a helper; keep wrapped in try/catch)
  try {
    const words = tokenize(text);
    return words.map(w => ({
      start: w.start, end: w.end, text: w.text,
      lemma: w.text.toLowerCase(),
      pos: ('NOUN' as POS),
      posSet: guessPOSSet(w.text),
    }));
  } catch {
    // 3) Final fallback: naive heuristics
    const words = tokenize(text);
    return words.map(w => ({
      start: w.start, end: w.end, text: w.text,
      lemma: w.text.toLowerCase(),
      pos: ('NOUN' as POS),
      posSet: guessPOSSet(w.text),
    }));
  }
}

async function tryAnalyzeViaLocalPipeline(text: string): Promise<AnalyzedToken[] | null> {
  try {
    // Use your existing NLP pipeline: nlp.ts -> posNormalization.ts
    
    // Create a simple document-like object that tagTextToTokens can work with
    // We'll need to create a winkNLP document, but since we don't have direct access here,
    // we'll use the fallback for now and structure this to be easily replaceable
    
    // Use your existing NLP pipeline through the new helper function
    const { analyzeTextForComposer } = await import('./nlp');
    
    const result = await analyzeTextForComposer(text);
    
    // Convert to AnalyzedToken format
    return result.map(token => ({
      start: token.start,
      end: token.end,
      text: token.text,
      lemma: token.lemma,
      pos: token.pos as POS,
      posSet: token.posSet as POS[]
    }));
  } catch (error) {
    console.warn('[Composer] Failed to use NLP pipeline, falling back to heuristics:', error);
    return null;
  }
}

function normalizeAnalyzed(tokens: any[]): AnalyzedToken[] {
  return tokens.map((t, i) => ({
    start: t.start ?? i,
    end: t.end ?? (i + (t.text?.length ?? 1)),
    text: t.text ?? '',
    lemma: t.lemma ?? t.text?.toLowerCase(),
    pos: t.pos,
    posSet: t.posSet ?? guessPOSSet(t.text ?? '')
  }));
}

function tokenize(text: string): {start:number,end:number,text:string}[] {
  const out: {start:number,end:number,text:string}[] = [];
  let i = 0;
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return out;
}

function guessPOSSet(word: string): POS[] {
  // Lightweight heuristic fallback. Your pipeline will override this in practice.
  const lower = word.toLowerCase();
  const set = new Set<POS>();
  // Baselines
  set.add('NOUN');
  if (/ly$/.test(lower)) set.add('ADV');
  if (/ing$|ed$/.test(lower)) set.add('VERB');
  if (/ous$|ful$|able$|ible$|al$|ic$|ive$|less$|y$/.test(lower)) set.add('ADJ');
  if (['the','a','an','this','that','these','those'].includes(lower)) set.add('DET');
  if (['and','or','but','nor','yet','so'].includes(lower)) set.add('CCONJ');
  if (['in','on','at','with','by','to','from','for','of','over','under'].includes(lower)) set.add('ADP');
  if (/^[A-Z]/.test(word)) set.add('PROPN');
  return Array.from(set);
}

function basePOSOf(pos?: POS, posSet?: POS[]): 'NOUN' | 'VERB' | 'ADJ' | 'ADV' | 'PROPN' | 'AUX' | 'DET' | 'PRON' | 'ADP' | 'CCONJ' {
  const pick = (p?: POS) => (p ? (p.split(':')[0] as any) : undefined);
  const primary = pick(pos);
  if (primary) return primary;
  if (posSet && posSet.length) {
    const candidates = posSet.map(p => pick(p));
    const pref = ['VERB','NOUN','ADJ','ADV','PROPN','AUX','DET','PRON','ADP','CCONJ'] as const;
    for (const t of pref) if (candidates.includes(t as any)) return t as any;
  }
  return 'NOUN';
}

function morphFromPOSVariant(pos?: POS): MorphFeature | null {
  if (!pos) return null;
  const parts = String(pos).split(':');
  if (parts.length < 2) return null;
  const tag = parts[1];
  if (tag === 'past') return 'past';
  if (tag === 'participle') return 'participle';
  if (tag === 'present_3rd') return 'present_3rd';
  if (tag === 'comparative') return 'comparative';
  if (tag === 'superlative') return 'superlative';
  if (tag === 'plural') return 'plural';
  return null;
}

async function chooseFromBank(pos: ReturnType<typeof basePOSOf>): Promise<string> {
  const configManager = RandomizationConfigManager.getInstance();
  const randomizationService = await configManager.createService();
  
  const bank = (wordBank as any)?.[pos];
  if (Array.isArray(bank) && bank.length) {
    return String(randomizationService.pickFromArray(bank) || bank[0]);
  }
  // Use main wordBank as fallback (it should always have words)
  const fallback = (wordBank as any)?.[pos] || (wordBank as any)?.['NOUN'];
  if (Array.isArray(fallback) && fallback.length) {
    return String(randomizationService.pickFromArray(fallback) || fallback[0]);
  }
  // Ultimate fallback to slot name
  return pos.toLowerCase();
}

// === NEW: helpers for the inline editor ===

/** Merge adjacent TextBlocks and drop empty text stubs. */
export function normalizeBlocks(blocks: TemplateBlock[]): TemplateBlock[] {
  const out: TemplateBlock[] = [];
  for (const b of blocks) {
    if (b.kind === 'text') {
      const t = (b as TextBlock).text;
      if (!t) continue;
      const last = out[out.length - 1];
      if (last?.kind === 'text') {
        (last as TextBlock).text += (t as string);
      } else {
        out.push({ kind: 'text', text: t } as TextBlock);
      }
    } else {
      out.push(b);
    }
  }
  // Trim zero-length text at ends
  if (out[0]?.kind === 'text' && !(out[0] as TextBlock).text) out.shift();
  const L = out.length;
  if (L && out[L - 1].kind === 'text' && !(out[L - 1] as TextBlock).text) out.pop();
  return out;
}

/** Build a PhraseBlock from plain phrase text, resolving tokens via pipeline/graph. */
export async function createPhraseBlock(phraseText: string, graph: SemanticGraphLite): Promise<PhraseBlock> {
  const tokens = await resolvePhraseTokens(phraseText, graph);
  return { kind: 'phrase', phraseText, tokens };
}