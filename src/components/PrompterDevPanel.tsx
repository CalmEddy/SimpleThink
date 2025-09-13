import React, { useMemo, useState, useEffect } from "react";
import seedrandom from "seedrandom";
import type { TemplateDoc, TemplateBlock, PhraseBlock, PhraseToken, POS, PromptGenerationProfile } from "../types/index.js";
import type { SemanticGraphLite } from "../lib/semanticGraphLite.js";
import { Prompter, mutatorAutoBind, mutatorEnsure2Random, mutatorRandomizeNouns, type TemplateSource, type TemplateMutator } from "../lib/prompter/index.js";
import { parseTextPatternsToUTA } from "./ComposerEditor";
import { useActiveNodesWithGraph } from "../contexts/ActiveNodesContext";
import { promptEngine } from "../lib/promptEngine.js";
import { RandomizationConfigManager } from "../lib/randomization/index.js";
import { 
  listSessionProfiles, 
  addSessionProfile, 
  updateSessionProfile,
  removeSessionProfile, 
  getSessionProfile,
  createDefaultProfile,
  duplicateProfile,
  markProfileAsUsed,
  getPinnedProfiles,
  toggleProfilePinned,
  ensureDefaultProfileExists
} from "../lib/sessionProfiles.js";
import { getSessionLocks, setSessionLocks } from "../lib/sessionLocks.js";
// NOTE: We intentionally avoid resolvePhraseTokens to prevent runtime errors.

/**
 * PrompterDevPanel
 * A playground to tinker with template mutations and generate prompts using the existing UTA pipeline.
 * - Toggle built-in mutators
 * - Configure POS-based randomization (probabilities per POS)
 * - Configure regex-based phrase targeting and randomization
 * - Set RNG seed for determinism
 * - Generate prompt + inspect debug
 */

interface PrompterDevPanelProps {
  source: TemplateSource;
  graph?: SemanticGraphLite;
  bank?: Record<string, string[]>;
  className?: string;
}

// ---------- Utility: POS list for controls ----------
const ALL_POS: POS[] = [
  "NOUN", "VERB", "ADJ", "ADV", "DET", "PRON", "ADP", "AUX", "CONJ", "SCONJ", "PART", "NUM", "INTJ", "PROPN"
] as const as POS[];
const ALLOWED_POS = new Set(ALL_POS); // includes DET, PROPN, etc.

// Simple UI Components that match the existing styling
const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`card rounded-lg p-6 shadow-lg ${className}`}>
    {children}
  </div>
);

const CardHeader: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`mb-4 ${className}`}>
    {children}
  </div>
);

const CardTitle: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <h3 className={`text-lg font-semibold text-gray-800 ${className}`}>
    {children}
  </h3>
);

const CardContent: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={className}>
    {children}
  </div>
);

const Button: React.FC<{ 
  children: React.ReactNode; 
  onClick?: () => void; 
  disabled?: boolean; 
  variant?: 'primary' | 'secondary';
  className?: string;
}> = ({ children, onClick, disabled = false, variant = 'primary', className = "" }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
      variant === 'primary' 
        ? 'btn-primary text-white' 
        : 'btn-secondary text-gray-700'
    } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
  >
    {children}
  </button>
);

const Input: React.FC<{ 
  value: string; 
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; 
  placeholder?: string;
  id?: string;
  className?: string;
}> = ({ value, onChange, placeholder, id, className = "" }) => (
  <input
    id={id}
    type="text"
    value={value}
    onChange={onChange}
    placeholder={placeholder}
    className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${className}`}
  />
);

const Label: React.FC<{ children: React.ReactNode; htmlFor?: string; className?: string }> = ({ children, htmlFor, className = "" }) => (
  <label htmlFor={htmlFor} className={`block text-sm font-medium text-gray-700 mb-1 ${className}`}>
    {children}
  </label>
);

const Switch: React.FC<{ 
  checked: boolean; 
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}> = ({ checked, onCheckedChange, className = "" }) => (
  <button
    onClick={() => onCheckedChange(!checked)}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
      checked ? 'bg-blue-600' : 'bg-gray-200'
    } ${className}`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

const Slider: React.FC<{ 
  value: number[]; 
  onValueChange: (value: number[]) => void; 
  max?: number; 
  step?: number;
  className?: string;
}> = ({ value, onValueChange, max = 100, step = 1, className = "" }) => (
  <input
    type="range"
    min="0"
    max={max}
    step={step}
    value={value[0] || 0}
    onChange={(e) => onValueChange([parseInt(e.target.value)])}
    className={`slider w-full ${className}`}
  />
);

const Textarea: React.FC<{ 
  value: string; 
  readOnly?: boolean; 
  className?: string;
}> = ({ value, readOnly = false, className = "" }) => (
  <textarea
    value={value}
    readOnly={readOnly}
    className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none ${className}`}
  />
);

const Badge: React.FC<{ 
  children: React.ReactNode; 
  variant?: 'default' | 'outline';
  className?: string;
}> = ({ children, variant = 'default', className = "" }) => (
  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
    variant === 'default' 
      ? 'bg-blue-100 text-blue-800' 
      : 'bg-gray-100 text-gray-800 border border-gray-300'
  } ${className}`}>
    {children}
  </span>
);

export default function PrompterDevPanel({ source, graph, bank, className }: PrompterDevPanelProps) {
  // 🔗 Hook into the ACTIVE NODE POOL (same context Composer uses)
  const { ctx: activeCtx, contextFrame } = useActiveNodesWithGraph(graph as any);
  
  // Profile management state
  const [profiles, setProfiles] = useState<PromptGenerationProfile[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string>("");
  const [profileDescription, setProfileDescription] = useState<string>("");
  const [showProfileManager, setShowProfileManager] = useState<boolean>(false);
  
  // Seed + RNG
  const [seed, setSeed] = useState<string>("");
  const rng = useMemo(() => (seed ? { next: seedrandom(seed) } : undefined), [seed]);

  // Built-in mutator toggles - initialized from default profile
  const [useJitter, setUseJitter] = useState<boolean>(false);
  const [jitterP, setJitterP] = useState<number>(30);
  const [useAutoBind, setUseAutoBind] = useState<boolean>(false);
  const [useEnsure2, setUseEnsure2] = useState<boolean>(false);
  const [useRandNouns, setUseRandNouns] = useState<boolean>(false);

  // Advanced slot randomization controls
  const [useMaxRandomization, setUseMaxRandomization] = useState<boolean>(false);
  const [maxRandomSlots, setMaxRandomSlots] = useState<number>(2);
  const [usePositionBasedRandom, setUsePositionBasedRandom] = useState<boolean>(false);
  const [targetPOS, setTargetPOS] = useState<POS>('NOUN');
  const [targetPosition, setTargetPosition] = useState<number>(1); // 1st, 2nd, etc.
  const [useClickableSelection, setUseClickableSelection] = useState<boolean>(false);
  const [selectedPhrase, setSelectedPhrase] = useState<any>(null);
  const [selectedWordIndices, setSelectedWordIndices] = useState<Set<number>>(new Set());

  // POS-based randomization config
  const [posRandomP, setPosRandomP] = useState<Record<POS, number>>(
    () => ALL_POS.reduce((acc, pos) => (acc[pos] = 0, acc), {} as Record<POS, number>)
  );

  // Regex-based phrase targeting
  const [regexText, setRegexText] = useState<string>("");
  const [regexRandomizeP, setRegexRandomizeP] = useState<number>(0);

  // Template locking - use session locks system
  const [lockedTemplateId, setLockedTemplateId] = useState<string | null>(null);
  const [phraseInput, setPhraseInput] = useState<string>("");
  const [patternInput, setPatternInput] = useState<string>("");
  const [useActivePool, setUseActivePool] = useState<boolean>(true); // default ON to mirror Composer
  const [patternFilter, setPatternFilter] = useState<string>("");
  const [inputError, setInputError] = useState<string>("");

  // --- Helpers to build a TemplateDoc directly from nodes using guaranteed fields ---
  function tokenizeSurfaceWords(s: string): string[] {
    // simple tokenization that preserves word order; adequate for dev panel locking
    return s.trim().split(/\s+/);
  }

  function buildDocFromPhraseNode(ph: any): TemplateDoc {
    // Guaranteed: ph.text (phrase string), ph.posPattern (e.g., "NOUN-VERB-NOUN")
    const words = tokenizeSurfaceWords(String(ph.text));
    const pos = String(ph.posPattern).split("-").map((p) => p.trim()).filter(Boolean);
    // Try to align words to pos list; if lengths differ, still create tokens with best effort
    const len = Math.max(words.length, pos.length);
    const tokens = Array.from({ length: len }).map((_, i) => {
      const w = words[i] ?? ""; // literal surface if available
      const p = (pos[i] ?? (pos[pos.length - 1] ?? "NOUN")) as POS;
      return {
        text: w || `[${p}]`,
        lemma: "",           // not required for dev locking
        pos: p,
        posSet: [p],
        randomize: false,    // start literal; mutators will toggle
        slotLabel: null,
        morph: null,
      } as PhraseToken;
    });
    return {
      id: ph.id ?? `locked_phrase_${Date.now()}`,
      createdInSessionId: "devpanel",
      blocks: [{
        kind: "phrase",
        phraseText: String(ph.text),
        tokens
      } as PhraseBlock]
    };
  }

  function buildDocFromChunkNode(ch: any): TemplateDoc {
    // Guaranteed: ch.text (chunk string), ch.posPattern (e.g., "ADJ-NOUN")
    const words = tokenizeSurfaceWords(String(ch.text));
    const pos = String(ch.posPattern).split("-").map((p) => p.trim()).filter(Boolean);
    const len = Math.max(words.length, pos.length);
    const tokens = Array.from({ length: len }).map((_, i) => {
      const w = words[i] ?? "";
      const p = (pos[i] ?? (pos[pos.length - 1] ?? "NOUN")) as POS;
      return {
        text: w || `[${p}]`,
        lemma: "",
        pos: p,
        posSet: [p],
        randomize: false,
        slotLabel: null,
        morph: null,
      } as PhraseToken;
    });
    return {
      id: ch.id ?? `locked_chunk_${Date.now()}`,
      createdInSessionId: "devpanel",
      blocks: [{
        kind: "phrase",
        phraseText: String(ch.text),
        tokens
      } as PhraseBlock]
    };
  }

  // Output
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState<string>("");
  const [debug, setDebug] = useState<any>(null);
  const [chosenTemplateId, setChosenTemplateId] = useState<string>("");
  const [templateText, setTemplateText] = useState<string>("");

  // Profile management functions
  const sessionId = "devpanel"; // Use a fixed session ID for the dev panel
  
  useEffect(() => {
    // Load profiles when component mounts
    const loadedProfiles = listSessionProfiles(sessionId);
    setProfiles(loadedProfiles);
  }, []);

  // Load initial state from default profile
  useEffect(() => {
    if (sessionId) {
      try {
        const defaultProfile = ensureDefaultProfileExists(sessionId);
        
        // Load mutator settings from default profile
        setUseJitter(defaultProfile.useJitter);
        setJitterP(defaultProfile.jitterP);
        setUseAutoBind(defaultProfile.useAutoBind);
        setUseEnsure2(defaultProfile.useEnsure2);
        setUseRandNouns(defaultProfile.useRandNouns);
        setUseMaxRandomization(defaultProfile.useMaxRandomization);
        setMaxRandomSlots(defaultProfile.maxRandomSlots);
        setUsePositionBasedRandom(defaultProfile.usePositionBasedRandom);
        setTargetPOS(defaultProfile.targetPOS);
        setTargetPosition(defaultProfile.targetPosition);
        setUseClickableSelection(defaultProfile.useClickableSelection);
        setSelectedPhrase(defaultProfile.selectedPhraseId ? { id: defaultProfile.selectedPhraseId } : null);
        setSelectedWordIndices(new Set(defaultProfile.selectedWordIndices));
        setPosRandomP({ ...defaultProfile.posRandomP });
        setRegexText(defaultProfile.regexText);
        setRegexRandomizeP(defaultProfile.regexRandomizeP);
        setUseActivePool(defaultProfile.useActivePool);
        setSeed(defaultProfile.seed);
      } catch (error) {
        console.warn('Failed to load default profile, using fallback settings:', error);
      }
    }
  }, [sessionId]);

  const saveCurrentStateAsProfile = () => {
    if (!profileName.trim()) {
      alert("Please enter a profile name");
      return;
    }

    const trimmedName = profileName.trim();
    
    // Check for duplicate names (only if not editing the same profile)
    const existingProfile = profiles.find(p => p.name.toLowerCase() === trimmedName.toLowerCase());
    if (existingProfile && existingProfile.id !== currentProfileId) {
      alert(`A profile with the name "${trimmedName}" already exists. Please choose a different name.`);
      return;
    }

    const profileData: Omit<PromptGenerationProfile, 'id' | 'createdInSessionId' | 'createdAt'> = {
      name: trimmedName,
      description: profileDescription.trim() || undefined,
      lastUsedAt: undefined,
      pinned: false,
      tags: [],
      
      // Basic mutator toggles
      useJitter,
      jitterP,
      useAutoBind,
      useEnsure2,
      useRandNouns,
      
      // Advanced randomization controls
      useMaxRandomization,
      maxRandomSlots,
      usePositionBasedRandom,
      targetPOS,
      targetPosition,
      useClickableSelection,
      selectedPhraseId: selectedPhrase?.id,
      selectedWordIndices: Array.from(selectedWordIndices),
      
      // POS-based randomization
      posRandomP,
      
      // Regex-based randomization
      regexText,
      regexRandomizeP,
      
      // Source configuration
      useActivePool,
      lockedTemplateId: lockedTemplateId,
      
      // RNG seed
      seed,
    };

    if (currentProfileId && existingProfile) {
      // Update existing profile
      const updatedProfile = updateSessionProfile(sessionId, currentProfileId, profileData);
      if (updatedProfile) {
        setProfiles(prev => prev.map(p => p.id === currentProfileId ? updatedProfile : p));
        alert(`Profile "${updatedProfile.name}" updated successfully!`);
      } else {
        alert("Failed to update profile");
        return;
      }
    } else {
      // Create new profile
      const newProfile = addSessionProfile(sessionId, profileData);
      setProfiles(prev => [...prev, newProfile]);
      alert(`Profile "${newProfile.name}" saved successfully!`);
    }
    
    setProfileName("");
    setProfileDescription("");
  };

  const loadProfile = (profileId: string) => {
    const profile = getSessionProfile(sessionId, profileId);
    if (!profile) {
      alert("Profile not found");
      return;
    }

    // Apply profile settings to current state
    setUseJitter(profile.useJitter);
    setJitterP(profile.jitterP);
    setUseAutoBind(profile.useAutoBind);
    setUseEnsure2(profile.useEnsure2);
    setUseRandNouns(profile.useRandNouns);
    
    setUseMaxRandomization(profile.useMaxRandomization);
    setMaxRandomSlots(profile.maxRandomSlots);
    setUsePositionBasedRandom(profile.usePositionBasedRandom);
    setTargetPOS(profile.targetPOS);
    setTargetPosition(profile.targetPosition);
    setUseClickableSelection(profile.useClickableSelection);
    
    // Handle selected phrase - find it in active context
    if (profile.selectedPhraseId && activeCtx?.phrases) {
      const phrase = activeCtx.phrases.find((p: any) => p.id === profile.selectedPhraseId);
      setSelectedPhrase(phrase || null);
    } else {
      setSelectedPhrase(null);
    }
    setSelectedWordIndices(new Set(profile.selectedWordIndices));
    
    setPosRandomP(profile.posRandomP);
    setRegexText(profile.regexText);
    setRegexRandomizeP(profile.regexRandomizeP);
    setUseActivePool(profile.useActivePool);
    setSeed(profile.seed);
    
    // Handle locked template - restore from profile
    setLockedTemplateId(profile.lockedTemplateId || null);
    
    // Populate profile name and description for editing
    setProfileName(profile.name);
    setProfileDescription(profile.description || "");
    
    setCurrentProfileId(profileId);
    markProfileAsUsed(sessionId, profileId);
    alert(`Profile "${profile.name}" loaded successfully!`);
  };

  const deleteProfile = (profileId: string) => {
    if (confirm("Are you sure you want to delete this profile?")) {
      removeSessionProfile(sessionId, profileId);
      setProfiles(prev => prev.filter(p => p.id !== profileId));
      if (currentProfileId === profileId) {
        setCurrentProfileId(null);
      }
    }
  };

  const duplicateProfileHandler = (profileId: string) => {
    const profile = getSessionProfile(sessionId, profileId);
    if (!profile) return;
    
    // Generate a unique name by appending a number if needed
    let newName = `${profile.name} (Copy)`;
    let counter = 1;
    
    while (profiles.some(p => p.name.toLowerCase() === newName.toLowerCase())) {
      newName = `${profile.name} (Copy ${counter})`;
      counter++;
    }
    
    const duplicated = duplicateProfile(sessionId, profileId, newName);
    if (duplicated) {
      setProfiles(prev => [...prev, duplicated]);
      alert(`Profile duplicated as "${newName}"`);
    }
  };

  const togglePinProfile = (profileId: string) => {
    const updated = toggleProfilePinned(sessionId, profileId);
    if (updated) {
      setProfiles(prev => prev.map(p => p.id === profileId ? updated : p));
    }
  };

  // --------- Use PromptEngine's unified randomization system ---------
  // The PromptEngine now handles all randomization logic through the unified service
  // We just need to update its configuration when settings change
  useEffect(() => {
    // Update PromptEngine configuration whenever settings change
    promptEngine.updateMutatorConfig({
      useJitter,
      jitterP,
      useAutoBind,
      useEnsure2,
      useRandNouns,
      useMaxRandomization,
      maxRandomSlots,
      usePositionBasedRandom,
      targetPOS,
      targetPosition,
      useClickableSelection,
      selectedPhrase,
      selectedWordIndices,
      posRandomP,
      regexText,
      regexRandomizeP,
    });
  }, [useJitter, jitterP, useAutoBind, useEnsure2, useRandNouns, useMaxRandomization, maxRandomSlots, usePositionBasedRandom, targetPOS, targetPosition, useClickableSelection, selectedPhrase, selectedWordIndices, posRandomP, regexText, regexRandomizeP]);

  // --------- Helpers: normalize & validate pattern input ---------
  function normalizePatternInput(raw: string): { ok: boolean; normalized?: string; msg?: string } {
    const s = raw.trim();
    if (!s) return { ok: false, msg: "Pattern is empty." };

    // Accept two styles:
    //   [NOUN-VERB-NOUN]
    //   [DET] [NOUN2] [VERB:participle]
    const multiBlocks = s.match(/\[[^\]]+\]/g);
    let tokens: string[] = [];

    if (multiBlocks && multiBlocks.length > 1) {
      // Multiple bracketed tokens separated by spaces
      tokens = multiBlocks.map(b => b.slice(1, -1).trim());
    } else {
      // Single bracket or bare text -> normalize to one bracket set and split on '-'
      const inside = s.startsWith("[") && s.endsWith("]") ? s.slice(1, -1) : s;
      tokens = inside.split("-").map(p => p.trim());
    }

    // Validate each token: POS, optional bind id, optional morph (via colon)
    // Allowed forms: NOUN | NOUN1 | VERB:participle | PROPN2:base
    const norm = tokens.map(tok => {
      const m = /^([A-Za-z]+)(\d+)?(?::([A-Za-z]+))?$/u.exec(tok);
      if (!m) return { ok:false, msg:`Unsupported token: ${tok}` };
      const pos = (m[1] || "").toUpperCase();
      const bind = m[2]; // optional digits
      const morph = m[3]?.toLowerCase();
      const resolvedPOS = pos === "PARTICIPLE" ? "VERB" : pos;
      if (!ALLOWED_POS.has(resolvedPOS as POS)) {
        return { ok:false, msg:`Unsupported POS: ${tok}. Use tags like NOUN, VERB, ADJ, PROPN, etc.` };
      }
      return { ok:true, out: `${resolvedPOS}${bind ? bind : ""}${morph ? `:${morph}` : ""}` };
    });

    const bad = norm.find(x => !x.ok);
    if (bad) return { ok:false, msg:(bad as any).msg };
    const serialized = norm.map(x => (x as any).out).join("-");
    return { ok:true, normalized:`[${serialized}]` };
  }


  // --------- Generate handler ---------
  const handleGenerate = async () => {
    setLoading(true);
    try {
      // Guard: when using the active pool, require it to have data (Topic required)
      if (useActivePool) {
        const pCount = activeCtx?.phrases?.length ?? 0;
        const cCount = activeCtx?.chunks?.length ?? 0;
        const wCount = activeCtx?.words?.length ?? 0;
        if (pCount + cCount === 0 || wCount === 0) {
          setLoading(false);
          alert("Topic required: Active pool is empty. Select a topic or add phrases/words.");
          return;
        }
      }

      // PromptEngine configuration is already updated via useEffect above

      // Use the enhanced PromptEngine instead of creating a new Prompter instance
      const res = await promptEngine.generateEnhancedPrompt(
        activeCtx || { words: [], chunks: [], phrases: [] },
        graph,
        sessionId,
        rng,
        undefined, // lockedDoc
        lockedTemplateId // lockedTemplateId
      );
      
      setPrompt(res.prompt);
      setDebug(res.debug);
      setChosenTemplateId(res.templateId);
      setTemplateText(res.templateText);
    } catch (err: any) {
      console.error(err);
      // Simple toast-like notification
      alert(err?.message ?? "Failed to generate prompt");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt || "");
      // Simple toast-like notification
      alert("Prompt copied to clipboard");
    } catch {
      alert("Failed to copy to clipboard");
    }
  };

  // --------- Lock from phrase/chunk row click ---------
  async function lockFromPhraseNodeClick(ph: any) {
    if (!graph || !contextFrame?.sessionId) return;
    
    // Use the phrase ID as the template ID for locking
    const templateId = ph.id;
    setLockedTemplateId(templateId);
    
    // Update session locks
    const locks = getSessionLocks(graph, contextFrame.sessionId);
    const updatedLocks = { ...locks, lockedTemplateIds: [templateId] };
    setSessionLocks(graph, contextFrame.sessionId, updatedLocks);
    
    alert("Locked to this template.");
  }

  async function lockFromChunkNodeClick(ch: any) {
    if (!graph || !contextFrame?.sessionId) return;
    
    // Use the chunk ID as the template ID for locking
    const templateId = ch.id;
    setLockedTemplateId(templateId);
    
    // Update session locks
    const locks = getSessionLocks(graph, contextFrame.sessionId);
    const updatedLocks = { ...locks, lockedTemplateIds: [templateId] };
    setSessionLocks(graph, contextFrame.sessionId, updatedLocks);
    
    alert("Locked to this template.");
  }

  return (
    <div className={`w-full max-w-6xl mx-auto p-4 ${className ?? ""}`}>
      <Card className="shadow-xl border border-gray-200">
        <CardHeader>
          <CardTitle className="text-xl">Prompter Dev Panel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* ---------- Profile Management Section ---------- */}
          <Card className="border-blue-200 bg-blue-50">
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Prompt Generation Profiles</span>
                <Button 
                  variant="secondary" 
                  onClick={() => setShowProfileManager(!showProfileManager)}
                  className="text-xs"
                >
                  {showProfileManager ? "Hide" : "Manage"} Profiles
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Quick Profile Actions */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Save Current Profile */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Save Current Settings</Label>
                  <div className="space-y-2">
                    <Input 
                      value={profileName} 
                      onChange={(e) => setProfileName(e.target.value)} 
                      placeholder="Profile name..."
                      className="text-sm"
                    />
                    <Input 
                      value={profileDescription} 
                      onChange={(e) => setProfileDescription(e.target.value)} 
                      placeholder="Description (optional)..."
                      className="text-sm"
                    />
                    <div className="flex gap-2">
                      <Button 
                        onClick={saveCurrentStateAsProfile} 
                        disabled={!profileName.trim()}
                        className="flex-1 text-xs"
                      >
                        {currentProfileId ? "Update Profile" : "Save Profile"}
                      </Button>
                      {currentProfileId && (
                        <Button 
                          onClick={() => {
                            setCurrentProfileId(null);
                            setProfileName("");
                            setProfileDescription("");
                          }}
                          variant="secondary"
                          className="text-xs"
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Load Profile */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Load Profile</Label>
                  <div className="space-y-2">
                    <select 
                      value={currentProfileId || ""} 
                      onChange={(e) => e.target.value && loadProfile(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select a profile...</option>
                      {profiles.map(profile => (
                        <option key={profile.id} value={profile.id}>
                          {profile.pinned ? "📌 " : ""}{profile.name}
                        </option>
                      ))}
                    </select>
                    {currentProfileId && (
                      <div className="text-xs text-green-600">
                        ✓ Profile loaded
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Quick Actions</Label>
                  <div className="space-y-1">
                    <Button 
                      variant="secondary" 
                      onClick={() => {
                        setUseJitter(true);
                        setJitterP(30);
                        setUseAutoBind(true);
                        setUseEnsure2(true);
                        setUseRandNouns(false);
                        setUseMaxRandomization(false);
                        setUsePositionBasedRandom(false);
                        setUseClickableSelection(false);
                        setPosRandomP(ALL_POS.reduce((acc, pos) => (acc[pos] = 0, acc), {} as Record<POS, number>));
                        setRegexText("");
                        setRegexRandomizeP(0);
                        setUseActivePool(true);
                        setSeed("");
                        setCurrentProfileId(null);
                        alert("Reset to default settings");
                      }}
                      className="w-full text-xs"
                    >
                      Reset to Defaults
                    </Button>
                    <Button 
                      variant="secondary" 
                      onClick={() => {
                        const pinned = getPinnedProfiles(sessionId);
                        if (pinned.length === 0) {
                          alert("No pinned profiles found");
                          return;
                        }
                        // Load the most recently used pinned profile
                        const mostRecent = pinned.sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))[0];
                        loadProfile(mostRecent.id);
                      }}
                      className="w-full text-xs"
                    >
                      Load Pinned Profile
                    </Button>
                  </div>
                </div>
              </div>

              {/* Profile Manager (Collapsible) */}
              {showProfileManager && (
                <div className="border-t pt-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Saved Profiles ({profiles.length})</Label>
                      <Button 
                        variant="secondary" 
                        onClick={() => {
                          const name = window.prompt("Enter profile name:");
                          if (name) {
                            const trimmedName = name.trim();
                            if (!trimmedName) {
                              alert("Please enter a valid profile name");
                              return;
                            }
                            
                            // Check for duplicate names
                            const existingProfile = profiles.find(p => p.name.toLowerCase() === trimmedName.toLowerCase());
                            if (existingProfile) {
                              alert(`A profile with the name "${trimmedName}" already exists. Please choose a different name.`);
                              return;
                            }
                            
                            const profile = createDefaultProfile(sessionId, trimmedName);
                            setProfiles(prev => [...prev, profile]);
                            alert(`Profile "${trimmedName}" created successfully!`);
                          }
                        }}
                        className="text-xs"
                      >
                        Create Default Profile
                      </Button>
                    </div>
                    
                    {profiles.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-4">
                        No profiles saved yet. Create one above or save your current settings.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-auto">
                        {profiles.map(profile => (
                          <div 
                            key={profile.id} 
                            className={`p-3 rounded-lg border ${
                              currentProfileId === profile.id 
                                ? 'bg-green-50 border-green-300' 
                                : 'bg-white border-gray-200'
                            }`}
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm">{profile.name}</span>
                                  {profile.pinned && <span className="text-xs">📌</span>}
                                </div>
                                {profile.description && (
                                  <p className="text-xs text-gray-600 mt-1">{profile.description}</p>
                                )}
                                <p className="text-xs text-gray-500 mt-1">
                                  Created: {new Date(profile.createdAt).toLocaleDateString()}
                                  {profile.lastUsedAt && (
                                    <span> • Last used: {new Date(profile.lastUsedAt).toLocaleDateString()}</span>
                                  )}
                                </p>
                              </div>
                            </div>
                            
                            <div className="flex gap-1">
                              <Button 
                                onClick={() => loadProfile(profile.id)}
                                className="text-xs px-2 py-1"
                                variant="primary"
                              >
                                Load
                              </Button>
                              <Button 
                                onClick={() => togglePinProfile(profile.id)}
                                className="text-xs px-2 py-1"
                                variant="secondary"
                              >
                                {profile.pinned ? "Unpin" : "Pin"}
                              </Button>
                              <Button 
                                onClick={() => duplicateProfileHandler(profile.id)}
                                className="text-xs px-2 py-1"
                                variant="secondary"
                              >
                                Copy
                              </Button>
                              <Button 
                                onClick={() => deleteProfile(profile.id)}
                                className="text-xs px-2 py-1"
                                variant="secondary"
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ---------- Top Three Columns: Generate/Prompt/Debug ---------- */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Generate Controls */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="seed">Seed (optional)</Label>
                <p className="text-xs text-gray-500">→ <code>Prompter.rng</code> (seedrandom)</p>
                <Input id="seed" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="e.g. session-42" />
              </div>
              <div className="flex flex-col gap-2">
                <Button onClick={handleGenerate} disabled={loading} className="w-full">
                  {loading ? "Generating…" : "Generate"}
                </Button>
                <Button variant="secondary" onClick={handleCopy} disabled={!prompt} className="w-full">
                  Copy Prompt
                </Button>
                <div className="flex items-center gap-2">
                  <div>
                    <Label className="text-xs">Use Active Pool</Label>
                    <p className="text-xs text-gray-500">→ <code>activeSource</code> vs <code>source</code></p>
                  </div>
                  <Switch checked={useActivePool} onCheckedChange={setUseActivePool} />
                </div>
                {prompt && (
                  <Badge variant="outline" className="w-fit">Template: {chosenTemplateId}</Badge>
                )}
              </div>
            </div>

            {/* Generated Prompt */}
            <div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Generated Prompt</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea value={prompt} readOnly className="min-h-[180px] font-mono" />
                </CardContent>
              </Card>
            </div>

            {/* Debug Info */}
            <div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Debug</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-xs grid grid-cols-3 gap-2 mb-2">
                    <div className="rounded bg-gray-100 p-2">
                      <div className="font-medium">Active Phrases</div>
                      <div>{activeCtx?.phrases?.length ?? 0}</div>
                    </div>
                    <div className="rounded bg-gray-100 p-2">
                      <div className="font-medium">Active Chunks</div>
                      <div>{activeCtx?.chunks?.length ?? 0}</div>
                    </div>
                    <div className="rounded bg-gray-100 p-2">
                      <div className="font-medium">Active Words</div>
                      <div>{activeCtx?.words?.length ?? 0}</div>
                    </div>
                  </div>
                  <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-72">{JSON.stringify({ id: chosenTemplateId, templateText, debug }, null, 2)}</pre>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* ---------- Two Columns: Available Patterns / Build from Phrase ---------- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Available Patterns */}
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">Available Patterns (Active Pool)</CardTitle>
                <p className="text-xs text-gray-600 mt-1">
                  Controls: <code>activeCtx.phrases</code>, <code>activeCtx.chunks</code> → <code>Prompter.source</code>
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="pf">Filter</Label>
                    <Input id="pf" value={patternFilter} onChange={(e) => setPatternFilter(e.target.value)} placeholder="Type to filter by text or POS (e.g., lemon or NOUN-VERB)" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">Phrases: {activeCtx?.phrases?.length ?? 0}</Badge>
                    <Badge variant="outline">Chunks: {activeCtx?.chunks?.length ?? 0}</Badge>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Phrases column */}
                  <div>
                    <div className="text-xs font-medium mb-2">Phrases</div>
                    <div className="h-80 overflow-auto rounded border p-2 space-y-2">
                      {(activeCtx?.phrases ?? [])
                        .filter((ph:any) => {
                          const q = patternFilter.trim().toLowerCase();
                          if (!q) return true;
                          return ph.text.toLowerCase().includes(q) || String(ph.posPattern).toLowerCase().includes(q);
                        })
                        .slice(0, 200)
                        .map((ph:any) => (
                          <button
                            key={`ph_${ph.id}`}
                            onClick={() => lockFromPhraseNodeClick(ph)}
                            className="w-full text-left rounded border p-2 hover:bg-gray-50 transition"
                            title="Click to lock this template"
                          >
                            <div className="text-sm font-medium truncate">{ph.text}</div>
                            <div className="text-xs text-gray-500 mt-1">POS: {ph.posPattern}</div>
                          </button>
                        ))}
                    </div>
                  </div>

                  {/* Chunks column */}
                  <div>
                    <div className="text-xs font-medium mb-2">Chunks</div>
                    <div className="h-80 overflow-auto rounded border p-2 space-y-2">
                      {(activeCtx?.chunks ?? [])
                        .filter((ch:any) => {
                          const q = patternFilter.trim().toLowerCase();
                          if (!q) return true;
                          return ch.text.toLowerCase().includes(q) || String(ch.posPattern).toLowerCase().includes(q);
                        })
                        .slice(0, 200)
                        .map((ch:any) => (
                          <button
                            key={`ch_${ch.id}`}
                            onClick={() => lockFromChunkNodeClick(ch)}
                            className="w-full text-left rounded border p-2 hover:bg-gray-50 transition"
                            title="Click to lock this template"
                          >
                            <div className="text-sm font-medium truncate">{ch.text}</div>
                            <div className="text-xs text-gray-500 mt-1">POS: {ch.posPattern}</div>
                            <div className="text-xs text-gray-500">Score: {typeof ch.score === "number" ? ch.score : "—"}</div>
                          </button>
                        ))}
                    </div>
                  </div>
                </div>

                {(activeCtx?.phrases?.length ?? 0) + (activeCtx?.chunks?.length ?? 0) === 0 && (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                    Topic required: There are no phrases/chunks in the active pool. Select a topic first.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Build from Phrase */}
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">Build Template From Phrase</CardTitle>
                <p className="text-xs text-gray-600 mt-1">
                  Controls: <code>lockedDoc</code> → <code>Prompter.source</code> (overrides active pool)
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <Label htmlFor="phrase">Paste a phrase (e.g., "dog chases scared cat")</Label>
                <Input id="phrase" value={phraseInput} onChange={(e) => setPhraseInput(e.target.value)} placeholder="Type a phrase…" />
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      setInputError("");
                      const raw = phraseInput.trim();
                      if (!raw) { setInputError("Please enter a phrase."); return; }
                      // Only allow phrases that exist in the ACTIVE POOL (so POS is guaranteed)
                      const match = (activeCtx?.phrases ?? []).find((ph:any) => String(ph.text).toLowerCase() === raw.toLowerCase());
                      if (!match) { setInputError("That phrase isn't in the active pool. Pick one from the list below."); return; }
                      await lockFromPhraseNodeClick(match);
                    }}
                  >
                    Lock Template
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => { 
                      setLockedTemplateId(null);
                      if (graph && contextFrame?.sessionId) {
                        const locks = getSessionLocks(graph, contextFrame.sessionId);
                        const updatedLocks = { ...locks, lockedTemplateIds: [] };
                        setSessionLocks(graph, contextFrame.sessionId, updatedLocks);
                      }
                      alert("Unlocked—using panel source again."); 
                    }}
                  >
                    Unlock
                  </Button>
                </div>
                {inputError && <p className="text-xs text-red-600">{inputError}</p>}
                <p className="text-xs text-gray-600">
                  When locked, Generate will mutate this template only—no new patterns are invented.
                </p>
                {lockedTemplateId ? (
                  <div className="text-xs rounded bg-gray-100 p-2">
                    <div className="font-medium mb-1">Locked Template</div>
                    <div>Template ID: {lockedTemplateId}</div>
                    <button 
                      onClick={() => {
                        setLockedTemplateId(null);
                        if (graph && contextFrame?.sessionId) {
                          const locks = getSessionLocks(graph, contextFrame.sessionId);
                          const updatedLocks = { ...locks, lockedTemplateIds: [] };
                          setSessionLocks(graph, contextFrame.sessionId, updatedLocks);
                        }
                        alert("Template unlocked");
                      }}
                      className="mt-1 text-blue-600 hover:text-blue-800 underline"
                    >
                      Unlock
                    </button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {/* ---------- Two Columns: Built-in Mutators / POS-based Randomization ---------- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Built-in Mutators */}
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">Built-in Mutators</CardTitle>
                <p className="text-xs text-gray-600 mt-1">
                  Controls: <code>configurableMutators</code> → <code>Prompter.mutators</code>
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Switch checked={useJitter} onCheckedChange={setUseJitter} />
                    <div>
                      <span className="font-medium">Jitter Slots</span>
                      <p className="text-xs text-gray-500">→ <code>mutatorJitter30</code> + <code>utils.jitterSlots()</code></p>
                    </div>
                  </div>
                  <div className="w-48">
                    <Label className="text-xs">Flip Probability: {jitterP}%</Label>
                    <Slider value={[jitterP]} onValueChange={(v) => setJitterP(v[0] ?? 30)} max={100} step={1} />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Switch checked={useAutoBind} onCheckedChange={setUseAutoBind} />
                    <div>
                      <span className="font-medium">Auto Bind (slot reuse)</span>
                      <p className="text-xs text-gray-500">→ <code>mutatorAutoBind</code> + <code>utils.autoBind()</code></p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Switch checked={useEnsure2} onCheckedChange={setUseEnsure2} />
                    <div>
                      <span className="font-medium">Ensure ≥ 2 randomized tokens</span>
                      <p className="text-xs text-gray-500">→ <code>mutatorEnsure2Random</code> + <code>utils.ensureRandomizedMin()</code></p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Switch checked={useRandNouns} onCheckedChange={setUseRandNouns} />
                    <div>
                      <span className="font-medium">Randomize all NOUN tokens</span>
                      <p className="text-xs text-gray-500">→ <code>mutatorRandomizeNouns</code></p>
                    </div>
                  </div>
                </div>

                {/* Advanced Slot Randomization Controls */}
                <div className="border-t pt-4 mt-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Advanced Slot Randomization</h4>
                  
                  {/* Max Randomization Control */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Switch checked={useMaxRandomization} onCheckedChange={setUseMaxRandomization} />
                      <div>
                        <span className="font-medium">Max Randomization</span>
                        <p className="text-xs text-gray-500">→ <code>maxRandomizationMutator</code></p>
                      </div>
                    </div>
                    <div className="w-32">
                      <Label className="text-xs">Max slots: {maxRandomSlots}</Label>
                      <Slider value={[maxRandomSlots]} onValueChange={(v) => setMaxRandomSlots(v[0] ?? 2)} max={10} step={1} />
                    </div>
                  </div>

                  {/* Position-based Randomization Control */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Switch checked={usePositionBasedRandom} onCheckedChange={setUsePositionBasedRandom} />
                      <div>
                        <span className="font-medium">Position-based Random</span>
                        <p className="text-xs text-gray-500">→ <code>positionBasedRandomMutator</code></p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <select 
                        value={targetPOS} 
                        onChange={(e) => setTargetPOS(e.target.value as POS)}
                        className="text-xs border rounded px-2 py-1"
                      >
                        {ALL_POS.map(pos => (
                          <option key={pos} value={pos}>{pos}</option>
                        ))}
                      </select>
                      <span className="text-xs">position:</span>
                      <input
                        type="number"
                        min="1"
                        max="5"
                        value={targetPosition}
                        onChange={(e) => setTargetPosition(parseInt(e.target.value) || 1)}
                        className="w-12 text-xs border rounded px-1 py-1"
                      />
                    </div>
                  </div>

                  {/* Clickable Selection Control */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Switch checked={useClickableSelection} onCheckedChange={setUseClickableSelection} />
                      <div>
                        <span className="font-medium">Clickable Selection</span>
                        <p className="text-xs text-gray-500">→ <code>clickableSelectionMutator</code></p>
                      </div>
                    </div>
                  </div>

                  {/* Phrase Selection for Clickable Mode */}
                  {useClickableSelection && (
                    <div className="mt-3 p-3 bg-gray-50 rounded">
                      <Label className="text-xs font-medium">Select Phrase for Clickable Randomization</Label>
                      <div className="mt-2 max-h-32 overflow-auto space-y-1">
                        {(activeCtx?.phrases ?? []).slice(0, 10).map((ph: any) => (
                          <button
                            key={ph.id}
                            onClick={() => setSelectedPhrase(ph)}
                            className={`w-full text-left p-2 rounded text-sm ${
                              selectedPhrase?.id === ph.id 
                                ? 'bg-blue-100 border border-blue-300' 
                                : 'bg-white border border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            <div className="font-medium">{ph.text}</div>
                            <div className="text-xs text-gray-500">POS: {ph.posPattern}</div>
                          </button>
                        ))}
                      </div>
                      
                      {/* Word Selection Chips */}
                      {selectedPhrase && (
                        <div className="mt-3">
                          <Label className="text-xs font-medium">Click words to randomize:</Label>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {selectedPhrase.text.split(' ').map((word: string, index: number) => (
                              <button
                                key={index}
                                onClick={() => {
                                  const newSelected = new Set(selectedWordIndices);
                                  if (newSelected.has(index)) {
                                    newSelected.delete(index);
                                  } else {
                                    newSelected.add(index);
                                  }
                                  setSelectedWordIndices(newSelected);
                                }}
                                className={`px-2 py-1 rounded text-xs border ${
                                  selectedWordIndices.has(index)
                                    ? 'bg-blue-500 text-white border-blue-500'
                                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                }`}
                              >
                                {word}
                              </button>
                            ))}
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            Selected: {selectedWordIndices.size} word(s)
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* POS-based Randomization */}
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">POS-based Randomization</CardTitle>
                <p className="text-xs text-gray-600 mt-1">
                  Controls: <code>posRandomP</code> → custom mutator in <code>configurableMutators</code>
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-gray-600">Set probability per POS to force tokens of that POS to randomize.</p>
                <div className="grid grid-cols-2 gap-3">
                  {ALL_POS.map((pos) => (
                    <div key={pos} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">{pos} — {posRandomP[pos]}%</Label>
                        <Badge variant={posRandomP[pos] > 0 ? "default" : "outline"}>
                          {posRandomP[pos] > 0 ? "on" : "off"}
                        </Badge>
                      </div>
                      <Slider
                        value={[posRandomP[pos]]}
                        onValueChange={(v) => setPosRandomP((prev) => ({ ...prev, [pos]: v[0] ?? 0 }))}
                        max={100}
                        step={5}
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ---------- Two Columns: Build from Pattern / Phrase Pattern Regex ---------- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Build from Pattern */}
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">Build Template From Pattern</CardTitle>
                <p className="text-xs text-gray-600 mt-1">
                  Controls: <code>patternInput</code> → <code>lockedDoc</code> → <code>Prompter.source</code>
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <Label htmlFor="pattern">Type a POS pattern (e.g., <code>[NOUN-VERB-NOUN]</code>)</Label>
                <Input id="pattern" value={patternInput} onChange={(e) => setPatternInput(e.target.value)} placeholder="[NOUN-VERB-NOUN]" />
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      setInputError("");
                      const { ok, normalized, msg } = normalizePatternInput(patternInput);
                      if (!ok || !normalized) { setInputError(msg || "Invalid pattern."); return; }
                      // Build a minimal TemplateDoc with a text block, then parse it (same as Composer)
                      const seedDoc: TemplateDoc = {
                        id: `locked_pattern_${Date.now()}`,
                        createdInSessionId: "devpanel",
                        blocks: [{ kind: "text", text: normalized }]
                      } as any;
                      const parsed = await parseTextPatternsToUTA(seedDoc, graph);
                      // For pattern-based locking, we'll use a different approach
                      // Since we can't easily convert TemplateDoc to template ID, we'll skip this for now
                      alert("Pattern locking not yet implemented - please use phrase/chunk locking instead");
                    }}
                  >
                    Lock Pattern
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => { 
                      setLockedTemplateId(null);
                      if (graph && contextFrame?.sessionId) {
                        const locks = getSessionLocks(graph, contextFrame.sessionId);
                        const updatedLocks = { ...locks, lockedTemplateIds: [] };
                        setSessionLocks(graph, contextFrame.sessionId, updatedLocks);
                      }
                      alert("Unlocked—using panel source again."); 
                    }}
                  >
                    Unlock
                  </Button>
                </div>
                {inputError && <p className="text-xs text-red-600">{inputError}</p>}
                <p className="text-xs text-gray-600">
                  Tips: Use either <code>[NOUN-VERB-NOUN]</code> or <code>[DET] [NOUN] [NOUN2]</code>. You can add binds (e.g., NOUN1) and morphs (e.g., VERB:participle).
                </p>
              </CardContent>
            </Card>

            {/* Phrase Pattern Regex */}
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">Phrase Pattern Randomization (Regex)</CardTitle>
                <p className="text-xs text-gray-600 mt-1">
                  Controls: <code>regexText</code>, <code>regexRandomizeP</code> → custom mutator in <code>configurableMutators</code>
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <div className="md:col-span-2 space-y-2">
                    <Label htmlFor="regex">Regex to match phraseText</Label>
                    <Input id="regex" placeholder="e.g. ^When life" value={regexText} onChange={(e) => setRegexText(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Randomize Probability: {regexRandomizeP}%</Label>
                    <Slider value={[regexRandomizeP]} onValueChange={(v) => setRegexRandomizeP(v[0] ?? 0)} max={100} step={5} />
                  </div>
                </div>
                <p className="text-xs text-gray-600">If the phrase's <code className="bg-gray-100 px-1 rounded">phraseText</code> matches, tokens will be toggled to randomized with the given probability.</p>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}