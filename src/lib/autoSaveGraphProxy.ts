import { SemanticGraph } from './semanticGraph';
import { useEffect, useState } from 'react';
import { SimpleEventEmitter } from './SimpleEventEmitter';

// List of all mutating methods in SemanticGraph
const MUTATING_METHODS = [
  'addAssociation',
  'addWordAssociations',
  'addWordAssociationsWithCategories',
  'deleteWord',
  'clear',
  'setAssociationTags',
  'addTagToAssociation',
  'removeTagFromAssociation',
  'addWordTag',
  'removeWordTag',
  'setWordTags',
  'markAsAIProcessed',
  'markWordAsAIProcessed',
  'addSentence',
  'deleteSentence',
  'cleanupRedundantSentenceNodes',
  'migrateSentencesToPhrases',
  'addNote',
  'updateNote',
  'deleteNote',
  'migrateResponsesToNotes',
  'fromJSON',
  // Add any other mutating methods here as needed
];

export const graphEvents = new SimpleEventEmitter();

// Flag to temporarily disable auto-save events during critical operations
let isEventDisabled = false;

// Enhanced debouncing for auto-save to prevent memory leaks
let saveTimeout: NodeJS.Timeout | null = null;
const SAVE_DEBOUNCE_DELAY = 5000; // Increased to 5 seconds to reduce frequency

// Memory optimization: Track save attempts to prevent excessive saves
let saveAttempts = 0;
const MAX_SAVE_ATTEMPTS_PER_MINUTE = 10; // Reduced limit to prevent memory issues
let lastSaveTime = 0;
let resetTimeout: NodeJS.Timeout | null = null;

// Function to reset save attempts counter
const resetSaveAttempts = () => {
  saveAttempts = 0;
  if (resetTimeout) {
    clearTimeout(resetTimeout);
    resetTimeout = null;
  }
};

export function createAutoSaveGraphProxy(graph: SemanticGraph, onSave: () => void) {
  // Enhanced debounced save function with memory optimization
  const debouncedSave = () => {
    const now = Date.now();
    
    // Prevent excessive saves
    if (now - lastSaveTime < 1000) { // Minimum 1 second between saves
      return;
    }
    
    // Limit total save attempts per minute
    if (saveAttempts >= MAX_SAVE_ATTEMPTS_PER_MINUTE) {
      console.warn('Too many save attempts, skipping save to prevent memory issues');
      return;
    }
    
    // Check graph size and adjust save frequency for large graphs
    const graphSize = graph.getMemoryStats().graphSize;
    if (graphSize > 500) {
      // For large graphs, increase debounce delay to reduce save frequency
      const largeGraphDelay = Math.max(SAVE_DEBOUNCE_DELAY * 2, 10000); // At least 10 seconds
      if (now - lastSaveTime < largeGraphDelay) {
        return;
      }
    }
    
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    
    saveTimeout = setTimeout(() => {
      try {
        if (graph.dirty) {
          onSave();
          lastSaveTime = Date.now();
          saveAttempts++;
          
          if (!resetTimeout) {
            resetTimeout = setTimeout(() => {
              resetSaveAttempts();
            }, 60000);
          }
        }
      } catch (error) {
        console.error('Auto-save failed:', error);
        resetSaveAttempts(); // Reset attempts on error to prevent blocking
      }
    }, SAVE_DEBOUNCE_DELAY);
  };

  return new Proxy(graph, {
    get(target, prop, receiver) {
      const orig = target[prop as keyof SemanticGraph];
      if (typeof orig === 'function' && MUTATING_METHODS.includes(prop as string)) {
        return function (...args: any[]) {
          const result = (orig as Function).apply(target, args);
          
          // Use enhanced debounced save
          debouncedSave();
          
          // Only emit events if not temporarily disabled
          if (!isEventDisabled) {
            graphEvents.emit(); // Notify listeners
          }
          
          return result;
        };
      }
      return orig;
    }
  });
}

// Function to temporarily disable auto-save events
export function disableAutoSaveEvents() {
  isEventDisabled = true;
}

// Function to re-enable auto-save events
export function enableAutoSaveEvents() {
  isEventDisabled = false;
}

// Function to temporarily disable events for a specific duration
export function temporarilyDisableEvents(duration: number = 100) {
  disableAutoSaveEvents();
  setTimeout(() => {
    enableAutoSaveEvents();
  }, duration);
}

// Function to clear any pending auto-save operations
export function clearPendingAutoSave() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  if (resetTimeout) {
    clearTimeout(resetTimeout);
    resetTimeout = null;
  }
}

// Function to force an immediate save (bypassing debounce)
export function forceAutoSave(onSave: () => void) {
  clearPendingAutoSave();
  onSave();
}

// Function to reset save attempts (useful for manual cleanup)
export function resetSaveAttemptsCounter() {
  resetSaveAttempts();
}

// Custom React hook to force update on graph change
type UseGraphUpdate = () => void;
export const useGraphUpdate: UseGraphUpdate = () => {
  const [, setTick] = useState(0);
  useEffect(() => {
    let isSubscribed = true;
    const handler = () => {
      if (isSubscribed) {
        setTick(tick => tick + 1);
      }
    };
    graphEvents.on(handler);
    return () => {
      isSubscribed = false;
      graphEvents.off(handler);
    };
  }, []);
}; 