"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganizationContext, canManageConfig } from "@/lib/org/context";
import {
  ensureWidgetSettings,
  updateWidgetSettings,
  parseAllowedOrigins,
} from "@/lib/org/widget";

export interface WidgetFormState {
  ok?: boolean;
  errorCode?: string;
  invalidOrigins?: string[];
}

async function guard() {
  const { membership } = await requireOrganizationContext();
  if (!canManageConfig(membership.role)) {
    return { ok: false as const, errorCode: "widget.errors.notAllowed" };
  }
  return { ok: true as const, organizationId: membership.organizationId };
}

export async function setWidgetEnabledAction(
  _prev: WidgetFormState,
  formData: FormData,
): Promise<WidgetFormState> {
  const g = await guard();
  if (!g.ok) return { errorCode: g.errorCode };

  const db = await createClient();
  await ensureWidgetSettings(db, g.organizationId);
  const enabled = String(formData.get("enabled")) === "true";
  const done = await updateWidgetSettings(db, g.organizationId, { enabled });
  if (!done) return { errorCode: "widget.errors.saveFailed" };
  revalidatePath("/dashboard/settings/widget");
  return { ok: true };
}

export async function rotateWidgetKeyAction(): Promise<WidgetFormState> {
  const g = await guard();
  if (!g.ok) return { errorCode: g.errorCode };

  const db = await createClient();
  await ensureWidgetSettings(db, g.organizationId);
  const done = await updateWidgetSettings(db, g.organizationId, {
    widget_key: randomUUID(),
  });
  if (!done) return { errorCode: "widget.errors.saveFailed" };
  revalidatePath("/dashboard/settings/widget");
  return { ok: true };
}

export async function saveWidgetOriginsAction(
  _prev: WidgetFormState,
  formData: FormData,
): Promise<WidgetFormState> {
  const g = await guard();
  if (!g.ok) return { errorCode: g.errorCode };

  const parsed = parseAllowedOrigins(formData.get("origins"));
  if (!parsed.ok) {
    return { errorCode: "widget.errors.invalidOrigins", invalidOrigins: parsed.invalid };
  }

  const db = await createClient();
  await ensureWidgetSettings(db, g.organizationId);
  const done = await updateWidgetSettings(db, g.organizationId, {
    allowed_origins: parsed.origins,
  });
  if (!done) return { errorCode: "widget.errors.saveFailed" };
  revalidatePath("/dashboard/settings/widget");
  return { ok: true };
}
