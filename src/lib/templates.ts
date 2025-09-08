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
  NOUN: ['fb_time','fb_people','fb_way','fb_day','fb_man','fb_thing','fb_world','fb_life','fb_hand','fb_part','fb_child','fb_eye','fb_woman','fb_place','fb_work','fb_week','fb_case','fb_point','fb_government','fb_company'],
  VERB: ['fb_make','fb_do','fb_take','fb_see','fb_come','fb_think','fb_look','fb_want','fb_give','fb_use','fb_find','fb_tell','fb_ask','fb_work','fb_seem','fb_feel','fb_try','fb_leave','fb_call'],
  ADJ: ['fb_good','fb_new','fb_first','fb_last','fb_long','fb_great','fb_little','fb_own','fb_other','fb_old','fb_right','fb_big','fb_high','fb_different','fb_small','fb_large','fb_next','fb_early','fb_young','fb_important'],
  ADV: ['fb_quickly','fb_slowly','fb_really','fb_very','fb_just','fb_now','fb_then','fb_there','fb_here','fb_always','fb_often','fb_sometimes','fb_together','fb_quietly','fb_boldly'],
  ADP: ['fb_in','fb_on','fb_at','fb_by','fb_with','fb_about','fb_against','fb_between','fb_into','fb_through','fb_during','fb_before','fb_after','fb_above','fb_below'],
  DET: ['fb_a','fb_an','fb_the','fb_this','fb_that','fb_these','fb_those','fb_my','fb_your','fb_his','fb_her','fb_its','fb_our','fb_their'],
  PRON: ['fb_I','fb_you','fb_he','fb_she','fb_it','fb_we','fb_they','fb_me','fb_him','fb_her','fb_us','fb_them'],
  PROPN: ['fb_Alice','fb_Paris','fb_Google','fb_Saturday','fb_Indiana','fb_Jesus','fb_Cleveland'],
  AUX: ['fb_is','fb_are','fb_was','fb_were','fb_be','fb_been','fb_being','fb_have','fb_has','fb_had','fb_do','fb_does','fb_did','fb_will','fb_would','fb_can','fb_could','fb_should'],
  CCONJ: ['fb_and','fb_but','fb_or','fb_nor','fb_for','fb_yet','fb_so'],
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
