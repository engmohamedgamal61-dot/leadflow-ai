/**
 * Calendar provider registry. Adding Outlook / Calendly later is one adapter
 * module + one line here — nothing in `service.ts`, the AI pipeline, or the
 * dashboard changes. Mirrors `lib/config/registry.ts`.
 */

import type { CalendarProvider, CalendarProviderId } from "./provider.ts";
import { createGoogleCalendarProvider } from "./google/client.ts";

let googleProvider: CalendarProvider | undefined;

/** Lazily constructed so the transport picks up `CALENDAR_MOCK_TRANSPORT` at call time (test-friendly). */
function getGoogleProvider(): CalendarProvider {
  if (!googleProvider) googleProvider = createGoogleCalendarProvider();
  return googleProvider;
}

export function getCalendarProvider(id: CalendarProviderId): CalendarProvider {
  switch (id) {
    case "google":
      return getGoogleProvider();
    default:
      throw new Error(`No calendar provider registered for "${id}"`);
  }
}

/** Test-only seam: replace the cached Google provider (e.g. with a fake). */
export function __setGoogleProviderForTests(provider: CalendarProvider | undefined): void {
  googleProvider = provider;
}
