export type NodeId = string;
export type EdgeId = string;

export type NodeType = 'WORD' | 'PHRASE' | 'PROMPT' | 'RESPONSE';

export interface WordNode {
  id: NodeId;
  type: 'WORD';
  text: string;          // raw text
  lemma: string;
  pos: string[];         // canonical POS for the word
  
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

export type EdgeType =
  | 'PHRASE_CONTAINS_WORD'   // PHRASE -> WORD
  | 'PROMPT_USES_FILLER'     // PROMPT -> WORD/PHRASE for slot bindings
  | 'RESPONSE_ANSWERS_PROMPT'// RESPONSE -> PROMPT
  | 'DERIVED_FROM';          // PHRASE(child) -> PHRASE(parent)

export interface Edge {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  type: EdgeType;
  meta?: Record<string, unknown>;
}

export interface GraphJSON {
  nodes: (WordNode | PhraseNode | PromptNode | ResponseNode)[];
  edges: Edge[];
  version: number;
}

export type Node = WordNode | PhraseNode | PromptNode | ResponseNode;
