"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LOCALES, type Locale } from "@/i18n/config";
import { useI18n } from "@/i18n/client";
import { setLocaleAction } from "@/i18n/actions";

const LABEL_KEY: Record<Locale, string> = {
  en: "languageSwitcher.english",
  ar: "languageSwitcher.arabic",
};

interface LanguageSwitcherProps {
  /** Visual density. `compact` suits dense chrome like the dashboard header. */
  size?: "default" | "compact";
  className?: string;
}

export function LanguageSwitcher({
  size = "default",
  className,
}: LanguageSwitcherProps) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const choose = (next: Locale) => {
    if (next === locale || pending) return;
    startTransition(async () => {
      await setLocaleAction(next);
      router.refresh();
    });
  };

  const pad = size === "compact" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";

  return (
    <div
      role="group"
      aria-label={t("languageSwitcher.label")}
      className={`inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 ${
        className ?? ""
      }`}
    >
      {LOCALES.map((code) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type="button"
            lang={code}
            aria-pressed={active}
            disabled={pending}
            onClick={() => choose(code)}
            className={`rounded-md font-medium transition-colors disabled:opacity-50 ${pad} ${
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t(LABEL_KEY[code])}
          </button>
        );
      })}
    </div>
  );
}
