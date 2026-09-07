import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrganizationContext, canManageConfig } from "@/lib/org/context";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/i18n/server";
import { appBaseUrlOrNull } from "@/lib/app-url";
import {
  getEndpoint,
  listDeliveries,
  listInboundActions,
} from "@/lib/integrations/queries";
import { WebhookDetail } from "./webhook-detail";
import { WebhookInstructions } from "./webhook-instructions";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.integrations };
}

export default async function WebhookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { membership } = await requireOrganizationContext();
  const { t, locale } = await getI18n();
  const canManage = canManageConfig(membership.role);

  const supabase = await createClient();
  const endpoint = await getEndpoint(supabase, membership.organizationId, id);
  if (!endpoint) notFound();

  const [deliveries, inbound] = await Promise.all([
    listDeliveries(supabase, membership.organizationId, id, 30),
    listInboundActions(supabase, membership.organizationId, id, 20),
  ]);

  const base = appBaseUrlOrNull() ?? "";
  const inboundUrl = `${base}/api/webhooks/integrations/${id}`;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/settings/integrations"
          className="text-xs text-muted hover:text-foreground"
        >
          ← {t("integrationHub.detail.back")}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">
          {endpoint.name}
        </h1>
        <p className="mt-1 break-all text-sm text-muted">{endpoint.url}</p>
      </div>

      <WebhookDetail
        endpoint={endpoint}
        deliveries={deliveries}
        inbound={inbound}
        inboundUrl={inboundUrl}
        canManage={canManage}
        locale={locale}
      />

      <WebhookInstructions inboundUrl={inboundUrl} organizationId={membership.organizationId} />
    </div>
  );
}
