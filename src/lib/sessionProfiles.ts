import { PromptGenerationProfile, POS } from '../types/index.js';
import { v4 as uuid } from 'uuid';

const store = new Map<string /*sessionId*/, PromptGenerationProfile[]>();

// Default POS list for initializing profiles
const ALL_POS: POS[] = [
  "NOUN", "VERB", "ADJ", "ADV", "DET", "PRON", "ADP", "AUX", "CONJ", "SCONJ", "PART", "NUM", "INTJ", "PROPN"
] as const as POS[];

export function listSessionProfiles(sessionId: string): PromptGenerationProfile[] {
  return store.get(sessionId) ?? [];
}

export function addSessionProfile(sessionId: string, profile: Omit<PromptGenerationProfile, 'id' | 'createdInSessionId' | 'createdAt'>): PromptGenerationProfile {
  const arr = store.get(sessionId) ?? [];
  const created: PromptGenerationProfile = {
    id: uuid(),
    createdInSessionId: sessionId,
    createdAt: Date.now(),
    ...profile,
  };
  arr.push(created);
  store.set(sessionId, arr);
  return created;
}

export function updateSessionProfile(sessionId: string, profileId: string, patch: Partial<PromptGenerationProfile>): PromptGenerationProfile | undefined {
  const arr = store.get(sessionId);
  if (!arr) return;
  const idx = arr.findIndex(p => p.id === profileId);
  if (idx === -1) return;
  arr[idx] = { ...arr[idx], ...patch };
  store.set(sessionId, arr);
  return arr[idx];
}

export function removeSessionProfile(sessionId: string, profileId: string): void {
  const arr = store.get(sessionId);
  if (!arr) return;
  const next = arr.filter(p => p.id !== profileId);
  store.set(sessionId, next);
}

export function clearSessionProfiles(sessionId: string): void {
  store.delete(sessionId);
}

export function getSessionProfile(sessionId: string, profileId: string): PromptGenerationProfile | undefined {
  const arr = store.get(sessionId);
  if (!arr) return;
  return arr.find(p => p.id === profileId);
}

export function createDefaultProfile(sessionId: string, name: string, description?: string): PromptGenerationProfile {
  const defaultProfile: Omit<PromptGenerationProfile, 'id' | 'createdInSessionId' | 'createdAt'> = {
    name,
    description,
    lastUsedAt: undefined,
    pinned: false,
    tags: [],
    
    // Basic mutator toggles - default to common settings
    useJitter: true,
    jitterP: 30,
    useAutoBind: true,
    useEnsure2: true,
    useRandNouns: false,
    
    // Advanced randomization controls - all off by default
    useMaxRandomization: false,
    maxRandomSlots: 2,
    usePositionBasedRandom: false,
    targetPOS: 'NOUN',
    targetPosition: 1,
    useClickableSelection: false,
    selectedPhraseId: undefined,
    selectedWordIndices: [],
    
    // POS-based randomization - all off by default
    posRandomP: ALL_POS.reduce((acc, pos) => (acc[pos] = 0, acc), {} as Record<POS, number>),
    
    // Regex-based randomization - off by default
    regexText: '',
    regexRandomizeP: 0,
    
    // Source configuration - use active pool by default
    useActivePool: true,
    lockedTemplateId: undefined,
    
    // RNG seed - empty by default
    seed: '',
  };
  
  return addSessionProfile(sessionId, defaultProfile);
}

export function duplicateProfile(sessionId: string, profileId: string, newName: string): PromptGenerationProfile | undefined {
  const original = getSessionProfile(sessionId, profileId);
  if (!original) return;
  
  const duplicated: Omit<PromptGenerationProfile, 'id' | 'createdInSessionId' | 'createdAt'> = {
    ...original,
    name: newName,
    description: original.description ? `${original.description} (copy)` : undefined,
    lastUsedAt: undefined,
  };
  
  return addSessionProfile(sessionId, duplicated);
}

export function markProfileAsUsed(sessionId: string, profileId: string): void {
  updateSessionProfile(sessionId, profileId, { lastUsedAt: Date.now() });
}

export function getPinnedProfiles(sessionId: string): PromptGenerationProfile[] {
  const profiles = listSessionProfiles(sessionId);
  return profiles.filter(p => p.pinned);
}

export function toggleProfilePinned(sessionId: string, profileId: string): PromptGenerationProfile | undefined {
  const profile = getSessionProfile(sessionId, profileId);
  if (!profile) return;
  return updateSessionProfile(sessionId, profileId, { pinned: !profile.pinned });
}
