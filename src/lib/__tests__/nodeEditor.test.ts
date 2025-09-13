import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NodeEditor, updateNodeText } from '../nodeEditor.js';
import { SemanticGraphLite } from '../semanticGraphLite.js';
import { IngestionPipeline } from '../ingest.js';
import { ResponseEngine } from '../respond.js';
import { PromptEngine } from '../promptEngine.js';
import type { 
  PhraseNode, 
  ResponseNode, 
  PromptNode, 
  WordNode,
  TopicNode,
  ContextFrame 
} from '../../types/index.js';

// Mock the dependencies
vi.mock('../ingest.js');
vi.mock('../respond.js');
vi.mock('../promptEngine.js');

describe('NodeEditor', () => {
  let graph: SemanticGraphLite;
  let nodeEditor: NodeEditor;
  let mockContextFrame: ContextFrame;

  beforeEach(() => {
    graph = new SemanticGraphLite();
    nodeEditor = NodeEditor.getInstance();
    mockContextFrame = {
      topicId: 'topic-1',
      sessionId: 'session-1',
      entityBindings: {}
    };

    // Clear any existing nodes
    graph.nodes.clear();
    graph.edges.clear();
  });

  describe('Node Type Validation', () => {
    it('should identify editable node types correctly', () => {
      expect(nodeEditor.isEditableNodeType('PHRASE')).toBe(true);
      expect(nodeEditor.isEditableNodeType('RESPONSE')).toBe(true);
      expect(nodeEditor.isEditableNodeType('PROMPT')).toBe(true);
    });

    it('should identify non-editable node types correctly', () => {
      expect(nodeEditor.isEditableNodeType('WORD')).toBe(false);
      expect(nodeEditor.isEditableNodeType('TOPIC')).toBe(false);
      expect(nodeEditor.isEditableNodeType('SESSION')).toBe(false);
    });

    it('should get correct display names', () => {
      expect(nodeEditor.getNodeTypeDisplayName('PHRASE')).toBe('Phrase');
      expect(nodeEditor.getNodeTypeDisplayName('RESPONSE')).toBe('Response');
      expect(nodeEditor.getNodeTypeDisplayName('PROMPT')).toBe('Prompt');
      expect(nodeEditor.getNodeTypeDisplayName('WORD')).toBe('WORD');
    });
  });

  describe('Protected Node Types', () => {
    it('should reject editing WORD nodes', async () => {
      const wordNode: WordNode = {
        id: 'word-1',
        type: 'WORD',
        text: 'test',
        lemma: 'test',
        pos: ['NOUN'],
        posPotential: ['NOUN'],
        posObserved: { NOUN: 1 },
        primaryPOS: 'NOUN',
        createdAt: Date.now()
      };
      graph.nodes.set('word-1', wordNode);

      const result = await nodeEditor.updateNodeText('word-1', 'new text', graph);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot edit node type: WORD');
      expect(result.updatedNode).toBe(wordNode);
    });

    it('should reject editing TOPIC nodes', async () => {
      const topicNode: TopicNode = {
        id: 'topic-1',
        type: 'TOPIC',
        text: 'test topic',
        lemmas: ['test', 'topic'],
        createdAt: Date.now()
      };
      graph.nodes.set('topic-1', topicNode);

      const result = await nodeEditor.updateNodeText('topic-1', 'new topic', graph);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot edit node type: TOPIC');
      expect(result.updatedNode).toBe(topicNode);
    });
  });

  describe('Phrase Node Editing', () => {
    it('should successfully update phrase node text', async () => {
      const phraseNode: PhraseNode = {
        id: 'phrase-1',
        type: 'PHRASE',
        text: 'old phrase',
        lemmas: ['old', 'phrase'],
        posPattern: 'NOUN NOUN',
        wordIds: ['word-1', 'word-2'],
        createdAt: Date.now()
      };
      graph.nodes.set('phrase-1', phraseNode);

      // Mock IngestionPipeline
      const mockIngestionResult = {
        phrase: {
          id: 'phrase-1',
          type: 'PHRASE' as const,
          text: 'new phrase',
          lemmas: ['new', 'phrase'],
          posPattern: 'ADJ NOUN',
          wordIds: ['word-3', 'word-4'],
          createdAt: Date.now()
        },
        words: [],
        chunks: []
      };

      vi.mocked(IngestionPipeline.getInstance().ingestPhraseText).mockResolvedValue(mockIngestionResult);

      const result = await nodeEditor.updateNodeText('phrase-1', 'new phrase', graph, mockContextFrame);
      
      expect(result.success).toBe(true);
      expect(result.updatedNode.id).toBe('phrase-1'); // ID preserved
      expect((result.updatedNode as PhraseNode).text).toBe('new phrase');
      expect((result.updatedNode as PhraseNode).lemmas).toEqual(['new', 'phrase']);
    });

    it('should remove old word edges before updating phrase', async () => {
      const phraseNode: PhraseNode = {
        id: 'phrase-1',
        type: 'PHRASE',
        text: 'old phrase',
        lemmas: ['old', 'phrase'],
        posPattern: 'NOUN NOUN',
        wordIds: ['word-1', 'word-2'],
        createdAt: Date.now()
      };
      graph.nodes.set('phrase-1', phraseNode);

      // Add some word edges
      graph.addEdge('phrase-1', 'word-1', 'PHRASE_CONTAINS_WORD');
      graph.addEdge('phrase-1', 'word-2', 'PHRASE_CONTAINS_WORD');

      const mockIngestionResult = {
        phrase: {
          id: 'phrase-1',
          type: 'PHRASE' as const,
          text: 'new phrase',
          lemmas: ['new', 'phrase'],
          posPattern: 'ADJ NOUN',
          wordIds: ['word-3', 'word-4'],
          createdAt: Date.now()
        },
        words: [],
        chunks: []
      };

      vi.mocked(IngestionPipeline.getInstance().ingestPhraseText).mockResolvedValue(mockIngestionResult);

      await nodeEditor.updateNodeText('phrase-1', 'new phrase', graph, mockContextFrame);
      
      // Old edges should be removed
      const edges = graph.getEdges();
      const wordEdges = edges.filter(e => e.type === 'PHRASE_CONTAINS_WORD');
      expect(wordEdges).toHaveLength(0);
    });
  });

  describe('Response Node Editing', () => {
    it('should successfully update response node text', async () => {
      const responseNode: ResponseNode = {
        id: 'response-1',
        type: 'RESPONSE',
        text: 'old response',
        lemmas: ['old', 'response'],
        posPattern: 'NOUN NOUN',
        promptId: 'prompt-1',
        wordIds: ['word-1', 'word-2'],
        createdAt: Date.now(),
        rating: 'like'
      };
      graph.nodes.set('response-1', responseNode);

      // Mock ResponseEngine
      const mockResponseResult = {
        responseNode: {
          id: 'response-1',
          type: 'RESPONSE' as const,
          text: 'new response',
          lemmas: ['new', 'response'],
          posPattern: 'ADJ NOUN',
          promptId: 'prompt-1',
          wordIds: ['word-3', 'word-4'],
          createdAt: Date.now(),
          rating: 'like' as const
        },
        wordIds: ['word-3', 'word-4'],
        canPromote: false
      };

      vi.mocked(ResponseEngine.getInstance().processSingleResponse).mockResolvedValue(mockResponseResult);

      const result = await nodeEditor.updateNodeText('response-1', 'new response', graph);
      
      expect(result.success).toBe(true);
      expect(result.updatedNode.id).toBe('response-1'); // ID preserved
      expect((result.updatedNode as ResponseNode).text).toBe('new response');
      expect((result.updatedNode as ResponseNode).lemmas).toEqual(['new', 'response']);
      expect((result.updatedNode as ResponseNode).rating).toBe('like'); // Rating preserved
    });
  });

  describe('Prompt Node Editing', () => {
    it('should successfully update prompt node text', async () => {
      const promptNode: PromptNode = {
        id: 'prompt-1',
        type: 'PROMPT',
        templateText: 'old {slot} template',
        bindings: [],
        createdAt: Date.now()
      };
      graph.nodes.set('prompt-1', promptNode);

      // Mock parseTemplateTextToTokens and buildBindings
      vi.doMock('../parseTemplateText.js', () => ({
        parseTemplateTextToTokens: vi.fn().mockReturnValue({
          tokens: ['new', '{slot}', 'template'],
          slots: ['{slot}']
        }),
        buildBindings: vi.fn().mockReturnValue([
          { slot: '{slot}', fillerNodeId: 'filler-1' }
        ])
      }));

      const result = await nodeEditor.updateNodeText('prompt-1', 'new {slot} template', graph);
      
      expect(result.success).toBe(true);
      expect(result.updatedNode.id).toBe('prompt-1'); // ID preserved
      expect((result.updatedNode as PromptNode).templateText).toBe('new {slot} template');
    });

    it('should remove old filler edges before updating prompt', async () => {
      const promptNode: PromptNode = {
        id: 'prompt-1',
        type: 'PROMPT',
        templateText: 'old {slot} template',
        bindings: [{ slot: '{slot}', fillerNodeId: 'filler-1' }],
        createdAt: Date.now()
      };
      graph.nodes.set('prompt-1', promptNode);

      // Add some filler edges
      graph.addEdge('prompt-1', 'filler-1', 'PROMPT_USES_FILLER', { slot: '{slot}' });

      vi.doMock('../parseTemplateText.js', () => ({
        parseTemplateTextToTokens: vi.fn().mockReturnValue({
          tokens: ['new', '{slot}', 'template'],
          slots: ['{slot}']
        }),
        buildBindings: vi.fn().mockReturnValue([
          { slot: '{slot}', fillerNodeId: 'filler-2' }
        ])
      }));

      await nodeEditor.updateNodeText('prompt-1', 'new {slot} template', graph);
      
      // Old edges should be removed
      const edges = graph.getEdges();
      const fillerEdges = edges.filter(e => e.type === 'PROMPT_USES_FILLER' && e.from === 'prompt-1');
      expect(fillerEdges).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent node', async () => {
      const result = await nodeEditor.updateNodeText('non-existent', 'new text', graph);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle ingestion pipeline errors', async () => {
      const phraseNode: PhraseNode = {
        id: 'phrase-1',
        type: 'PHRASE',
        text: 'old phrase',
        lemmas: ['old', 'phrase'],
        posPattern: 'NOUN NOUN',
        wordIds: ['word-1', 'word-2'],
        createdAt: Date.now()
      };
      graph.nodes.set('phrase-1', phraseNode);

      vi.mocked(IngestionPipeline.getInstance().ingestPhraseText).mockRejectedValue(new Error('Ingestion failed'));

      const result = await nodeEditor.updateNodeText('phrase-1', 'new phrase', graph, mockContextFrame);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Ingestion failed');
    });
  });

  describe('Primary Text Field Extraction', () => {
    it('should extract correct primary text for different node types', () => {
      const phraseNode: PhraseNode = {
        id: 'phrase-1',
        type: 'PHRASE',
        text: 'phrase text',
        lemmas: ['phrase', 'text'],
        posPattern: 'NOUN NOUN',
        wordIds: [],
        createdAt: Date.now()
      };

      const responseNode: ResponseNode = {
        id: 'response-1',
        type: 'RESPONSE',
        text: 'response text',
        lemmas: ['response', 'text'],
        posPattern: 'NOUN NOUN',
        promptId: 'prompt-1',
        wordIds: [],
        createdAt: Date.now()
      };

      const promptNode: PromptNode = {
        id: 'prompt-1',
        type: 'PROMPT',
        templateText: 'template text',
        bindings: [],
        createdAt: Date.now()
      };

      expect(nodeEditor.getPrimaryTextField(phraseNode)).toBe('phrase text');
      expect(nodeEditor.getPrimaryTextField(responseNode)).toBe('response text');
      expect(nodeEditor.getPrimaryTextField(promptNode)).toBe('template text');
    });
  });

  describe('Convenience Function', () => {
    it('should work with convenience function', async () => {
      const phraseNode: PhraseNode = {
        id: 'phrase-1',
        type: 'PHRASE',
        text: 'old phrase',
        lemmas: ['old', 'phrase'],
        posPattern: 'NOUN NOUN',
        wordIds: ['word-1', 'word-2'],
        createdAt: Date.now()
      };
      graph.nodes.set('phrase-1', phraseNode);

      const mockIngestionResult = {
        phrase: {
          id: 'phrase-1',
          type: 'PHRASE' as const,
          text: 'new phrase',
          lemmas: ['new', 'phrase'],
          posPattern: 'ADJ NOUN',
          wordIds: ['word-3', 'word-4'],
          createdAt: Date.now()
        },
        words: [],
        chunks: []
      };

      vi.mocked(IngestionPipeline.getInstance().ingestPhraseText).mockResolvedValue(mockIngestionResult);

      const result = await updateNodeText('phrase-1', 'new phrase', graph, mockContextFrame);
      
      expect(result.success).toBe(true);
      expect((result.updatedNode as PhraseNode).text).toBe('new phrase');
    });
  });
});
