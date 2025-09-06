import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticGraphLite } from '../semanticGraphLite.js';
import { analyzeWordPOS } from '../posAnalysis.js';

describe('POS Merging Fixes', () => {
  let graph: SemanticGraphLite;

  beforeEach(() => {
    graph = new SemanticGraphLite();
  });

  it('should merge posPotential when updating existing words', async () => {
    // Test 1: Create a word with context-aware POS analysis
    const planAnalysis = await analyzeWordPOS('plan', 'NOUN');
    console.log('Context analysis for "plan":', planAnalysis);
    
    // Test 2: Create word node with context candidates
    const word1 = graph.upsertWord('plan', 'plan', planAnalysis.pos, 'NOUN');
    console.log('Initial word:', {
      lemma: word1.lemma,
      pos: word1.pos,
      posPotential: word1.posPotential,
      primaryPOS: word1.primaryPOS,
      isPolysemousPOS: word1.isPolysemousPOS
    });
    
    // Test 3: Update with additional POS observation
    const word2 = graph.upsertWord('plan', 'plan', [], 'VERB');
    console.log('Updated word:', {
      lemma: word2.lemma,
      pos: word2.pos,
      posPotential: word2.posPotential,
      primaryPOS: word2.primaryPOS,
      isPolysemousPOS: word2.isPolysemousPOS
    });
    
    // Test 4: Verify the word is now polysemous
    expect(word2.posPotential.length).toBeGreaterThan(1);
    expect(word2.isPolysemousPOS).toBe(true);
    expect(word2.posPotential).toContain('NOUN');
    expect(word2.posPotential).toContain('VERB');
  });

  it('should preserve posPotential when merging POS tags', () => {
    // Create initial word with multiple potential POS
    const word1 = graph.upsertWord('run', 'run', ['NOUN', 'VERB'], 'NOUN');
    
    // Update with additional POS observation
    const word2 = graph.upsertWord('run', 'run', ['ADJ'], 'ADJ');
    
    // Verify all POS are preserved
    expect(word2.posPotential).toContain('NOUN');
    expect(word2.posPotential).toContain('VERB');
    expect(word2.posPotential).toContain('ADJ');
    expect(word2.isPolysemousPOS).toBe(true);
  });

  it('should handle context testing for common words', async () => {
    // Test context testing for a word that should be polysemous
    const analysis = await analyzeWordPOS('plan', 'NOUN');
    
    // Should return at least some candidates
    expect(analysis.pos.length).toBeGreaterThan(0);
    
    // For "plan", we expect both NOUN and VERB to be detected
    expect(analysis.pos).toContain('NOUN');
    expect(analysis.pos).toContain('VERB');
    expect(analysis.isPolysemous).toBe(true);
  });
});
