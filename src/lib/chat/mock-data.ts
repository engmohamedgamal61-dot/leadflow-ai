/**
 * Fallback seed copy for the chat widget. The real strings come from the UI
 * dictionary (`chat.*`); these constants are only the English fallback used when
 * a component renders outside an `<I18nProvider>` (e.g. a unit test).
 */

export const ASSISTANT_GREETING = "Hi! 👋 How can I help you today?";

export const SUGGESTED_PROMPTS: readonly string[] = [
  "I'm looking for an apartment in Riyadh.",
  "I want to buy a villa in Jeddah.",
  "Do you have offices for rent in Riyadh?",
];

/** User/assistant turns (alternating, starting with the user) after the greeting. */
export const EXAMPLE_TURNS: readonly string[] = [
  "I'm looking for an apartment in Riyadh.",
  "Great. Which area are you interested in?",
  "North Riyadh.",
  "Perfect. What's your approximate budget?",
  "Around 800,000 SAR.",
];
