# Unified Randomization Pipeline

This directory contains the unified randomization system that consolidates all randomization logic across the application into a single, configurable, and debuggable service.

## Overview

The unified randomization pipeline addresses the scattered randomization logic that was previously duplicated across multiple files:

- `src/lib/promptEngine.ts` - Template shuffling and slot randomization
- `src/lib/fillTemplate.ts` - Word selection randomization  
- `src/lib/prompter/index.ts` - Template selection with weights
- `src/lib/templates.ts` - Word bank randomization
- `src/lib/composer.ts` - Bank word selection
- `src/components/PrompterDevPanel.tsx` - Duplicate mutator logic

## Architecture

### Core Components

1. **UnifiedRandomizationService** - Main service that orchestrates all randomization
2. **RandomizationConfigManager** - Centralized configuration management
3. **Strategy Pattern** - Pluggable strategies for different randomization types
4. **RNG Implementations** - Consistent random number generation with seeding support
5. **Comprehensive Logging** - Debug and trace randomization decisions

### Strategy Pattern

The system uses the strategy pattern to allow different randomization approaches:

- **TemplateSelectionStrategy** - How to select templates (weighted, shuffled, round-robin)
- **WordSelectionStrategy** - How to select words (context-aware, frequency-based, random)
- **SlotRandomizationStrategy** - How to randomize template slots (configurable, simple)
- **MutatorApplicationStrategy** - How to apply mutators (sequential, parallel)

## Usage

### Basic Usage

```typescript
import { 
  UnifiedRandomizationService, 
  RandomizationConfigManager 
} from './randomization/index.js';

// Get singleton instance
const configManager = RandomizationConfigManager.getInstance();

// Create service with default configuration
const randomizationService = configManager.createService();

// Use the service
const templates = [/* your templates */];
const result = randomizationService.selectTemplate(templates);
console.log('Selected template:', result.result);
```

### Configuration

```typescript
// Load from session profile
configManager.loadFromProfile(profile);

// Update specific settings
configManager.setSeed('my-seed');
configManager.setLoggingEnabled(true);

// Create new service with updated config
const service = configManager.createService();
```

### Seeded Randomization

```typescript
// Create service with seed for reproducible results
const config = {
  seed: 'reproducible-seed',
  enableLogging: true,
  strategies: { /* ... */ }
};

const service = new UnifiedRandomizationService(config);

// All randomization will be deterministic with this seed
const result1 = service.selectTemplate(templates);
const result2 = service.selectTemplate(templates);
// result1 and result2 will be identical
```

### Debugging

```typescript
// Enable logging
const service = new UnifiedRandomizationService({
  enableLogging: true,
  // ... other config
});

// Perform operations
service.selectTemplate(templates);
service.selectWord(candidates, 'NOUN', context);

// Get logs
const logs = service.getLogs();
console.log('Randomization decisions:', logs);

// Clear logs
service.clearLogs();
```

## Migration from Legacy Code

### Before (Scattered Logic)

```typescript
// In promptEngine.ts
const shuffled = [...templates].sort(() => Math.random() - 0.5);

// In fillTemplate.ts  
const word = candidates[Math.floor(Math.random() * candidates.length)];

// In templates.ts
return words[Math.floor(Math.random() * words.length)];
```

### After (Unified Service)

```typescript
// All randomization goes through the unified service
const result = randomizationService.selectTemplate(templates);
const word = randomizationService.selectWord(candidates, pos, context);
const randomWord = randomizationService.pickFromArray(words);
```

## Benefits

1. **Single Source of Truth** - All randomization logic in one place
2. **Consistent RNG** - Seeded random number generation for reproducibility
3. **Comprehensive Logging** - Easy to debug randomization decisions
4. **Configurable Strategies** - Easy to swap different randomization approaches
5. **Testable** - Each strategy can be unit tested independently
6. **Maintainable** - Changes to randomization logic only need to be made in one place
7. **Extensible** - Easy to add new randomization strategies

## Testing

Run the test suite:

```bash
npm run test src/lib/__tests__/randomization.test.ts
```

Tests cover:
- RNG implementations (seeded and unseeded)
- Template selection strategies
- Word selection strategies  
- Slot randomization strategies
- Configuration management
- Logging functionality

## Adding New Strategies

To add a new randomization strategy:

1. Implement the strategy interface
2. Add it to the strategy exports in `index.ts`
3. Update the default configuration in `RandomizationConfigManager`
4. Add tests for the new strategy

Example:

```typescript
// New strategy
export class MyCustomStrategy implements TemplateSelectionStrategy {
  select(templates: TemplateDoc[], weights?: number[], rng: RNG): TemplateDoc {
    // Your custom logic here
    return templates[0];
  }
}

// Update config manager
private createDefaultConfig(): RandomizationConfig {
  return {
    // ...
    strategies: {
      templateSelection: new MyCustomStrategy(), // Use your strategy
      // ... other strategies
    }
  };
}
```

## Performance Considerations

- The service uses singleton pattern to avoid recreating instances
- RNG instances are reused across operations
- Logging can be disabled in production for better performance
- Strategy instances are created once and reused

## Future Enhancements

- Add more sophisticated word selection strategies (semantic similarity, frequency-based)
- Implement caching for expensive randomization operations
- Add metrics collection for randomization effectiveness
- Support for custom RNG algorithms
- Integration with external randomization services
