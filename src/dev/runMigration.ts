/* eslint-disable no-console */
import { migratePatterns } from './migratePatterns.js';

// This can be called from the browser console or a dev button
export async function runMigration(graph: any) {
  console.log('[Migration] Starting pattern migration...');
  try {
    await migratePatterns(graph);
    console.log('[Migration] Migration completed successfully!');
    console.log('[Migration] Please refresh the page to see the changes.');
  } catch (error) {
    console.error('[Migration] Migration failed:', error);
  }
}

// Make it available globally for easy access
if (typeof window !== 'undefined') {
  (window as any).runPatternMigration = runMigration;
  console.log('[Migration] Migration function available as window.runPatternMigration(graph)');
}
