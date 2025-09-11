/**
 * This test exists to *prevent regressions* where someone (or AI) reintroduces
 * direct realizeTemplate calls from legacy modules.
 */

describe("pipeline guard", () => {
  it("prevents direct realizeTemplate usage", () => {
    // Import the guardrail function
    const { __FORBID_DIRECT_REALIZE_TEMPLATE__ } = require("../lib/promptEngine");
    
    // This should throw an error
    expect(() => __FORBID_DIRECT_REALIZE_TEMPLATE__()).toThrow(
      "Direct realizeTemplate usage from promptEngine is forbidden. Use Prompter (UTA) instead."
    );
  });

  it("demonstrates Prompter integration", async () => {
    // Import the Prompter
    const { Prompter, mutatorJitter30 } = await import("../lib/prompter/index.js");
    
    // Create a simple template
    const templates = [{
      id: "test-template",
      blocks: [{
        kind: 'text' as const,
        text: 'Hello [NOUN]',
        analysis: undefined
      }],
      createdInSessionId: "test-session"
    }];

    // Create Prompter
    const prompter = new Prompter({
      source: templates,
      mutators: [mutatorJitter30],
    });

    // Generate a prompt
    const result = await prompter.generate({
      graph: undefined,
      bank: { NOUN: ['world', 'universe'] }
    });

    // Verify it generated something
    expect(result.prompt).toBeTruthy();
    expect(typeof result.prompt).toBe('string');
    expect(result.templateId).toBe("test-template");
  });
});
