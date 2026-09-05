/**
 * Go-Live Readiness — a deterministic, pure summary of whether a workspace is
 * demo/sales ready. No I/O and no AI: the caller fetches the inputs (industry
 * template validity, WhatsApp/Calendar connection status, calendar booking
 * settings) and this turns them into a fixed checklist. Every signal is
 * grounded in data the product already stores — nothing is invented.
 */

export const READINESS_CHECKS = [
  "aiAgent",
  "whatsapp",
  "calendar",
  "bookingHours",
] as const;
export type ReadinessCheckKey = (typeof READINESS_CHECKS)[number];

export const READINESS_STATES = ["ready", "attention", "pending"] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

export interface ReadinessCheck {
  key: ReadinessCheckKey;
  state: ReadinessState;
  /** Dotted `dashboard.readiness.detail.*` dictionary key for the one-line status. */
  detailKey: string;
  /** Interpolation params for `detailKey`. */
  detailParams?: Record<string, string | number>;
  /** True when acting on this check means visiting a settings page (owner/admin only). */
  actionable: boolean;
}

export interface GoLiveReadiness {
  checks: ReadinessCheck[];
  readyCount: number;
  totalCount: number;
  /** No connection or config attention needed anywhere. */
  allReady: boolean;
}

export interface ReadinessInput {
  /** The organization's industry template resolves to a valid config. */
  templateValid: boolean;
  /** The organization has saved at least one AI-config override (vs. running on template defaults). */
  hasCustomConfig: boolean;
  /** 'connected' | 'error' | 'pending' | 'disconnected' | null (never connected). */
  whatsappStatus: string | null;
  whatsappLastError: string | null;
  calendarStatus: string | null;
  calendarLastError: string | null;
  /** Working days from the calendar's booking settings — only meaningful once the calendar is connected. */
  calendarWorkingDays: readonly number[];
}

function connectionCheck(
  key: ReadinessCheckKey,
  status: string | null,
  lastError: string | null,
): ReadinessCheck {
  if (status === "connected") {
    return { key, state: "ready", detailKey: `dashboard.readiness.detail.${key}Connected`, actionable: true };
  }
  if (status === "error") {
    return {
      key,
      state: "attention",
      detailKey: `dashboard.readiness.detail.${key}Error`,
      detailParams: lastError ? { error: lastError } : undefined,
      actionable: true,
    };
  }
  // pending / disconnected / null → not set up yet.
  return { key, state: "pending", detailKey: `dashboard.readiness.detail.${key}Pending`, actionable: true };
}

export function computeGoLiveReadiness(input: ReadinessInput): GoLiveReadiness {
  const checks: ReadinessCheck[] = [];

  // 1. AI agent — ready as long as the industry template resolves to a valid
  //    config (onboarding guarantees one). The detail just notes whether it's
  //    still on defaults or has been tuned.
  checks.push({
    key: "aiAgent",
    state: input.templateValid ? "ready" : "attention",
    detailKey: input.templateValid
      ? input.hasCustomConfig
        ? "dashboard.readiness.detail.aiAgentCustom"
        : "dashboard.readiness.detail.aiAgentDefaults"
      : "dashboard.readiness.detail.aiAgentInvalid",
    actionable: true,
  });

  // 2. WhatsApp channel.
  checks.push(connectionCheck("whatsapp", input.whatsappStatus, input.whatsappLastError));

  // 3. Calendar.
  const calendar = connectionCheck("calendar", input.calendarStatus, input.calendarLastError);
  checks.push(calendar);

  // 4. Booking hours — only a real check once the calendar is connected;
  //    otherwise it's blocked on step 3.
  if (input.calendarStatus === "connected") {
    checks.push({
      key: "bookingHours",
      state: input.calendarWorkingDays.length > 0 ? "ready" : "attention",
      detailKey:
        input.calendarWorkingDays.length > 0
          ? "dashboard.readiness.detail.bookingHoursSet"
          : "dashboard.readiness.detail.bookingHoursEmpty",
      detailParams:
        input.calendarWorkingDays.length > 0
          ? { days: input.calendarWorkingDays.length }
          : undefined,
      actionable: true,
    });
  } else {
    checks.push({
      key: "bookingHours",
      state: "pending",
      detailKey: "dashboard.readiness.detail.bookingHoursBlocked",
      actionable: true,
    });
  }

  const readyCount = checks.filter((c) => c.state === "ready").length;
  return {
    checks,
    readyCount,
    totalCount: checks.length,
    allReady: checks.every((c) => c.state === "ready"),
  };
}
