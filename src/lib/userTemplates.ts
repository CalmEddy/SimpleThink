import { UnifiedTemplate, TemplateDoc } from '../types/index.js';
import { v4 as uuid } from 'uuid';
import { parseTemplateTextToTokens, buildBindings } from './parseTemplateText.js';
import { convertTemplateDocToUnified } from './composer.js';

// File System Access API types
declare global {
  interface Window {
    showSaveFilePicker: (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FileSystemFileHandle>;
    showOpenFilePicker: (options: { types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FileSystemFileHandle[]>;
  }
}

// In-memory store for backward compatibility and fallback
const store = new Map<string /*sessionId*/, UnifiedTemplate[]>();

// File storage interface
interface FileStorage {
  saveToFile(data: Record<string, TemplateDoc[]>): Promise<void>;
  loadFromFile(): Promise<Record<string, TemplateDoc[]> | null>;
}

// File System Access API implementation
class FileSystemStorage implements FileStorage {
  private fileHandle: FileSystemFileHandle | null = null;

  async saveToFile(data: Record<string, TemplateDoc[]>): Promise<void> {
    try {
      // Convert UnifiedTemplate back to TemplateDoc for storage
      const templateDocs: Record<string, TemplateDoc[]> = {};
      
      for (const [sessionId, templates] of Object.entries(data)) {
        templateDocs[sessionId] = templates.map(template => {
          // Convert UnifiedTemplate to TemplateDoc
          const blocks = template.tokens.map(token => {
            if (token.kind === 'literal') {
              return {
                kind: 'text' as const,
                text: token.surface
              };
            } else if (token.kind === 'slot') {
              return {
                kind: 'text' as const,
                text: `[${token.pos}]`
              };
            } else if (token.kind === 'subtemplate') {
              return {
                kind: 'text' as const,
                text: token.tokens.map(t => 
                  t.kind === 'literal' ? t.surface : `[${(t as any).pos || 'NOUN'}]`
                ).join(' ')
              };
            } else {
              return {
                kind: 'text' as const,
                text: ''
              };
            }
          });

          return {
            id: template.id,
            blocks: blocks.filter(block => block.text.trim() !== ''),
            createdInSessionId: template.createdInSessionId
          };
        });
      }

      const jsonData = JSON.stringify(templateDocs, null, 2);
      
      if (!this.fileHandle) {
        // Request file handle for writing
        this.fileHandle = await window.showSaveFilePicker({
          suggestedName: 'user-templates.json',
          types: [{
            description: 'JSON files',
            accept: { 'application/json': ['.json'] }
          }]
        });
      }

      if (!this.fileHandle) {
        throw new Error('No file handle available');
      }

      const writable = await this.fileHandle.createWritable();
      await writable.write(jsonData);
      await writable.close();
    } catch (error) {
      console.warn('Failed to save templates to file:', error);
      // Fallback to localStorage
      await this.saveToLocalStorage(data);
    }
  }

  async loadFromFile(): Promise<Record<string, TemplateDoc[]> | null> {
    try {
      const [fileHandle] = await window.showOpenFilePicker({
        types: [{
          description: 'JSON files',
          accept: { 'application/json': ['.json'] }
        }]
      });

      this.fileHandle = fileHandle;
      const file = await fileHandle.getFile();
      const text = await file.text();
      const data = JSON.parse(text) as Record<string, TemplateDoc[]>;
      
      // Convert TemplateDoc to UnifiedTemplate and merge with existing templates
      for (const [sessionId, templateDocs] of Object.entries(data)) {
        const unifiedTemplates = templateDocs.map(doc => convertTemplateDocToUnified(doc));
        const existingTemplates = store.get(sessionId) || [];
        
        // Merge templates, avoiding duplicates by ID
        const existingIds = new Set(existingTemplates.map(t => t.id));
        const newTemplates = unifiedTemplates.filter(t => !existingIds.has(t.id));
        const mergedTemplates = [...existingTemplates, ...newTemplates];
        
        store.set(sessionId, mergedTemplates);
      }
      
      return data;
    } catch (error) {
      console.warn('Failed to load templates from file:', error);
      // Fallback to localStorage
      return await this.loadFromLocalStorage();
    }
  }

  private async saveToLocalStorage(data: Record<string, TemplateDoc[]>): Promise<void> {
    try {
      const templateDocs: Record<string, TemplateDoc[]> = {};
      
      for (const [sessionId, templates] of Object.entries(data)) {
        templateDocs[sessionId] = templates.map(template => {
          // Convert UnifiedTemplate to TemplateDoc
          const blocks = template.tokens.map(token => {
            if (token.kind === 'literal') {
              return {
                kind: 'text' as const,
                text: token.surface
              };
            } else if (token.kind === 'slot') {
              return {
                kind: 'text' as const,
                text: `[${token.pos}]`
              };
            } else if (token.kind === 'subtemplate') {
              return {
                kind: 'text' as const,
                text: token.tokens.map(t => 
                  t.kind === 'literal' ? t.surface : `[${(t as any).pos || 'NOUN'}]`
                ).join(' ')
              };
            } else {
              return {
                kind: 'text' as const,
                text: ''
              };
            }
          });

          return {
            id: template.id,
            blocks: blocks.filter(block => block.text.trim() !== ''),
            createdInSessionId: template.createdInSessionId
          };
        });
      }

      localStorage.setItem('userTemplates', JSON.stringify(templateDocs));
    } catch (error) {
      console.warn('Failed to save templates to localStorage:', error);
    }
  }

  private async loadFromLocalStorage(): Promise<Record<string, TemplateDoc[]> | null> {
    try {
      const stored = localStorage.getItem('userTemplates');
      if (!stored) return null;
      
      const data = JSON.parse(stored) as Record<string, TemplateDoc[]>;
      
      // Convert TemplateDoc to UnifiedTemplate and update in-memory store
      for (const [sessionId, templateDocs] of Object.entries(data)) {
        const unifiedTemplates = templateDocs.map(doc => convertTemplateDocToUnified(doc));
        store.set(sessionId, unifiedTemplates);
      }
      
      return data;
    } catch (error) {
      console.warn('Failed to load templates from localStorage:', error);
      return null;
    }
  }

}

// Create storage instance
const fileStorage = new FileSystemStorage();


// Export functions for file operations
export async function saveTemplatesToFile(): Promise<void> {
  const data: Record<string, TemplateDoc[]> = {};
  
  for (const [sessionId, templates] of store.entries()) {
    data[sessionId] = templates.map(template => {
      // Convert UnifiedTemplate to TemplateDoc
      const blocks = template.tokens.map(token => {
        if (token.kind === 'literal') {
          return {
            kind: 'text' as const,
            text: token.surface
          };
        } else if (token.kind === 'slot') {
          return {
            kind: 'text' as const,
            text: `[${token.pos}]`
          };
        } else if (token.kind === 'subtemplate') {
          return {
            kind: 'text' as const,
            text: token.tokens.map(t => 
              t.kind === 'literal' ? t.surface : `[${(t as any).pos || 'NOUN'}]`
            ).join(' ')
          };
        } else {
          return {
            kind: 'text' as const,
            text: ''
          };
        }
      });

      return {
        id: template.id,
        blocks: blocks.filter(block => block.text.trim() !== ''),
        createdInSessionId: template.createdInSessionId
      };
    });
  }
  
  await fileStorage.saveToFile(data);
}

export async function loadTemplatesFromFile(): Promise<void> {
  await fileStorage.loadFromFile();
}

export async function exportTemplatesToFile(sessionId: string): Promise<void> {
  const templates = store.get(sessionId) || [];
  const data: Record<string, TemplateDoc[]> = {
    [sessionId]: templates.map(template => {
      // Convert UnifiedTemplate to TemplateDoc
      const blocks = template.tokens.map(token => {
        if (token.kind === 'literal') {
          return {
            kind: 'text' as const,
            text: token.surface
          };
        } else if (token.kind === 'slot') {
          return {
            kind: 'text' as const,
            text: `[${token.pos}]`
          };
        } else if (token.kind === 'subtemplate') {
          return {
            kind: 'text' as const,
            text: token.tokens.map(t => 
              t.kind === 'literal' ? t.surface : `[${(t as any).pos || 'NOUN'}]`
            ).join(' ')
          };
        } else {
          return {
            kind: 'text' as const,
            text: ''
          };
        }
      });

      return {
        id: template.id,
        blocks: blocks.filter(block => block.text.trim() !== ''),
        createdInSessionId: template.createdInSessionId
      };
    })
  };
  
  await fileStorage.saveToFile(data);
}

export async function importTemplatesFromFile(): Promise<void> {
  await fileStorage.loadFromFile();
}

// Load all templates from localStorage on startup
export function loadAllTemplatesFromStorage(): void {
  try {
    const stored = localStorage.getItem('userTemplates');
    if (stored) {
      const data = JSON.parse(stored) as Record<string, TemplateDoc[]>;
      for (const [sessionId, templateDocs] of Object.entries(data)) {
        const unifiedTemplates = templateDocs.map(doc => convertTemplateDocToUnified(doc));
        store.set(sessionId, unifiedTemplates);
      }
    }
  } catch (error) {
    console.warn('Failed to load templates from localStorage:', error);
  }
}

// Simple save function - saves all templates to file
export async function saveAllTemplates(): Promise<void> {
  const data: Record<string, TemplateDoc[]> = {};
  
  for (const [sessionId, templates] of store.entries()) {
    data[sessionId] = templates.map(template => {
      // Convert UnifiedTemplate to TemplateDoc
      const blocks = template.tokens.map(token => {
        if (token.kind === 'literal') {
          return {
            kind: 'text' as const,
            text: token.surface
          };
        } else if (token.kind === 'slot') {
          return {
            kind: 'text' as const,
            text: `[${token.pos}]`
          };
        } else if (token.kind === 'subtemplate') {
          return {
            kind: 'text' as const,
            text: token.tokens.map(t => 
              t.kind === 'literal' ? t.surface : `[${(t as any).pos || 'NOUN'}]`
            ).join(' ')
          };
        } else {
          return {
            kind: 'text' as const,
            text: ''
          };
        }
      });

      return {
        id: template.id,
        blocks: blocks.filter(block => block.text.trim() !== ''),
        createdInSessionId: template.createdInSessionId
      };
    });
  }
  
  await fileStorage.saveToFile(data);
}


// Legacy API functions - maintain full backward compatibility
export function listSessionTemplates(sessionId: string): UnifiedTemplate[] {
  return store.get(sessionId) ?? [];
}

export function addSessionTemplate(sessionId: string, tpl: Omit<UnifiedTemplate, 'id' | 'createdInSessionId'>): UnifiedTemplate {
  const arr = store.get(sessionId) ?? [];
  const tokens = parseTemplateTextToTokens(tpl.text);
  const created: UnifiedTemplate = {
    id: uuid(),
    createdInSessionId: sessionId,
    text: tpl.text,
    tokens,
    bindings: buildBindings(tokens),
    pinned: tpl.pinned ?? false,
    tags: tpl.tags ?? [],
    origin: tpl.origin ?? 'user',
  };
  arr.push(created);
  store.set(sessionId, arr);
  
  // Auto-save to localStorage for persistence
  saveToLocalStorage();
  
  return created;
}

export function updateSessionTemplate(sessionId: string, templateId: string, patch: Partial<UnifiedTemplate>): UnifiedTemplate | undefined {
  const arr = store.get(sessionId);
  if (!arr) return;
  const idx = arr.findIndex(t => t.id === templateId);
  if (idx === -1) return;
  arr[idx] = { ...arr[idx], ...patch };
  store.set(sessionId, arr);
  
  // Auto-save to localStorage for persistence
  saveToLocalStorage();
  
  return arr[idx];
}

export function removeSessionTemplate(sessionId: string, templateId: string): void {
  const arr = store.get(sessionId);
  if (!arr) return;
  const next = arr.filter(t => t.id !== templateId);
  store.set(sessionId, next);
  
  // Auto-save to localStorage for persistence
  saveToLocalStorage();
}

export function clearSessionTemplates(sessionId: string): void {
  store.delete(sessionId);
  
  // Auto-save to localStorage for persistence
  saveToLocalStorage();
}

// Helper function for auto-saving to localStorage
async function saveToLocalStorage(): Promise<void> {
  try {
    const data: Record<string, TemplateDoc[]> = {};
    
    for (const [sessionId, templates] of store.entries()) {
      data[sessionId] = templates.map(template => {
        // Convert UnifiedTemplate to TemplateDoc
        const blocks = template.tokens.map(token => {
          if (token.kind === 'literal') {
            return {
              kind: 'text' as const,
              text: token.surface
            };
          } else if (token.kind === 'slot') {
            return {
              kind: 'text' as const,
              text: `[${token.pos}]`
            };
          } else if (token.kind === 'subtemplate') {
            return {
              kind: 'text' as const,
              text: token.tokens.map(t => 
                t.kind === 'literal' ? t.surface : `[${(t as any).pos || 'NOUN'}]`
              ).join(' ')
            };
          } else {
            return {
              kind: 'text' as const,
              text: ''
            };
          }
        });

        return {
          id: template.id,
          blocks: blocks.filter(block => block.text.trim() !== ''),
          createdInSessionId: template.createdInSessionId
        };
      });
    }
    
    localStorage.setItem('userTemplates', JSON.stringify(data));
  } catch (error) {
    console.warn('Failed to auto-save templates to localStorage:', error);
  }
}

// Load templates from localStorage on module initialization
(async () => {
  try {
    const stored = localStorage.getItem('userTemplates');
    if (stored) {
      const data = JSON.parse(stored) as Record<string, TemplateDoc[]>;
      
      for (const [sessionId, templateDocs] of Object.entries(data)) {
        const unifiedTemplates = templateDocs.map(doc => convertTemplateDocToUnified(doc));
        store.set(sessionId, unifiedTemplates);
      }
    }
  } catch (error) {
    console.warn('Failed to load templates from localStorage on initialization:', error);
  }
})();
