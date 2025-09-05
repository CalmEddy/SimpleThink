/* eslint-disable no-console */
import { buildPosPattern } from '../lib/patterns.js';

// Detect POS:Word patterns (like NOUN:Life) - now that : is only used for debug patterns
const WORDY_RE =
  /\b(?:ADJ|ADV|DET|NOUN|PROPN|PRON|VERB|ADP|CCONJ|SCONJ|PART|NUM|INTJ|PUNCT|SYM|X|AUX)\s*:\s*[A-Z][a-zA-Z0-9]*/;

export async function migratePatterns(graph: any) {
  const phrases = await graph.getAllPhrases?.() ?? [];
  let fixed = 0;
  for (const ph of phrases) {
    if (typeof ph.posPattern === 'string' && WORDY_RE.test(ph.posPattern)) {
      const canonical = buildPosPattern(ph.pos, ph.morphFeatures ?? []);
      await graph.updatePhrase(ph.id, { posPattern: canonical });
      fixed++;
      console.log(`[Migration] Fixed phrase ${ph.id}: ${ph.posPattern} → ${canonical}`);
    }
  }
  console.log(`[Pattern Debug] Migrated ${fixed} phrases to canonical posPattern`);

  // Optional: clear caches/service worker
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
    console.log('[Pattern Debug] Service workers unregistered');
  }
}
