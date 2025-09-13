import { SemanticGraphLite } from './semanticGraphLite.js';
import { IngestionPipeline } from './ingest.js';
import { ResponseEngine } from './respond.js';
import { parseTemplateTextToTokens, buildBindings } from './parseTemplateText.js';
import type { 
  Node, 
  PhraseNode, 
  ResponseNode, 
  PromptNode, 
  ContextFrame 
} from '../types/index.js';

export interface UpdateResult {
  success: boolean;
  updatedNode: Node;
  error?: string;
}

export type EditableNodeType = 'PHRASE' | 'RESPONSE' | 'PROMPT';

export class NodeEditor {
  private static instance: NodeEditor;
  
  static getInstance(): NodeEditor {
    if (!NodeEditor.instance) {
      NodeEditor.instance = new NodeEditor();
    }
    return NodeEditor.instance;
  }

  /**
   * Check if a node type is editable
   */
  isEditableNodeType(nodeType: string): nodeType is EditableNodeType {
    return ['PHRASE', 'RESPONSE', 'PROMPT'].includes(nodeType);
  }

  /**
   * Update node text for editable node types only
   * PROTECTED: WORD, TOPIC, SESSION nodes cannot be edited
   */
  async updateNodeText(
    nodeId: string,
    newText: string,
    graph: SemanticGraphLite,
    contextFrame?: ContextFrame
  ): Promise<UpdateResult> {
    const node = graph.getNode(nodeId);
    if (!node) {
      return {
        success: false,
        updatedNode: node,
        error: `Node ${nodeId} not found`
      };
    }

    // Protect word nodes - they are the backbone of the system
    if (!this.isEditableNodeType(node.type)) {
      return {
        success: false,
        updatedNode: node,
        error: `Cannot edit node type: ${node.type}. Only PHRASE, RESPONSE, and PROMPT nodes can be edited.`
      };
    }

    try {
      switch (node.type) {
        case 'PHRASE':
          return await this.updatePhraseNode(node as PhraseNode, newText, graph, contextFrame);
        case 'RESPONSE':
          return await this.updateResponseNode(node as ResponseNode, newText, graph);
        case 'PROMPT':
          return await this.updatePromptNode(node as PromptNode, newText, graph);
        default:
          return {
            success: false,
            updatedNode: node,
            error: `Unsupported editable node type: ${node.type}`
          };
      }
    } catch (error) {
      return {
        success: false,
        updatedNode: node,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Update phrase node - preserves ID and relationships, regenerates word connections
   */
  private async updatePhraseNode(
    node: PhraseNode, 
    newText: string, 
    graph: SemanticGraphLite, 
    contextFrame?: ContextFrame
  ): Promise<UpdateResult> {
    // 1. Remove old word edges to prevent orphaned connections
    this.removeWordEdges(node.id, graph);
    
    // 2. Process new text using existing ingestion pipeline
    const result = await IngestionPipeline.getInstance().ingestPhraseText(newText, graph, contextFrame);
    
    // 3. Update existing node (preserve ID and relationships)
    const updatedNode = result.phrase;
    updatedNode.id = node.id; // Preserve original ID
    updatedNode.meta = node.meta; // Preserve metadata
    
    // 4. Replace node in graph
    graph.nodes.set(node.id, updatedNode);
    
    return { 
      success: true, 
      updatedNode: updatedNode as Node
    };
  }

  /**
   * Update response node - preserves ID and relationships, regenerates word connections
   */
  private async updateResponseNode(
    node: ResponseNode, 
    newText: string, 
    graph: SemanticGraphLite
  ): Promise<UpdateResult> {
    // 1. Remove old word edges to prevent orphaned connections
    this.removeWordEdges(node.id, graph);
    
    // 2. Process new text using existing response pipeline
    const result = await ResponseEngine.getInstance().processSingleResponse(
      node.promptId, 
      newText, 
      graph, 
      node.rating
    );
    
    // 3. Update existing node (preserve ID and relationships)
    node.text = newText;
    node.lemmas = result.responseNode.lemmas;
    node.posPattern = result.responseNode.posPattern;
    node.wordIds = result.wordIds;
    
    return { 
      success: true, 
      updatedNode: node as Node
    };
  }

  /**
   * Update prompt node - preserves ID and relationships, regenerates filler connections
   */
  private async updatePromptNode(
    node: PromptNode, 
    newText: string, 
    graph: SemanticGraphLite
  ): Promise<UpdateResult> {
    // 1. Parse new template text
    const { tokens, slots } = parseTemplateTextToTokens(newText);
    const bindings = buildBindings(slots, []); // Empty fillers for now
    
    // 2. Remove old filler edges to prevent orphaned connections
    this.removePromptEdges(node.id, graph);
    
    // 3. Update node
    node.templateText = newText;
    node.bindings = bindings;
    
    // 4. Create new filler edges
    bindings.forEach(binding => {
      graph.addEdge(node.id, binding.fillerNodeId, 'PROMPT_USES_FILLER', {
        slot: binding.slot,
      });
    });
    
    return { 
      success: true, 
      updatedNode: node as Node
    };
  }

  /**
   * Remove word edges for a node to prevent orphaned connections
   */
  private removeWordEdges(nodeId: string, graph: SemanticGraphLite): void {
    const edges = graph.getEdges();
    edges.forEach(edge => {
      if (edge.type === 'PHRASE_CONTAINS_WORD' && 
          (edge.from === nodeId || edge.to === nodeId)) {
        graph.removeEdge(edge.id);
      }
    });
  }

  /**
   * Remove prompt filler edges to prevent orphaned connections
   */
  private removePromptEdges(nodeId: string, graph: SemanticGraphLite): void {
    const edges = graph.getEdges();
    edges.forEach(edge => {
      if (edge.type === 'PROMPT_USES_FILLER' && edge.from === nodeId) {
        graph.removeEdge(edge.id);
      }
    });
  }

  /**
   * Get the primary text field for a node type
   */
  getPrimaryTextField(node: Node): string {
    switch (node.type) {
      case 'PHRASE':
        return (node as PhraseNode).text;
      case 'RESPONSE':
        return (node as ResponseNode).text;
      case 'PROMPT':
        return (node as PromptNode).templateText;
      default:
        return '';
    }
  }

  /**
   * Get display name for node type
   */
  getNodeTypeDisplayName(nodeType: string): string {
    switch (nodeType) {
      case 'PHRASE':
        return 'Phrase';
      case 'RESPONSE':
        return 'Response';
      case 'PROMPT':
        return 'Prompt';
      default:
        return nodeType;
    }
  }
}

// Convenience function for external use
export const updateNodeText = async (
  nodeId: string,
  newText: string,
  graph: SemanticGraphLite,
  contextFrame?: ContextFrame
): Promise<UpdateResult> => {
  return NodeEditor.getInstance().updateNodeText(nodeId, newText, graph, contextFrame);
};
