"use client";

import { useI18n } from "@/i18n/client";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from "@/lib/integrations/signature";

export function WebhookInstructions({
  inboundUrl,
  organizationId,
}: {
  inboundUrl: string;
  organizationId: string;
}) {
  const { t } = useI18n();

  const envelope = JSON.stringify(
    {
      id: "9f1c…",
      type: "lead.qualified",
      occurred_at: "2026-09-07T10:00:00.000Z",
      organization_id: organizationId,
      data: {
        lead: {
          id: "…",
          name: "Sara Ahmed",
          status: "qualified",
          temperature: "hot",
          score: 82,
        },
      },
    },
    null,
    2,
  );

  const inboundExample = JSON.stringify(
    {
      id: "my-idempotency-key-123",
      action: "update_lead_status",
      leadId: "00000000-0000-0000-0000-000000000000",
      status: "contacted",
    },
    null,
    2,
  );

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-foreground">
        {t("integrationHub.instructions.title")}
      </h2>

      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold text-foreground">
          {t("integrationHub.instructions.outboundTitle")}
        </h3>
        <p className="text-xs leading-relaxed text-muted">
          {t("integrationHub.instructions.outboundBody")}
        </p>
        <p className="text-[11px] text-muted/70" dir="ltr">
          <code>{TIMESTAMP_HEADER}</code>, <code>{SIGNATURE_HEADER}</code>
        </p>
      </div>

      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold text-foreground">
          {t("integrationHub.instructions.envelopeExample")}
        </h3>
        <pre dir="ltr" className="overflow-x-auto rounded-lg border border-border bg-background/50 p-3 text-[11px] leading-relaxed text-foreground">
          {envelope}
        </pre>
      </div>

      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold text-foreground">
          {t("integrationHub.instructions.inboundTitle")}
        </h3>
        <p className="text-xs leading-relaxed text-muted">
          {t("integrationHub.instructions.inboundBody")}
        </p>
        <p className="text-[11px] text-muted/70">
          <code dir="ltr" className="inline-block break-all">POST {inboundUrl}</code>
        </p>
        <pre dir="ltr" className="overflow-x-auto rounded-lg border border-border bg-background/50 p-3 text-[11px] leading-relaxed text-foreground">
          {inboundExample}
        </pre>
      </div>

      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold text-foreground">
          {t("integrationHub.instructions.n8nTitle")}
        </h3>
        <p className="text-xs leading-relaxed text-muted">
          {t("integrationHub.instructions.n8nBody")}
        </p>
      </div>
    </section>
  );
}
