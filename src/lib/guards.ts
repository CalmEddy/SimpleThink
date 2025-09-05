/* eslint-disable no-console */
// Detect POS:Word patterns (like NOUN:Life) - now that : is only used for debug patterns
const WORDY_RE =
  /\b(?:ADJ|ADV|DET|NOUN|PROPN|PRON|VERB|ADP|CCONJ|SCONJ|PART|NUM|INTJ|PUNCT|SYM|X|AUX)\s*:\s*[A-Z][a-zA-Z0-9]*/;

export function assertCanonicalPattern(label: string, val: string) {
  if (import.meta.env.DEV && WORDY_RE.test(val)) {
    console.trace(`[Pattern Debug] ${label}: attempted to set WORDY pattern into canonical field:`, val);
  }
}
