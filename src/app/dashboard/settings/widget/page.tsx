import type { Metadata } from "next";
import { requireOrganizationContext, canManageConfig } from "@/lib/org/context";
import { createClient } from "@/lib/supabase/server";
import { ensureWidgetSettings, getWidgetSettings } from "@/lib/org/widget";
import { widgetEmbedSnippet, widgetPreviewUrl } from "@/lib/org/widget-embed";
import { appBaseUrlOrNull } from "@/lib/app-url";
import { WidgetIcon } from "@/components/icons";
import { getI18n } from "@/i18n/server";
import { WidgetForm } from "./widget-form";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.widget };
}

export default async function WidgetSettingsPage() {
  const { membership } = await requireOrganizationContext();
  const { t } = await getI18n();
  const canManage = canManageConfig(membership.role);

  const db = await createClient();
  const settings = canManage
    ? await ensureWidgetSettings(db, membership.organizationId)
    : await getWidgetSettings(db, membership.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-foreground">
          <WidgetIcon className="h-6 w-6 shrink-0 text-muted" />
          {t("widget.title")}
        </h1>
        <p className="mt-1 text-sm text-muted">{t("widget.subtitle")}</p>
        {!canManage ? (
          <p className="mt-2 inline-block rounded-md border border-border bg-background px-2 py-1 text-xs text-muted">
            {t("widget.readonly")}
          </p>
        ) : null}
      </div>

      {!canManage || !settings ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-8 text-sm text-muted">
          {settings
            ? settings.enabled
              ? t("widget.enabledHint")
              : t("widget.disabledHint")
            : t("widget.notConfigured")}
        </p>
      ) : (
        (() => {
          const base = appBaseUrlOrNull();
          return (
            <WidgetForm
              enabled={settings.enabled}
              widgetKey={settings.widgetKey}
              embedSnippet={widgetEmbedSnippet(base, settings.widgetKey)}
              previewUrl={widgetPreviewUrl(base, settings.widgetKey)}
              originsText={settings.allowedOrigins.join("\n")}
            />
          );
        })()
      )}
    </div>
  );
}
