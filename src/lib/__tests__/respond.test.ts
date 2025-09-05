import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticGraphLite } from '../semanticGraphLite.js';
import { ResponseEngine } from '../respond.js';

describe('Response Engine', () => {
  let graph: SemanticGraphLite;
  let responseEngine: ResponseEngine;

  beforeEach(() => {
    graph = new SemanticGraphLite();
    responseEngine = ResponseEngine.getInstance();
  });

  it('should handle multi-word proper nouns correctly in responses (Mother Nature)', async () => {
    const result = await responseEngine.recordResponse(
      'test-prompt-id',
      "Lemons are Mother Nature's whoopee cushions — funny, but inconvenient.",
      graph
    );
    
    // Should create a compound "mother nature" node
    const words = graph.getNodesByType('WORD');
    const motherNatureNode = words.find(w => w.text === 'mother nature');
    
    expect(motherNatureNode).toBeDefined();
    expect(motherNatureNode.pos).toContain('PROPN');
    
    // Should NOT create standalone "mother", "nature", or "'s" nodes
    const motherNode = words.find(w => w.text === 'mother');
    const natureNode = words.find(w => w.text === 'nature');
    const possessiveNode = words.find(w => w.text === "'s");
    
    expect(motherNode).toBeUndefined();
    expect(natureNode).toBeUndefined();
    expect(possessiveNode).toBeUndefined();
  });

  it('should handle multi-word proper nouns correctly in responses (Andrew Jackson)', async () => {
    const result = await responseEngine.recordResponse(
      'test-prompt-id',
      "Lemons made Andrew Jackson sit up and take notice.",
      graph
    );
    
    // Should create a compound "andrew jackson" node
    const words = graph.getNodesByType('WORD');
    const andrewJacksonNode = words.find(w => w.text === 'andrew jackson');
    
    expect(andrewJacksonNode).toBeDefined();
    expect(andrewJacksonNode.pos).toContain('PROPN');
    
    // Should NOT create standalone "andrew" or "jackson" nodes
    const andrewNode = words.find(w => w.text === 'andrew');
    const jacksonNode = words.find(w => w.text === 'jackson');
    
    expect(andrewNode).toBeUndefined();
    expect(jacksonNode).toBeUndefined();
  });
});
