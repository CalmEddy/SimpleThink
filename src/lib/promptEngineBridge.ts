/**
 * ⚠️ BRIDGE ONLY — DO NOT BYPASS UTA ⚠️
 *
 * This bridge maintains the existing generateEphemeralPrompts interface
 * but routes all calls through the enhanced PromptEngine.
 */

import { promptEngine } from './promptEngine.js';
import type { EphemeralPrompt } from '../types/index.js';
import type { ContextualNodeSets } from '../contexts/ActiveNodesContext.js';

// 🔒 Hard guard to prevent direct realizeTemplate usage from this module
const DO_NOT_PIPELINE_SPLIT = true;
if (!DO_NOT_PIPELINE_SPLIT) {
  throw new Error("promptEngine misconfiguration: pipeline guard disabled.");
}

/**
 * Bridge function that maintains the existing interface but uses enhanced PromptEngine internally
 */
export async function generateEphemeralPrompts(
  graph: any,
  ctx: ContextualNodeSets,
  sessionId: string,
  count = 20,
  seed?: number,
  templateMixRatio = 0.5
): Promise<EphemeralPrompt[]> {
  // Route through the enhanced PromptEngine
  return await promptEngine.generateEphemeralPromptsEnhanced(graph, ctx, sessionId, count, seed, templateMixRatio);
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
