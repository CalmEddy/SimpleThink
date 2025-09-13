import { migrateLegacyTemplates, needsMigration } from './migration';

/**
 * Initialize the One True Store
 * Call this once on app startup
 */
export async function initializeTemplateStore(): Promise<void> {
  console.log('[OTS] Initializing One True Store...');
  
  if (needsMigration()) {
    console.log('[OTS] Legacy templates detected, running migration...');
    const result = await migrateLegacyTemplates();
    console.log(`[OTS] Migration complete: ${result.migrated} migrated, ${result.skipped} skipped`);
  } else {
    console.log('[OTS] No migration needed, store is ready');
  }
  
  console.log('[OTS] One True Store initialized successfully');
}
