# Prompter Implementation - UTA Pipeline Integration

## Overview
The Prompter has been successfully integrated to replace the old `generateEphemeralPrompts` function. This ensures all prompt generation uses the same UTA pipeline as the ComposerEditor.

## Changes Made

### 1. Fixed Import Paths
- Fixed `parseTextPatternsToUTA` import path in `src/lib/prompter/index.ts`
- Changed from `"../components/ComposerEditor"` to `"../../components/ComposerEditor"`

### 2. Updated PromptView.tsx
- **Replaced** old `generateEphemeralPrompts` import with Prompter imports
- **Added** conversion from `UnifiedTemplate[]` to `TemplateDoc[]` 
- **Updated** `generateNewPrompts` function to use Prompter with UTA pipeline
- **Maintained** existing `EphemeralPrompt[]` interface for compatibility

### 3. Added Guardrails
- **Added** `__FORBID_DIRECT_REALIZE_TEMPLATE__()` function to `promptEngine.ts`
- **Created** test in `pipeline.guard.test.ts` to prevent regression
- **Ensures** any future attempts to bypass UTA pipeline will fail loudly

## Pipeline Flow
The Prompter now uses the exact same pipeline as ComposerEditor:

1. **Template Selection**: Random selection from available templates
2. **parseTextPatternsToUTA**: Parse text patterns into UTA format
3. **convertTemplateDocToUnified**: Convert to UnifiedTemplate
4. **realizeTemplate**: Generate final prompt using UTA

## Benefits
- ✅ **Unified Pipeline**: PromptView and ComposerEditor use identical processing
- ✅ **No Duplication**: Single source of truth for prompt generation
- ✅ **Guardrails**: Prevents regression to old broken system
- ✅ **Compatibility**: Maintains existing EphemeralPrompt interface

## Testing
Run the guardrail test to verify the system works:
```bash
npm test -- --testPathPattern=pipeline.guard.test.ts
```

The test should pass, confirming that:
1. The guardrail function throws the expected error
2. The Prompter can generate prompts using the UTA pipeline
