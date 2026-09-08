import type { Metadata } from "next";
import { requireOrganizationContext, canManageConfig } from "@/lib/org/context";
import { getI18n } from "@/i18n/server";
import { AiAgentIcon } from "@/components/icons";
import { SUGGESTED_QUESTION_KEYS } from "@/lib/sales-manager/intents";
import { AskPanel } from "./ask-panel";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.ask };
}

export default async function AskLeadFlowPage() {
  const { membership } = await requireOrganizationContext();
  const { t } = await getI18n();
  const canManage = canManageConfig(membership.role);

  const heading = (
    <div>
      <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-foreground">
        <AiAgentIcon className="h-6 w-6 shrink-0 text-muted" />
        {t("askLeadFlow.title")}
      </h1>
      <p className="mt-1 text-sm text-muted">{t("askLeadFlow.subtitle")}</p>
    </div>
  );

  if (!canManage) {
    return (
      <div className="space-y-6">
        {heading}
        <p className="rounded-xl border border-border bg-surface px-4 py-8 text-sm text-muted">
          {t("askLeadFlow.noAccess")}
        </p>
      </div>
    );
  }

  const suggestions = SUGGESTED_QUESTION_KEYS.map((key) => ({
    key,
    text: t(`askLeadFlow.suggestions.${key}`),
  }));

  return (
    <div className="space-y-6">
      {heading}
      <AskPanel suggestions={suggestions} />
    </div>
  );
}
