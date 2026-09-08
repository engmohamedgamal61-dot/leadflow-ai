/**
 * Ask LeadFlow — the allowlisted question intents.
 *
 * Pure, dependency-free, deterministic. The model NEVER chooses a query: a
 * plain keyword router maps the user's natural-language question to exactly one
 * of these fixed intents, each of which is backed by a bounded, tenant-scoped
 * server-side query (`retrieval.ts`). An unrecognised question falls back to
 * `priority_leads` ("who should we work first"), the most useful default.
 */

export const ASK_INTENTS = [
  "priority_leads",
  "needs_attention",
  "at_risk_leads",
  "upcoming_appointments",
  "overdue_followups",
  "recovery_opportunities",
  "recent_activity",
  "pipeline_summary",
  "weekly_changes",
] as const;

export type AskIntent = (typeof ASK_INTENTS)[number];

export const DEFAULT_INTENT: AskIntent = "priority_leads";

/**
 * Suggested questions shown as chips. Each is a dictionary key under
 * `askLeadFlow.suggestions.*`; the router resolves the localized text the same
 * way it resolves a typed question.
 */
export const SUGGESTED_QUESTION_KEYS = [
  "priorityLeads",
  "needsAttention",
  "atRisk",
  "closestToBooking",
  "weeklyChanges",
  "recoveryPriority",
  "todaySummary",
] as const;

export type SuggestedQuestionKey = (typeof SUGGESTED_QUESTION_KEYS)[number];

/**
 * Keyword sets per intent — English and Arabic. Matching is accent-insensitive
 * for Arabic (strip tashkeel) and case-insensitive for Latin. Order matters
 * only for the tie-break: earlier intents win an equal score.
 */
const KEYWORDS: Record<AskIntent, string[]> = {
  needs_attention: [
    "need attention", "needs attention", "attention today", "who needs",
    "urgent", "right now", "waiting on a reply", "unanswered",
    "انتباه", "اهتمام", "تحتاج انتباه", "يحتاجون انتباه", "بحاجة إلى انتباه",
    "عاجل", "بحاجة إلى اهتمام", "لم يتم الرد",
  ],
  at_risk_leads: [
    "at risk", "at-risk", "risk", "losing", "about to lose", "going cold", "slipping",
    "في خطر", "معرضة للخطر", "على وشك الخسارة", "نخسر",
  ],
  upcoming_appointments: [
    "appointment", "appointments", "booking", "booked", "closest to booking",
    "close to booking", "ready to book", "meeting", "meetings", "scheduled",
    "موعد", "مواعيد", "حجز", "الأقرب للحجز", "قريبة من الحجز", "جاهزة للحجز", "اجتماع",
  ],
  overdue_followups: [
    "follow up", "follow-up", "followup", "follow ups", "overdue", "due",
    "who should we follow up", "chase", "contact next",
    "متابعة", "متابعات", "متأخرة", "من نتابع", "من يجب أن نتابع",
  ],
  recovery_opportunities: [
    "recovery", "recover", "lost lead", "lost leads", "win back", "win-back",
    "re-engage", "reengage", "revive",
    "استعادة", "فرص الاستعادة", "استرجاع", "العملاء المفقودين", "الفرص الضائعة",
    "إعادة تفعيل", "العملاء المفقودون",
  ],
  recent_activity: [
    "activity", "what happened", "today's activity", "todays activity",
    "recent", "summarize today", "summary of today", "what's going on", "whats going on",
    "نشاط", "ماذا حدث", "نشاط اليوم", "ملخص اليوم", "لخّص اليوم", "لخص اليوم", "آخر التحديثات",
  ],
  pipeline_summary: [
    "pipeline", "overview", "how are we doing", "status of", "summary of the pipeline",
    "how many leads", "totals", "breakdown",
    "خط الأنابيب", "نظرة عامة", "كيف نبلي", "ملخص", "إجمالي", "كم عدد",
  ],
  weekly_changes: [
    "this week", "changed this week", "what changed", "week over week",
    "week-over-week", "past week", "last 7 days", "trend", "trends",
    "هذا الأسبوع", "ماذا تغير", "ما الذي تغير", "خلال الأسبوع", "آخر ٧ أيام", "الاتجاه",
  ],
  priority_leads: [
    "priority", "first", "who should we", "work first", "focus on",
    "most important", "top leads", "hottest", "best leads", "prioritize",
    "الأولوية", "أولا", "أولاً", "من نبدأ", "الأهم", "أفضل العملاء", "ركز على",
  ],
};

/** Arabic tashkeel (harakat) — stripped so "متابعة" matches "مُتابعة". */
const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(TASHKEEL, "")
    // unify alef variants + ta marbuta so Arabic keyword hits are robust
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

export interface RouteResult {
  intent: AskIntent;
  /** Number of keyword hits for the winning intent (0 → fell back to default). */
  score: number;
  /** True when the router matched at least one keyword. */
  matched: boolean;
}

/**
 * Deterministically map a question to one allowlisted intent. Never throws;
 * an empty or unmatched question returns {@link DEFAULT_INTENT}.
 */
export function routeQuestion(question: string): RouteResult {
  const q = normalize(question ?? "");
  if (!q) return { intent: DEFAULT_INTENT, score: 0, matched: false };

  let best: AskIntent = DEFAULT_INTENT;
  let bestScore = 0;

  for (const intent of ASK_INTENTS) {
    let score = 0;
    for (const kw of KEYWORDS[intent]) {
      if (q.includes(normalize(kw))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = intent;
    }
  }

  return { intent: best, score: bestScore, matched: bestScore > 0 };
}

/** The intent a suggested-question chip maps to (kept in sync with the dict). */
export const SUGGESTION_INTENT: Record<SuggestedQuestionKey, AskIntent> = {
  priorityLeads: "priority_leads",
  needsAttention: "needs_attention",
  atRisk: "at_risk_leads",
  closestToBooking: "upcoming_appointments",
  weeklyChanges: "weekly_changes",
  recoveryPriority: "recovery_opportunities",
  todaySummary: "recent_activity",
};
