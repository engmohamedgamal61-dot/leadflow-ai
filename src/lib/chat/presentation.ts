/**
 * Ask LeadFlow — the customer-facing chat SHELL (welcome message, subtitle,
 * starter prompts, example conversation), resolved per organization.
 *
 * Pure and dependency-light so it runs under `node --test`. The industry copy
 * lives in the i18n dictionary (`industries.<slug>.chat`, one block per locale
 * per industry); the business name comes from the trusted server-side tenant
 * resolution. An unknown / missing industry falls back to the NEUTRAL
 * `industries.generic.chat` block — never to real-estate (or any other
 * industry's) content.
 *
 * There are NO industry `if`s here or anywhere downstream: the only mapping
 * from an industry slug to its copy is the dictionary lookup below.
 */

// Relative value import so this module + its tests run under `node --test`.
import { hasIndustryTemplate } from "../config/registry.ts";
import type { Dictionary } from "@/i18n/dictionaries";

/** One industry's chat-shell strings, as stored in `industries.<slug>.chat`. */
export interface ChatShellCopy {
  greeting: string;
  subtitle: string;
  suggestedPrompts: readonly string[];
  example: readonly string[];
}

export interface ChatPresentation {
  /** The resolved industry template slug, or `null` when there is no org / an unknown industry. */
  industrySlug: string | null;
  /** The organization's display name, or `null` (→ the UI shows its neutral title). */
  businessName: string | null;
  greeting: string;
  subtitle: string;
  /** 0–4 starter prompts. Empty for the generic fallback — never real-estate prompts. */
  suggestedPrompts: string[];
  /** Alternating user/assistant turns for "see an example"; empty → the button is hidden. */
  example: string[];
}

const MAX_SUGGESTED_PROMPTS = 4;

/** The `industries` map is open-ended at the type level; narrow one entry's `chat`. */
function shellFor(dict: Dictionary, slug: string | null): {
  copy: ChatShellCopy;
  resolvedSlug: string | null;
} {
  const industries = dict.industries as Record<
    string,
    { chat?: ChatShellCopy } | undefined
  >;
  const generic = (industries.generic as { chat: ChatShellCopy }).chat;

  if (slug && hasIndustryTemplate(slug)) {
    const entry = industries[slug];
    if (entry?.chat) return { copy: entry.chat, resolvedSlug: slug };
  }
  return { copy: generic, resolvedSlug: null };
}

/**
 * Compose the chat presentation for one request.
 *
 * @param industrySlug  the org's `industry_template_id` (from the trusted
 *                       server resolution), or `null`
 * @param businessName  the org's name (from the same trusted resolution), or `null`
 * @param dict          the resolved locale dictionary
 */
export function resolveChatPresentation(input: {
  industrySlug: string | null;
  businessName: string | null;
  dict: Dictionary;
}): ChatPresentation {
  const { copy, resolvedSlug } = shellFor(input.dict, input.industrySlug);
  const name = input.businessName?.trim();
  return {
    industrySlug: resolvedSlug,
    businessName: name && name.length > 0 ? name : null,
    greeting: copy.greeting,
    subtitle: copy.subtitle,
    suggestedPrompts: [...copy.suggestedPrompts].slice(0, MAX_SUGGESTED_PROMPTS),
    example: [...copy.example],
  };
}

/** The neutral fallback presentation for a request with no organization. */
export function genericChatPresentation(dict: Dictionary): ChatPresentation {
  return resolveChatPresentation({ industrySlug: null, businessName: null, dict });
}
