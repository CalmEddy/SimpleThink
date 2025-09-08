export type NodeId = string;
export type EdgeId = string;

export type NodeType = 'WORD' | 'PHRASE' | 'PROMPT' | 'RESPONSE' | 'TOPIC' | 'SESSION';

// POS type for template system
export type POS = 'NOUN' | 'VERB' | 'VERB:participle' | 'VERB:past' | 'VERB:present_3rd' | 'ADJ' | 'ADJ:comparative' | 'ADJ:superlative' | 'ADV' | 'ADP' | 'DET' | 'PRON' | 'PROPN' | 'AUX' | 'CCONJ';

export interface WordNode {
  id: NodeId;
  type: 'WORD';
  text: string;          // raw text
  lemma: string;
  pos: string[];         // canonical POS for the word
  originalForm?: string;        // original token as it appeared
  morphFeature?: string;       // morphological feature from winkNLP
  
  // NEW fields for POS polysemy detection
  posPotential: string[];                // possible POS (NOUN/VERB/ADJ/ADV/PROPN/…)
  posPotentialSource?: string[];         // ["heuristic","wink","wordnet"] (optional provenance)
  posPotentialLastAuditedAt?: number;    // Date.now() when last computed
  posObserved: Record<string, number>;   // counts from real usage, e.g. { NOUN: 5, VERB: 2 }
  primaryPOS: string;                    // derived: highest observed count (fallback: first in posPotential)
  isPolysemousPOS: boolean;              // derived: true if ≥2 POS pass threshold
  
  stats?: { uses: number; likes: number };
}

export interface PhraseChunk {
  id: string;            // parentPhraseId:span or hash
  text: string;
  lemmas: string[];
  posPattern: string;    // e.g., "ADJ-NOUN" / "VERB-NOUN" / "ADP+NP"
  span: [number, number]; // token indices within parent phrase
  score: number;         // quality score for ranking/promotion
}

export interface PhraseNode {
  id: NodeId;
  type: 'PHRASE';
  text: string;
  lemmas: string[];
  posPattern: string;    // canonical pattern of the full phrase
  wordIds: NodeId[];     // connected WORD ids
  chunks: PhraseChunk[]; // lightweight sub-phrases (annotations)
  stats?: { uses: number; likes: number };
  derivedFromId?: NodeId; // provenance when promoted from a chunk
  meta?: Record<string, any>;
}

export interface PromptSlotBinding {
  slot: string;          // e.g., "NOUN", "VERB"
  fillerNodeId: NodeId;  // the node used to fill the slot
}

export interface PromptNode {
  id: NodeId;
  type: 'PROMPT';
  templateId: string;         // e.g., "NOUN-VERB-NOUN"
  templateText: string;       // human-readable
  bindings: PromptSlotBinding[];
  createdAt: number;
  sessionId?: string;
}

export interface ResponseNode {
  id: NodeId;
  type: 'RESPONSE';
  text: string;
  lemmas: string[];
  posPattern: string;
  promptId: NodeId;
  wordIds: NodeId[];
  createdAt: number;
  rating?: 'like' | 'skip';
}

export interface TopicNode {
  id: NodeId;
  type: 'TOPIC';
  text: string;                 // canonical premise
  lemmas: string[];             // content lemmas
  posPattern?: string;
  keywords?: string[];          // optional: top 2–3
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, any>;
}

export interface SessionNode {
  id: NodeId;
  type: 'SESSION';
  topicId: string;
  startedAt: number;
  endedAt?: number;
  entityBindings?: Record<string, { referent: string; kind?: 'person'|'place'|'thing'; aliases?: string[] }>;
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, any>;
}

export type EdgeType =
  | 'PHRASE_CONTAINS_WORD'   // PHRASE -> WORD
  | 'PROMPT_USES_FILLER'     // PROMPT -> WORD/PHRASE for slot bindings
  | 'RESPONSE_ANSWERS_PROMPT'// RESPONSE -> PROMPT
  | 'DERIVED_FROM'           // PHRASE(child) -> PHRASE(parent)
  | 'PHRASE_ABOUT_TOPIC'     // Phrase|Prompt|Response -> Topic
  | 'CREATED_IN_SESSION'     // Phrase|Prompt|Response -> Session
  | 'SESSION_OF_TOPIC';      // Session -> Topic

export interface Edge {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  type: EdgeType;
  meta?: Record<string, unknown>;
}

export interface GraphJSON {
  nodes: (WordNode | PhraseNode | PromptNode | ResponseNode | TopicNode | SessionNode)[];
  edges: Edge[];
  version: number;
}

export type Node = WordNode | PhraseNode | PromptNode | ResponseNode | TopicNode | SessionNode;

// Template system types
export interface SlotDescriptor {
  kind?: 'slot' | 'chunk';
  pos: POS; // For kind==='slot' it is the POS; for kind==='chunk' pos is ignored
  /** Numbering for per-POS repeated slots, e.g., NOUN1, NOUN2 */
  index?: number; // 1-based
  /** For chunk slots, a concrete pattern like "ADJ NOUN ADP NOUN" */
  chunkPattern?: string;
  /**
   * Optional morphological feature requested by the user for this slot.
   * Examples: 'past', 'participle', 'present_3rd', 'comparative', 'superlative'
   * Backward-compatible: older templates won't set this.
   */
  morph?: MorphFeature | null;
  /**
   * Optional raw token text for this slot (e.g., "VERB1:past") preserved for debugging/validation.
   */
  raw?: string;
}

export interface UserTemplate {
  id: string;
  text: string;              // e.g., "[NOUN1 VERB NOUN1]" or "[ADJ NOUN ADP NOUN]"
  slots: SlotDescriptor[];   // ordered slots
  createdInSessionId: string;
  baseText?: string;         // original phrase text when available
  pinned?: boolean;          // user-locked template (hard priority)
  tags?: string[];
}

export type MorphFeature =
  | 'base'
  | 'past'
  | 'participle'
  | 'present_3rd'
  | 'comparative'
  | 'superlative'
  | 'plural';

// ===== Composer types (new, additive) =====
export type SlotLabel = string; // e.g., "1", "A"

export interface TextBlock {
  kind: 'text';
  text: string;
  /**
   * Optional live analysis of the free text. Not rendered; used for context,
   * topic filters, or future click-to-slot on free text if desired.
   */
  analysis?: AnalyzedToken[];
}

export interface PhraseToken {
  text: string;        // surface form
  lemma?: string;
  /**
   * Contextual POS tag for this specific occurrence (what the tagger decided here).
   */
  pos?: POS;
  /**
   * All plausible POS tags this word/lemma can take in your system.
   * Kept in addition to `pos` so selection/randomization can prefer context while knowing options.
   */
  posSet?: POS[];
  randomize?: boolean; // toggled by click
  slotLabel?: SlotLabel | null; // link multiple tokens to reuse same pick
  // When set, randomized outputs should be converted to this morphological form.
  morph?: MorphFeature | null;
}

export interface PhraseBlock {
  kind: 'phrase';
  phraseText: string;  // original phrase as in graph
  tokens: PhraseToken[];
  phraseId?: string;   // optional: graph id for faster lookups
}

export type TemplateBlock = TextBlock | PhraseBlock;

export interface TemplateDoc {
  id: string;
  blocks: TemplateBlock[];
  createdInSessionId: string;
}

export interface SessionLocks {
  lockedWordIds?: string[];     // WordNode ids
  lockedChunkIds?: string[];    // Chunk ids
  lockedTemplateIds?: string[]; // Template ids
}

export interface ChunkShape {
  id: string;
  pattern: string; // e.g., "ADJ NOUN ADP NOUN"
  text: string;    // visible sub-phrase text
  phraseId: string;
}

// Ephemeral prompt for generation preview / response storage handoff
export interface EphemeralPrompt {
  templateId: string;
  templateSignature: string; // e.g., "ADV-NOUN-NOUN-PRON-NOUN-VERB-NOUN" or chunk pattern
  text: string;              // rendered prompt text
  bindings: Array<{
    slot: SlotDescriptor;
    nodeId?: string;  // graph node id used
    bank?: string;    // if filled from word bank
  }>;
  randomSeed: string;
  sourcePhraseIds?: string[];
  sourceChunkIds?: string[];
}

export interface AnalyzedToken {
  start: number;        // start index in TextBlock.text
  end: number;          // end index (exclusive)
  text: string;         // surface
  lemma?: string;
  pos?: POS;            // contextual tag for this occurrence
  posSet?: POS[];       // all plausible tags for this lemma/word
}
