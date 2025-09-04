export interface Template {
  id: string;
  text: string;
  slots: string[];
}

export const TEMPLATES: Template[] = [
  { 
    id: 'NVN', 
    text: '[NOUN] [VERB] [NOUN]', 
    slots: ['NOUN', 'VERB', 'NOUN'] 
  },
  { 
    id: 'AN', 
    text: '[ADJ] [NOUN]', 
    slots: ['ADJ', 'NOUN'] 
  },
  { 
    id: 'VPN', 
    text: '[VERB] [ADP] [NOUN]', 
    slots: ['VERB', 'ADP', 'NOUN'] 
  },
  { 
    id: 'NVA', 
    text: '[NOUN] [VERB] [ADJ]', 
    slots: ['NOUN', 'VERB', 'ADJ'] 
  },
  { 
    id: 'AVN', 
    text: '[ADJ] [VERB] [NOUN]', 
    slots: ['ADJ', 'VERB', 'NOUN'] 
  },
  { 
    id: 'NVD', 
    text: '[NOUN] [VERB] [DET] [NOUN]', 
    slots: ['NOUN', 'VERB', 'DET', 'NOUN'] 
  },
  { 
    id: 'VAN', 
    text: '[VERB] [ADJ] [NOUN]', 
    slots: ['VERB', 'ADJ', 'NOUN'] 
  },
  { 
    id: 'NAV', 
    text: '[NOUN] [ADJ] [VERB]', 
    slots: ['NOUN', 'ADJ', 'VERB'] 
  },
];

import type { POS } from '../types/index.js';

export const wordBank: Record<POS, string[]> = {
  NOUN: ['time','people','way','day','man','thing','world','life','hand','part','child','eye','woman','place','work','week','case','point','government','company'],
  VERB: ['make','do','take','see','come','think','look','want','give','use','find','tell','ask','work','seem','feel','try','leave','call'],
  ADJ: ['good','new','first','last','long','great','little','own','other','old','right','big','high','different','small','large','next','early','young','important'],
  ADV: ['quickly','slowly','really','very','just','now','then','there','here','always','often','sometimes','together','quietly','boldly'],
  ADP: ['in','on','at','by','with','about','against','between','into','through','during','before','after','above','below'],
  DET: ['a','an','the','this','that','these','those','my','your','his','her','its','our','their'],
  PRON: ['I','you','he','she','it','we','they','me','him','her','us','them'],
  PROPN: ['Alice','Paris','Google','Saturday','Indiana','Jesus','Cleveland'],
  AUX: ['is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','can','could','should'],
};

export default wordBank;

// Legacy export for backward compatibility
export const WORD_BANK = wordBank;

export function getTemplateById(id: string): Template | undefined {
  return TEMPLATES.find(template => template.id === id);
}

export function getRandomWordForSlot(slot: string): string {
  const words = wordBank[slot as POS];
  if (!words || words.length === 0) {
    return slot.toLowerCase(); // Fallback to slot name
  }
  return words[Math.floor(Math.random() * words.length)];
}

export function getWordsForSlot(slot: string): string[] {
  return wordBank[slot as POS] || [];
}
