"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/lib/supabase/types";
import { requireOrganizationContext } from "@/lib/org/context";
import { canManageConfig } from "@/lib/org/roles";
import { validateCalendarSettingsInput } from "@/lib/calendar/config";

export interface CalendarFormState {
  ok?: boolean;
  /** Dotted dictionary key for a success message. */
  messageCode?: string;
  /** Dotted dictionary key for an error. */
  errorCode?: string;
  /** Raw validator message codes (`calendar.validation.*`). */
  details?: string[];
}

/** owner/admin only — same set as WhatsApp / org config (a connection holds credentials). */
async function requireConnectionAdmin() {
  const { membership } = await requireOrganizationContext();
  if (!canManageConfig(membership.role)) {
    return { ok: false as const, errorCode: "calendar.errors.onlyOwnerAdmin" };
  }
  return { ok: true as const, membership };
}

export async function disconnectCalendarAction(): Promise<CalendarFormState> {
  const guard = await requireConnectionAdmin();
  if (!guard.ok) return { errorCode: guard.errorCode };

  const supabase = await createClient();
  const { error } = await supabase
    .from("organization_calendar_connections")
    .update({
      status: "disconnected",
      access_token_encrypted: null,
      refresh_token_encrypted: null,
      last_error: null,
    })
    .eq("organization_id", guard.membership.organizationId)
    .select("id");
  if (error) return { errorCode: "calendar.errors.noPermission" };

  revalidatePath("/dashboard/settings/integrations");
  return { ok: true, messageCode: "calendar.results.disconnected" };
}

export async function updateCalendarSettingsAction(
  _prev: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  const guard = await requireConnectionAdmin();
  if (!guard.ok) return { errorCode: guard.errorCode };

  const v = validateCalendarSettingsInput({
    timezone: formData.get("timezone"),
    workingDays: formData.getAll("workingDays").map(String),
    startMinute: formData.get("startMinute"),
    endMinute: formData.get("endMinute"),
    slotMinutes: formData.get("slotMinutes"),
    lookaheadDays: formData.get("lookaheadDays"),
    minNoticeMinutes: formData.get("minNoticeMinutes"),
  });
  if (!v.ok) {
    return { errorCode: "calendar.errors.fixDetails", details: v.errors };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("organization_calendar_connections")
    .update({
      settings: v.clean as unknown as TablesInsert<"organization_calendar_connections">["settings"],
    })
    .eq("organization_id", guard.membership.organizationId)
    .select("id");
  if (error) return { errorCode: "calendar.errors.noPermission" };

  revalidatePath("/dashboard/settings/integrations");
  return { ok: true, messageCode: "calendar.results.settingsSaved" };
}
