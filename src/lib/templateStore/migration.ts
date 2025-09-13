import { TemplateStore } from './index';

/**
 * One-time migration from legacy storage to One True Store
 * This should be called once on app startup
 */
export async function migrateLegacyTemplates(): Promise<{ migrated: number; skipped: number }> {
  console.log('[Migration] Starting legacy template migration...');
  
  try {
    const result = await TemplateStore.migrateFromLegacy();
    console.log(`[Migration] Completed: ${result.migrated} migrated, ${result.skipped} skipped`);
    return result;
  } catch (error) {
    console.error('[Migration] Failed:', error);
    return { migrated: 0, skipped: 0 };
  }
}

/**
 * Check if migration is needed
 */
export function needsMigration(): boolean {
  const hasLegacyV1 = localStorage.getItem('PROMPTER_TEMPLATES_V1') !== null;
  const hasLegacyV2 = localStorage.getItem('PROMPTER_TEMPLATES_V2') !== null;
  const hasOTS = localStorage.getItem('OTS_TEMPLATES') !== null;
  
  return (hasLegacyV1 || hasLegacyV2) && !hasOTS;
}
