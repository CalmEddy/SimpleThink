# Prompter

Thin orchestrator around the existing Composer/UTA pipeline:
1. Select a TemplateDoc (random/weighted)
2. Apply optional on-the-fly mutators (no new processing logic)
3. Reuse `parseTextPatternsToUTA` → `convertTemplateDocToUnified` → `realizeTemplate`
4. Return final `prompt` + debug

## Minimal usage
```ts
import { Prompter, mutatorJitter30, mutatorAutoBind } from "./index";

const prompter = new Prompter({
  source: async () => myTemplateDocs,       // supply TemplateDoc[]
  mutators: [mutatorJitter30, mutatorAutoBind]
});

const { prompt } = await prompter.generate({ graph, bank: { NOUN: ["idea","banana"] } });
console.log(prompt);
```

No duplication—Prompter calls the same functions the Composer uses.
