import type { TemplateDoc, TemplateBlock, PhraseBlock, PhraseToken, POS } from "../../types/index.js";
import type { SemanticGraphLite } from "../semanticGraphLite.js";
import { resolvePhraseTokens } from "../composer.js";

/**
 * Build TemplateDoc[] from PHRASE and CHUNK nodes equally.
 * - PHRASE: we resolve tokens from text to preserve POS exactly like Composer.
 * - CHUNK: if node has text -> resolve tokens; else if it has a posPattern, we
 *   construct slot tokens from that stored pattern (this is NOT inventing a pattern;
 *   it's using the stored chunk pattern).
 */
export async function templateDocsFromGraph(
  graph: SemanticGraphLite,
  opts?: {
    limit?: number;
    shuffle?: boolean;
    filter?:(node:any)=>boolean;
    includeTypes?: Array<"PHRASE"|"CHUNK">;
  }
): Promise<TemplateDoc[]> {
  if (!graph) return [];
  const include = new Set(opts?.includeTypes ?? ["PHRASE","CHUNK"]);
  const acc: any[] = [];
  if (include.has("PHRASE")) {
    const phrases = (graph.getNodesByType?.("PHRASE") ?? []) as any[];
    acc.push(...phrases);
  }
  if (include.has("CHUNK")) {
    const chunks = (graph.getNodesByType?.("CHUNK") ?? []) as any[];
    acc.push(...chunks);
  }
  const list = opts?.filter ? acc.filter(opts.filter) : acc.slice();
  if (opts?.shuffle) {
    // Use unified randomization service for consistent shuffling
    const { RandomizationConfigManager } = await import('../randomization/index.js');
    const configManager = RandomizationConfigManager.getInstance();
    const randomizationService = await configManager.createService();
    list.sort(() => randomizationService.pickFromArray([-1, 1])!);
  }
  const trimmed = typeof opts?.limit === "number" ? list.slice(0, opts.limit) : list;

  const docs: TemplateDoc[] = [];
  for (const node of trimmed) {
    const phraseText: string | undefined = node.text ?? node.surface ?? node.phraseText;
    let block: PhraseBlock | null = null;

    if (phraseText && phraseText.trim()) {
      // Resolve from text (Composer-normalized tokens with POS)
      const tokens = await resolvePhraseTokens(phraseText.trim(), graph);
      block = {
        kind: "phrase",
        phraseText: phraseText.trim(),
        tokens: tokens.map(t => ({
          ...t,
          randomize: false,
          slotLabel: null,
          morph: t.morph ?? null
        }))
      };
    } else if (node.posPattern && typeof node.posPattern === "string") {
      // Stored CHUNK pattern (e.g. "NOUN-VERB-ADJ"); treat as slot tokens with POS
      const parts = String(node.posPattern).split("-").map((s:string) => s.trim()).filter(Boolean);
      const tokens: PhraseToken[] = parts.map((p:string) => ({
        text: `[${p}]`,
        lemma: "",
        pos: p as POS,
        posSet: [p as POS],
        randomize: true,
        slotLabel: null,
        morph: null
      }));
      block = {
        kind: "phrase",
        phraseText: `[${node.posPattern}]`,
        tokens
      };
    }

    if (!block) continue;

    docs.push({
      id: node.id ?? `doc_${Math.random().toString(36).slice(2,7)}`,
      blocks: [block as TemplateBlock],
      createdInSessionId: node.createdInSessionId ?? "from-graph"
    });
  }
  return docs;
}
