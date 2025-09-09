/**
 * ⚠️ BRIDGE ONLY — DO NOT BYPASS UTA ⚠️
 *
 * This bridge maintains the existing generateEphemeralPrompts interface
 * but routes all calls through the Prompter (UTA pipeline).
 */

import { Prompter, mutatorJitter30, mutatorAutoBind, mutatorEnsure2Random } from "./prompter/index.js";
import type { TemplateDoc } from '../types/index.js';
import type { SemanticGraphLite } from './semanticGraphLite.js';
import type { ContextualNodeSets, EphemeralPrompt } from '../types/index.js';
import seedrandom from "seedrandom";

// 🔒 Hard guard to prevent direct realizeTemplate usage from this module
const DO_NOT_PIPELINE_SPLIT = true;
if (!DO_NOT_PIPELINE_SPLIT) {
  throw new Error("promptEngine misconfiguration: pipeline guard disabled.");
}

/**
 * Bridge function that maintains the existing interface but uses Prompter internally
 */
export async function generateEphemeralPrompts(
  graph: any,
  ctx: ContextualNodeSets,
  sessionId: string,
  count = 20,
  seed?: number
): Promise<EphemeralPrompt[]> {
  
  // Convert the existing template system to work with Prompter
  // For now, we'll create a simple TemplateDoc from the existing templates
  const templates = getAvailableTemplates(ctx, sessionId);
  
  // Convert UnifiedTemplate[] to TemplateDoc[] for Prompter
  const templateDocs: TemplateDoc[] = templates.map(tpl => ({
    id: tpl.id,
    blocks: [{
      kind: 'text' as const,
      text: tpl.text || '',
      analysis: undefined
    }],
    createdInSessionId: sessionId
  }));

  const rng = seed ? { next: seedrandom(String(seed)) } : undefined;
  const prompter = new Prompter({
    source: templateDocs,
    rng: rng as any,
    mutators: [mutatorJitter30, mutatorAutoBind, mutatorEnsure2Random],
  });

  const out: EphemeralPrompt[] = [];
  const recentTexts = new Set<string>();

  for (let i = 0; i < count; i++) {
    try {
      const { prompt, templateId, templateText, debug } = await prompter.generate({ graph });
      
      // Basic dedupe
      if (recentTexts.has(prompt)) { continue; }
      recentTexts.add(prompt);

      // Create EphemeralPrompt with the same structure as before
      out.push({
        templateId: templateId,
        templateSignature: debug.tokenCount > 0 ? 'UTA-GENERATED' : 'EMPTY',
        text: prompt,
        bindings: [], // Prompter doesn't provide detailed bindings yet
        randomSeed: String(seed ?? 'r' + Math.floor(Math.random() * 1e9)),
      });
    } catch (error) {
      console.warn('Prompter generation failed:', error);
      continue;
    }
  }

  return out;
}

/**
 * 🚫 If anyone adds a new export here that calls realizeTemplate directly,
 * throw loudly so the test suite and manual runs fail fast.
 */
export function __FORBID_DIRECT_REALIZE_TEMPLATE__(): never {
  throw new Error(
    "Direct realizeTemplate usage from promptEngine is forbidden. Use Prompter (UTA) instead."
  );
}

// Import the existing function to avoid circular dependency
import { getAvailableTemplates } from './promptEngine.js';
