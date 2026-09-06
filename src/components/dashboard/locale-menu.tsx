"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LOCALES, type Locale } from "@/i18n/config";
import { useI18n } from "@/i18n/client";
import { setLocaleAction } from "@/i18n/actions";
import { ChevronDownIcon } from "@/components/icons";

const LABEL_KEY: Record<Locale, string> = {
  en: "languageSwitcher.english",
  ar: "languageSwitcher.arabic",
};

/**
 * Top-bar locale control styled to the reference ("EN ▾" bordered button that
 * opens a short menu). Wraps the same `setLocaleAction` the chat/auth switcher
 * uses, so the shared component stays untouched.
 */
export function LocaleMenu() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (next: Locale) => {
    setOpen(false);
    if (next === locale || pending) return;
    startTransition(async () => {
      await setLocaleAction(next);
      router.refresh();
    });
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("languageSwitcher.label")}
        disabled={pending}
        className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-accent/40 disabled:opacity-50"
      >
        <span className="uppercase">{locale}</span>
        <ChevronDownIcon className="h-3.5 w-3.5 text-muted" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute end-0 z-50 mt-1.5 w-36 overflow-hidden rounded-xl border border-border bg-surface shadow-lg shadow-black/5"
        >
          {LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              role="menuitemradio"
              aria-checked={code === locale}
              lang={code}
              onClick={() => choose(code)}
              className={`block w-full px-3 py-2 text-start text-sm transition-colors hover:bg-background ${
                code === locale ? "font-medium text-accent" : "text-foreground"
              }`}
            >
              {t(LABEL_KEY[code])}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
