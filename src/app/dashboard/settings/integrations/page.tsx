import type { Metadata } from "next";
import { requireOrganizationContext, canManageConfig } from "@/lib/org/context";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/leads/format";
import { getI18n } from "@/i18n/server";
import { getConnectionView } from "@/lib/calendar/connections";
import { getWhatsAppConnectionView } from "@/lib/whatsapp/connections";
import { WhatsAppSettings } from "./whatsapp-form";
import { GoogleCalendarSettings } from "./calendar-form";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.integrations };
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string }>;
}) {
  const { membership } = await requireOrganizationContext();
  const { t, locale } = await getI18n();
  const canManage = canManageConfig(membership.role);
  const { calendar: calendarParam } = await searchParams;

  const supabase = await createClient();
  const [connection, calendarConnection] = await Promise.all([
    getWhatsAppConnectionView(supabase, membership.organizationId),
    getConnectionView(supabase, membership.organizationId),
  ]);

  const calendarBanner = calendarParam
    ? calendarParam === "connected"
      ? { kind: "ok" as const, code: "calendar.results.connected" }
      : { kind: "error" as const, code: `calendar.errors.${calendarParam.replace(/^error_/, "")}` }
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          {t("integrations.title")}
        </h1>
        <p className="mt-1 text-sm text-muted">{t("integrations.subtitle")}</p>
        {!canManage ? (
          <p className="mt-2 inline-block rounded-md border border-border bg-background px-2 py-1 text-xs text-muted">
            {t("integrations.readonly")}
          </p>
        ) : null}
      </div>

      <GoogleCalendarSettings
        connection={calendarConnection}
        canManage={canManage}
        lastUpdated={calendarConnection ? formatDateTime(calendarConnection.updatedAt, locale) : null}
        connectUrl="/api/integrations/google-calendar/start"
        banner={calendarBanner}
      />

      <WhatsAppSettings
        connection={connection}
        canManage={canManage}
        lastUpdated={
          connection ? formatDateTime(connection.updatedAt, locale) : null
        }
      />
    </div>
  );
}
