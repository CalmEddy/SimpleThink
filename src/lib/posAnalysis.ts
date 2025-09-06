import { testWordInContexts } from './nlp.js';

export interface WordPOSAnalysis {
  pos: string[];
  isPolysemous: boolean;
  source: 'wink' | 'polysemy-test' | 'fallback';
}

export async function analyzeWordPOS(lemma: string, observedPOS: string): Promise<WordPOSAnalysis> {
  const initialPOS = observedPOS || 'NOUN';
  
  try {
    const contextTest = await testWordInContexts(lemma);
    
    if (contextTest.isPolysemous && contextTest.uniquePOS.length > 1) {
      return {
        pos: contextTest.uniquePOS,
        isPolysemous: true,
        source: 'polysemy-test'
      };
    } else {
      return {
        pos: [initialPOS],
        isPolysemous: false,
        source: 'wink'
      };
    }
  } catch (error) {
    console.warn(`Polysemy testing failed for "${lemma}":`, error);
    return {
      pos: [initialPOS],
      isPolysemous: false,
      source: 'fallback'
    };
  }
}
