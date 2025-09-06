import { analyzeWordPOS } from '../../src/lib/posAnalysis.js';
import type { SemanticGraphLite } from '../../src/lib/semanticGraphLite.js';

export async function recomputeWordPOS(graph: SemanticGraphLite, wordKey: string): Promise<void> {
  const k = wordKey.toLowerCase();
  const node = graph.findWordByLemma(k);
  if (!node) {
    console.warn(`Word "${wordKey}" not found in graph`);
    return;
  }
  
  console.log(`Recomputing POS for word: ${k}`);
  const analysis = await analyzeWordPOS(k, node.primaryPOS || 'NOUN');
  console.log(`New potential POS:`, analysis.pos);
  
  // Update the word with new context-aware POS analysis
  const updatedWord = graph.upsertWord(k, node.text || k, analysis.pos, undefined);
  updatedWord.isPolysemousPOS = analysis.isPolysemous;
  updatedWord.posPotential = analysis.pos;
  updatedWord.posPotentialSource = [analysis.source];
  
  console.log(`Updated word "${k}" with new POS potential`);
}

export async function recomputeAllWordPOS(graph: SemanticGraphLite): Promise<void> {
  const words = graph.getNodesByType('WORD');
  console.log(`Recomputing POS for ${words.length} words...`);
  
  let updated = 0;
  for (const word of words) {
    if (word.type === 'WORD') {
      const wordNode = word as any; // Type assertion for WordNode
      const analysis = await analyzeWordPOS(wordNode.lemma, wordNode.primaryPOS || 'NOUN');
      
      // Only update if we got new potential POS tags
      if (analysis.pos.length > 0) {
        const updatedWord = graph.upsertWord(wordNode.lemma, wordNode.text || wordNode.lemma, analysis.pos, undefined);
        updatedWord.isPolysemousPOS = analysis.isPolysemous;
        updatedWord.posPotential = analysis.pos;
        updatedWord.posPotentialSource = [analysis.source];
        updated++;
      }
    }
  }
  
  console.log(`Updated ${updated} words with new POS potential`);
}

// Convenience function to recompute specific common words
export async function recomputeCommonWords(graph: SemanticGraphLite): Promise<void> {
  const commonWords = ['plan', 'run', 'walk', 'talk', 'work', 'play', 'help', 'make', 'take', 'give'];
  
  console.log('Recomputing POS for common words...');
  for (const word of commonWords) {
    await recomputeWordPOS(graph, word);
  }
}
