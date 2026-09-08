"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/client";
import { formatDateTime, formatNumber } from "@/i18n/format";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import {
  ActionBadge,
  PriorityBadge,
  StatusBadge,
  TemperatureBadge,
} from "@/components/dashboard/badges";
import { AiAgentIcon, ArrowIcon, LeadsIcon } from "@/components/icons";
import { askLeadFlowAction } from "@/lib/sales-manager/actions";
import type { AskResult } from "@/lib/sales-manager/orchestration";

interface Turn {
  id: string;
  question: string;
  status: "loading" | "done" | "error";
  result?: AskResult;
  errorCode?: string;
}

const NBA_ACTIONS = new Set([
  "call_now",
  "follow_up",
  "reply_now",
  "book_appointment",
  "human_handoff",
  "recover_lead",
  "none",
]);

export function AskPanel({
  suggestions,
}: {
  suggestions: { key: string; text: string }[];
}) {
  const { t, tOptional, locale } = useI18n();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollAnchor = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    const id = `turn-${(nextId.current += 1)}`;
    setPending(true);
    setInput("");
    setTurns((prev) => [...prev, { id, question: q, status: "loading" }]);
    requestAnimationFrame(() =>
      scrollAnchor.current?.scrollIntoView({ behavior: "smooth", block: "end" }),
    );

    try {
      const res = await askLeadFlowAction(q);
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === id
            ? res.ok
              ? { ...turn, status: "done", result: res.data }
              : { ...turn, status: "error", errorCode: res.errorCode }
            : turn,
        ),
      );
    } catch {
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === id
            ? { ...turn, status: "error", errorCode: "askLeadFlow.errors.unavailable" }
            : turn,
        ),
      );
    } finally {
      setPending(false);
      requestAnimationFrame(() =>
        scrollAnchor.current?.scrollIntoView({ behavior: "smooth", block: "end" }),
      );
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface">
      {/* Transcript */}
      <div className="max-h-[62vh] space-y-6 overflow-y-auto px-4 py-5 sm:px-5">
        {turns.length === 0 ? (
          <EmptyIntro
            title={t("askLeadFlow.empty.title")}
            hint={t("askLeadFlow.empty.hint")}
          />
        ) : (
          turns.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              t={t}
              tOptional={tOptional}
              locale={locale}
            />
          ))
        )}
        <div ref={scrollAnchor} />
      </div>

      {/* Suggested questions */}
      <div className="flex flex-wrap gap-2 border-t border-border px-4 pt-3 sm:px-5">
        {suggestions.map((s) => (
          <button
            key={s.key}
            type="button"
            disabled={pending}
            onClick={() => ask(s.text)}
            className="rounded-full border border-border bg-background px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-accent/40 hover:text-foreground disabled:opacity-50"
          >
            {s.text}
          </button>
        ))}
      </div>

      {/* Composer */}
      <form
        className="flex items-end gap-2 px-4 py-3 sm:px-5"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(input);
            }
          }}
          rows={1}
          maxLength={500}
          placeholder={t("askLeadFlow.placeholder")}
          aria-label={t("askLeadFlow.placeholder")}
          className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent/60"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          aria-label={t("askLeadFlow.send")}
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowIcon className="h-4 w-4 rtl:-scale-x-100" />
        </button>
      </form>
    </div>
  );
}

function EmptyIntro({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <AiAgentIcon className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-xs text-muted">{hint}</p>
    </div>
  );
}

type T = (key: string, params?: Record<string, string | number>) => string;
type TOpt = (key: string, params?: Record<string, string | number>) => string | undefined;

function TurnView({
  turn,
  t,
  tOptional,
  locale,
}: {
  turn: Turn;
  t: T;
  tOptional: TOpt;
  locale: "en" | "ar";
}) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <p className="max-w-[80%] rounded-2xl rounded-ee-sm bg-accent/10 px-3.5 py-2 text-sm text-foreground">
          {turn.question}
        </p>
      </div>

      {turn.status === "loading" ? (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-accent" />
          {t("askLeadFlow.thinking")}
        </div>
      ) : turn.status === "error" ? (
        <p
          role="alert"
          className="rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-2 text-sm text-rose-700"
        >
          {t(turn.errorCode ?? "askLeadFlow.errors.unavailable")}
        </p>
      ) : turn.result ? (
        <AnswerView result={turn.result} t={t} tOptional={tOptional} locale={locale} />
      ) : null}
    </div>
  );
}

function AnswerView({
  result,
  t,
  tOptional,
  locale,
}: {
  result: AskResult;
  t: T;
  tOptional: TOpt;
  locale: "en" | "ar";
}) {
  const answerText = result.answer ?? (result.answerKey ? t(result.answerKey) : "");
  const { metrics, leads, appointments, activity } = result.result;
  const hasCards = leads.length > 0 || appointments.length > 0 || activity.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <AiAgentIcon className="h-3.5 w-3.5" />
        </span>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {answerText}
        </p>
      </div>

      {result.state === "limit_reached" ? (
        <Link
          href="/dashboard/settings/usage"
          className="ms-8 inline-block text-xs font-medium text-accent hover:underline"
        >
          {t("askLeadFlow.viewUsage")}
        </Link>
      ) : null}

      {metrics.length > 0 ? (
        <div className="ms-8 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {metrics.map((m) => (
            <div
              key={m.key}
              className="rounded-lg border border-border bg-background/50 px-3 py-2"
            >
              <p className="text-[10.5px] uppercase tracking-wide text-muted">
                {tOptional(`askLeadFlow.metrics.${m.key}`) ?? m.key}
              </p>
              <p className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
                {typeof m.value === "number" ? formatNumber(m.value, locale) : m.value}
                {typeof m.delta === "number" && m.delta !== 0 ? (
                  <span
                    className={`ms-1 text-[11px] font-medium ${
                      m.delta > 0 ? "text-emerald-600" : "text-amber-600"
                    }`}
                  >
                    {m.delta > 0 ? "+" : "−"}
                    {Math.abs(m.delta)}
                  </span>
                ) : null}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {leads.length > 0 ? (
        <ul className="ms-8 space-y-1.5">
          {leads.map((card) => (
            <li key={`${card.id}-${card.reasonKey ?? card.tag ?? ""}`}>
              <Link
                href={card.href}
                className="flex items-start gap-2.5 rounded-lg border border-border bg-background/50 px-3 py-2 transition-colors hover:border-accent/40"
              >
                <LeadsIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-medium text-foreground">
                      {card.name?.trim() || t("common.unnamedLead")}
                    </span>
                    {card.status ? <StatusBadge value={card.status} /> : null}
                    {card.temperature ? <TemperatureBadge value={card.temperature} /> : null}
                    {card.tag && ["high", "medium", "low"].includes(card.tag) ? (
                      <PriorityBadge value={card.tag} />
                    ) : card.tag && NBA_ACTIONS.has(card.tag) && card.tag !== "none" ? (
                      <ActionBadge value={card.tag} />
                    ) : null}
                  </div>
                  {card.reasonKey ? (
                    <p className="mt-0.5 text-[11.5px] text-muted">
                      {tOptional(card.reasonKey, card.reasonParams) ?? ""}
                    </p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {appointments.length > 0 ? (
        <ul className="ms-8 space-y-1.5">
          {appointments.map((a) => (
            <li key={a.id}>
              <Link
                href={a.href}
                className="flex items-center gap-2.5 rounded-lg border border-border bg-background/50 px-3 py-2 transition-colors hover:border-accent/40"
              >
                <LeadsIcon className="h-4 w-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                  {a.leadName?.trim() || t("common.unnamedLead")}
                </span>
                <span className="shrink-0 text-[11.5px] text-muted">
                  {formatDateTime(a.startsAt, locale)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {activity.length > 0 ? (
        <div className="ms-8 overflow-hidden rounded-lg border border-border">
          <ActivityFeed events={activity} max={8} />
        </div>
      ) : null}

      {!hasCards && metrics.length === 0 && result.state === "no_data" ? null : null}
    </div>
  );
}
