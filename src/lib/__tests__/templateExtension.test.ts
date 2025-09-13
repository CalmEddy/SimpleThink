import { describe, it, expect } from 'vitest';
import { parseTemplateTextToTokens } from '../parseTemplateText.js';

describe('Template Extension - Natural Language Support', () => {
  it('should handle existing templates unchanged', () => {
    const existingTemplate = "[NOUN] [VERB] [NOUN]";
    const tokens = parseTemplateTextToTokens(existingTemplate);
    
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toEqual({
      kind: 'slot',
      pos: 'NOUN',
      raw: '[NOUN]'
    });
    expect(tokens[1]).toEqual({
      kind: 'slot', 
      pos: 'VERB',
      raw: '[VERB]'
    });
    expect(tokens[2]).toEqual({
      kind: 'slot',
      pos: 'NOUN', 
      raw: '[NOUN]'
    });
  });

  it('should handle mixed natural language templates', () => {
    const mixedTemplate = "When would [NOUN] be good?";
    const tokens = parseTemplateTextToTokens(mixedTemplate);
    
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toEqual({
      kind: 'literal',
      surface: 'When would',
      raw: 'When would'
    });
    expect(tokens[1]).toEqual({
      kind: 'slot',
      pos: 'NOUN',
      raw: '[NOUN]'
    });
    expect(tokens[2]).toEqual({
      kind: 'literal',
      surface: 'be good?',
      raw: 'be good?'
    });
  });

  it('should handle complex mixed templates with chunks', () => {
    const complexTemplate = "Can you believe we saw [CHUNK:[NOUN-NOUN]] in public?";
    const tokens = parseTemplateTextToTokens(complexTemplate);
    
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toEqual({
      kind: 'literal',
      surface: 'Can you believe we saw',
      raw: 'Can you believe we saw'
    });
    expect(tokens[1].kind).toBe('subtemplate');
    expect(tokens[1].raw).toBe('[CHUNK:[NOUN-NOUN]]');
    expect(tokens[2]).toEqual({
      kind: 'literal',
      surface: 'in public?',
      raw: 'in public?'
    });
  });

  it('should handle templates with only literal text', () => {
    const textOnlyTemplate = "This is just plain text";
    const tokens = parseTemplateTextToTokens(textOnlyTemplate);
    
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({
      kind: 'literal',
      surface: 'This is just plain text',
      raw: 'This is just plain text'
    });
  });

  it('should handle edge cases with multiple patterns', () => {
    const edgeTemplate = "What [ADJ] [NOUN] did you [VERB:past]?";
    const tokens = parseTemplateTextToTokens(edgeTemplate);
    
    expect(tokens).toHaveLength(6);
    expect(tokens[0]).toEqual({
      kind: 'literal',
      surface: 'What',
      raw: 'What'
    });
    expect(tokens[1]).toEqual({
      kind: 'slot',
      pos: 'ADJ',
      raw: '[ADJ]'
    });
    expect(tokens[2]).toEqual({
      kind: 'slot',
      pos: 'NOUN',
      raw: '[NOUN]'
    });
    expect(tokens[3]).toEqual({
      kind: 'literal',
      surface: 'did you',
      raw: 'did you'
    });
    expect(tokens[4]).toEqual({
      kind: 'slot',
      pos: 'VERB',
      morph: 'past',
      raw: '[VERB:past]'
    });
    expect(tokens[5]).toEqual({
      kind: 'literal',
      surface: '?',
      raw: '?'
    });
  });
});
