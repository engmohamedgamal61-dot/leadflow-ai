"use client";

import { useI18n } from "@/i18n/client";
import {
  INTEGRATION_EVENT_GROUPS,
  type IntegrationEventType,
} from "@/lib/integrations/events";

/**
 * The subscribed-events checklist, grouped. Emits one hidden-friendly
 * `<input name="events" value="lead.created" />` per checked event so the
 * server action reads them with `formData.getAll("events")`.
 */
export function EventPicker({
  selected,
  disabled,
}: {
  selected: readonly IntegrationEventType[];
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const chosen = new Set(selected);

  return (
    <div className="space-y-3">
      {INTEGRATION_EVENT_GROUPS.map((group) => (
        <fieldset key={group.key} className="space-y-1.5">
          <legend className="text-[11px] font-medium uppercase tracking-wide text-muted/70">
            {t(`integrationHub.events.groups.${group.key}`)}
          </legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {group.events.map((event) => (
              <label
                key={event}
                className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground"
              >
                <input
                  type="checkbox"
                  name="events"
                  value={event}
                  defaultChecked={chosen.has(event)}
                  disabled={disabled}
                  className="h-3.5 w-3.5 shrink-0 accent-accent"
                />
                <span className="min-w-0 truncate">
                  {t(`integrationHub.events.${event}`)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
