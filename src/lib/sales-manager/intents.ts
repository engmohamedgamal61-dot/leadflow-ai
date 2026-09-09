/**
 * Ask LeadFlow — the OFFLINE keyword classifier.
 *
 * Pure, dependency-free, deterministic. The primary path is the AI query
 * planner (`plan.ts` + `answer.ts`), which turns a free-text question into a
 * bounded plan of data operations. `routeQuestion` here is only the FALLBACK
 * used when that planner call is unavailable (no API key, an error, or the org
 * is over its usage limit): it maps the question to one of these coarse
 * intents, which `plan.ts` `INTENT_TO_OPERATION` then turns into a single
 * bounded operation. An unrecognised question falls back to `priority_leads`.
 */

export const ASK_INTENTS = [
  // deterministic count / breakdown intents (answered without a 2nd AI call)
  "total_leads",
  "lead_count_by_status",
  "lead_count_by_opportunity",
  "lead_source_breakdown",
  "qualified_leads",
  "appointment_count",
  "follow_up_count",
  "conversion_summary",
  // AI-phrased list / summary intents
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
  total_leads: [
    "how many leads", "how many leads do i have", "how many clients",
    "total leads", "lead count", "number of leads", "count of leads",
    "leads in total", "leads do i have",
    "كام عميل", "كم عميل", "عدد العملاء", "كام عميل عندي", "كم عدد العملاء",
    "كام lead", "كام ليد", "عندي كام عميل", "اجمالي العملاء", "عدد العملا",
  ],
  lead_count_by_status: [
    "by status", "per status", "leads by status", "count by status",
    "how many in each status", "status breakdown", "pipeline stage",
    "حسب الحاله", "حسب المرحله", "لكل حاله", "توزيع الحالات", "العملاء حسب الحاله",
  ],
  lead_count_by_opportunity: [
    "by opportunity", "opportunity level", "by temperature", "hot warm cold",
    "how many hot", "how many strong", "strong opportunities", "how many warm",
    "how many cold", "how strong",
    "حسب الفرصه", "مستوى الفرصه", "كام فرصه قويه", "فرص قويه", "كم فرصه قويه",
    "الفرص القويه", "حسب الحراره",
  ],
  lead_source_breakdown: [
    "lead source", "sources", "leads come from", "leads coming from", "come from",
    "where do leads come from", "where are leads coming from",
    "channel breakdown", "by source", "source breakdown", "which channels",
    "مصدر العملاء", "مصادر العملاء", "من اين ياتي العملاء", "من وين", "حسب المصدر",
    "قنوات", "توزيع المصادر",
  ],
  qualified_leads: [
    "qualified leads", "qualified", "how many qualified", "which are qualified",
    "show me qualified", "leads qualified",
    "العملاء المؤهلين", "المؤهلين", "كام مؤهل", "عملاء مؤهلين", "lead qualified",
    "ليد مؤهل", "كام lead qualified",
  ],
  appointment_count: [
    "how many appointments", "how many appointments do i have", "how many meetings",
    "how many meetings do i have", "appointment count", "number of appointments",
    "count of appointments", "how many bookings", "how many appointments this",
    "كام موعد", "كم موعد", "عدد المواعيد", "كام حجز", "عدد الحجوزات", "كام موعد عندي",
  ],
  follow_up_count: [
    "how many follow ups", "how many follow-ups", "how many followups",
    "follow up count", "number of follow ups", "how many are overdue",
    "how many due", "how many follow ups are pending", "how many follow-ups do i have",
    "how many follow ups do i have", "follow ups do i have",
    "كام متابعه", "كم متابعه", "عدد المتابعات", "كام متابعه متاخره", "كام متابعه عندي",
  ],
  conversion_summary: [
    "conversion", "conversion rate", "win rate", "close rate", "how many won",
    "how many did we win", "how many closed", "won vs lost", "conversion summary",
    "معدل التحويل", "نسبه التحويل", "معدل الاغلاق", "كام صفقه كسبنا", "كام عميل كسبنا",
    "نسبه الكسب", "المكسوب مقابل الخساره",
  ],
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
    "pipeline", "overview", "how are we doing", "state of the pipeline",
    "summary of the pipeline", "pipeline health", "where do we stand",
    "خط الأنابيب", "نظرة عامة", "كيف نبلي", "ملخص خط المبيعات", "حاله خط المبيعات",
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
