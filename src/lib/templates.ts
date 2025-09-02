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

// Word bank for filling missing slots
export const WORD_BANK: Record<string, string[]> = {
  NOUN: [
    'idea', 'concept', 'solution', 'problem', 'challenge', 'opportunity',
    'innovation', 'creativity', 'imagination', 'inspiration', 'vision',
    'dream', 'goal', 'purpose', 'mission', 'journey', 'adventure',
    'discovery', 'breakthrough', 'success', 'achievement', 'progress',
    'growth', 'development', 'evolution', 'transformation', 'change',
    'future', 'present', 'past', 'time', 'space', 'world', 'universe',
    'life', 'love', 'hope', 'joy', 'peace', 'freedom', 'truth',
    'beauty', 'wisdom', 'knowledge', 'learning', 'teaching', 'sharing',
    'connection', 'relationship', 'community', 'family', 'friendship',
    'collaboration', 'partnership', 'team', 'group', 'organization',
    'company', 'business', 'project', 'work', 'play', 'fun', 'happiness'
  ],
  VERB: [
    'create', 'build', 'make', 'design', 'develop', 'invent', 'discover',
    'explore', 'investigate', 'analyze', 'understand', 'learn', 'teach',
    'share', 'communicate', 'connect', 'collaborate', 'cooperate', 'help',
    'support', 'encourage', 'inspire', 'motivate', 'empower', 'enable',
    'facilitate', 'guide', 'lead', 'direct', 'manage', 'organize',
    'plan', 'strategize', 'think', 'imagine', 'dream', 'visualize',
    'envision', 'conceive', 'generate', 'produce', 'deliver', 'achieve',
    'accomplish', 'succeed', 'excel', 'improve', 'enhance', 'optimize',
    'transform', 'change', 'evolve', 'grow', 'develop', 'progress',
    'advance', 'move', 'travel', 'journey', 'explore', 'adventure',
    'experience', 'feel', 'sense', 'perceive', 'observe', 'notice',
    'recognize', 'appreciate', 'value', 'love', 'care', 'nurture'
  ],
  ADJ: [
    'creative', 'innovative', 'original', 'unique', 'special', 'extraordinary',
    'amazing', 'wonderful', 'fantastic', 'brilliant', 'genius', 'clever',
    'smart', 'intelligent', 'wise', 'insightful', 'profound', 'deep',
    'meaningful', 'significant', 'important', 'valuable', 'precious',
    'beautiful', 'gorgeous', 'stunning', 'magnificent', 'splendid',
    'excellent', 'outstanding', 'remarkable', 'impressive', 'powerful',
    'strong', 'resilient', 'flexible', 'adaptable', 'versatile',
    'dynamic', 'energetic', 'vibrant', 'lively', 'active', 'engaging',
    'inspiring', 'motivating', 'encouraging', 'supportive', 'helpful',
    'kind', 'generous', 'compassionate', 'empathetic', 'understanding',
    'patient', 'calm', 'peaceful', 'serene', 'tranquil', 'harmonious',
    'balanced', 'stable', 'reliable', 'trustworthy', 'honest', 'authentic',
    'genuine', 'real', 'true', 'pure', 'clear', 'transparent', 'open'
  ],
  ADP: [
    'with', 'for', 'to', 'from', 'in', 'on', 'at', 'by', 'through',
    'across', 'over', 'under', 'above', 'below', 'beside', 'near',
    'around', 'about', 'concerning', 'regarding', 'regarding', 'toward',
    'towards', 'into', 'onto', 'upon', 'within', 'without', 'against',
    'among', 'between', 'during', 'before', 'after', 'since', 'until'
  ],
  DET: [
    'the', 'a', 'an', 'this', 'that', 'these', 'those', 'some', 'any',
    'all', 'every', 'each', 'no', 'my', 'your', 'his', 'her', 'its',
    'our', 'their', 'one', 'another', 'other', 'such', 'same', 'different'
  ]
};

export function getTemplateById(id: string): Template | undefined {
  return TEMPLATES.find(template => template.id === id);
}

export function getRandomWordForSlot(slot: string): string {
  const words = WORD_BANK[slot];
  if (!words || words.length === 0) {
    return slot.toLowerCase(); // Fallback to slot name
  }
  return words[Math.floor(Math.random() * words.length)];
}

export function getWordsForSlot(slot: string): string[] {
  return WORD_BANK[slot] || [];
}
