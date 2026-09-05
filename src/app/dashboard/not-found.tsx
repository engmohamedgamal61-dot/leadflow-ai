import Link from "next/link";
import { getI18n } from "@/i18n/server";

export default async function DashboardNotFound() {
  const { t } = await getI18n();
  return (
    <div className="rounded-xl border border-border bg-surface px-6 py-14 text-center">
      <p className="text-sm font-medium text-foreground">{t("errors.notFound.title")}</p>
      <p className="mt-1 text-xs text-muted">{t("errors.notFound.text")}</p>
      <Link
        href="/dashboard"
        className="mt-4 inline-block rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
      >
        {t("errors.notFound.back")}
      </Link>
    </div>
  );
}
