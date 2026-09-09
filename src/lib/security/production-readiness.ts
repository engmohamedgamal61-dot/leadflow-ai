/**
 * Startup safety checks for a production deployment. Pure + testable —
 * `src/instrumentation.ts` runs it once at boot.
 *
 * `errors` are fatal: a missing or obviously-placeholder secret means the app
 * would run insecurely, so `assertProductionReadiness` throws and the process
 * fails to start (fail closed).
 *
 * `warnings` cover settings this code cannot verify from inside the app —
 * chiefly Supabase dashboard toggles (`SECURE_PASSWORD_CHANGE`, SMTP, email
 * confirmation). They are logged loudly. Set `LEADFLOW_PRODUCTION_CHECKS_ACK`
 * to a comma-separated list of the acknowledgements below (or `all`) once the
 * operator has confirmed them, to silence the corresponding warning.
 *
 * See `docs/PRODUCTION-SECURITY.md` for what each item means.
 */

export type Env = Record<string, string | undefined>;

export interface ReadinessReport {
  errors: string[];
  warnings: string[];
}

/** The acknowledgement tokens `LEADFLOW_PRODUCTION_CHECKS_ACK` understands. */
export const ACK_TOKENS = [
  "secure-password-change", // Supabase Auth → "Secure password change" is ON
  "email-confirmation", // Supabase Auth → email confirmations ON + real SMTP
  "redirect-urls", // Supabase Auth → URL config has /auth/confirm entries
  "trusted-proxy", // RATE_LIMIT_* configured for the platform, or acknowledged
  "network-egress", // outbound egress allowlist / firewall in place
  "no-demo-orgs", // demo orgs are NOT seeded in this database
] as const;

const PLACEHOLDER_RE =
  /^(dev-|test-|changeme|placeholder|example|your-|xxx|todo|<)/i;

/** A 64-char string that is a single character repeated — a dev encryption key. */
function isRepeatedCharKey(v: string): boolean {
  return v.length >= 32 && /^(.)\1+$/.test(v);
}

/** The bundled Supabase local/demo keys (well-known, in every repo). */
function isSupabaseDemoKey(v: string): boolean {
  try {
    const [, payload] = v.split(".");
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return json?.iss === "supabase-demo";
  } catch {
    return false;
  }
}

function looksPlaceholder(v: string): boolean {
  return (
    PLACEHOLDER_RE.test(v.trim()) ||
    isRepeatedCharKey(v.trim()) ||
    isSupabaseDemoKey(v.trim())
  );
}

interface SecretCheck {
  name: string;
  /** Must be 64 lowercase hex chars (an AES-256 key). */
  hexKey?: boolean;
}

/**
 * Missing → fatal. Cover core infra + every at-rest encryption / signing key:
 * an org can enable WhatsApp, Calendar or the Integration Hub from the
 * dashboard at any time, and a missing key would leave that feature broken and
 * (worse) tempt a hotfix that stores a credential unencrypted.
 */
const REQUIRED_SECRETS: SecretCheck[] = [
  { name: "ANTHROPIC_API_KEY" },
  { name: "SUPABASE_SERVICE_ROLE_KEY" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  { name: "FOLLOW_UP_CRON_SECRET" },
  { name: "INTEGRATION_HUB_CRON_SECRET" },
  { name: "CALENDAR_TOKEN_ENCRYPTION_KEY", hexKey: true },
  { name: "INTEGRATION_TOKEN_ENCRYPTION_KEY", hexKey: true },
  { name: "WHATSAPP_TOKEN_ENCRYPTION_KEY", hexKey: true },
];

/** Provider-specific — only needed once that provider is onboarded. Missing → warn. */
const PROVIDER_SECRETS: SecretCheck[] = [
  { name: "WHATSAPP_APP_SECRET" },
  { name: "WHATSAPP_WEBHOOK_VERIFY_TOKEN" },
  { name: "GOOGLE_CALENDAR_CLIENT_ID" },
  { name: "GOOGLE_CALENDAR_CLIENT_SECRET" },
];

function checkSecretValue(
  check: SecretCheck,
  value: string,
): string | null {
  if (looksPlaceholder(value)) {
    return `${check.name} looks like a development placeholder — set a real production value.`;
  }
  if (check.hexKey && !/^[0-9a-f]{64}$/.test(value.trim())) {
    return `${check.name} must be 64 hex characters (openssl rand -hex 32).`;
  }
  return null;
}

export function assessProductionReadiness(env: Env): ReadinessReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const check of REQUIRED_SECRETS) {
    const value = env[check.name];
    if (!value) {
      errors.push(`${check.name} is not set.`);
      continue;
    }
    const problem = checkSecretValue(check, value);
    if (problem) errors.push(problem);
  }

  for (const check of PROVIDER_SECRETS) {
    const value = env[check.name];
    if (!value) {
      warnings.push(
        `${check.name} is not set — that integration cannot be used until it is.`,
      );
      continue;
    }
    // A placeholder value IS a hard error even for optional providers.
    const problem = checkSecretValue(check, value);
    if (problem) errors.push(problem);
  }

  // `APP_BASE_URL` must be an https origin in production.
  const base = env.APP_BASE_URL?.trim();
  if (!base) {
    errors.push("APP_BASE_URL is not set.");
  } else if (!/^https:\/\//i.test(base)) {
    errors.push(`APP_BASE_URL must be an https:// origin (got "${base}").`);
  }

  // Trusted-proxy strategy for rate limiting.
  const ack = parseAck(env.LEADFLOW_PRODUCTION_CHECKS_ACK);
  const hasProxyConfig =
    Boolean(env.RATE_LIMIT_CLIENT_IP_HEADER) ||
    env.RATE_LIMIT_TRUSTED_PROXY_HOPS !== undefined;
  if (!hasProxyConfig && !ack.has("trusted-proxy")) {
    warnings.push(
      "Rate limiting trusts one reverse-proxy hop by default. Set RATE_LIMIT_CLIENT_IP_HEADER " +
        "(e.g. cf-connecting-ip / x-real-ip) or RATE_LIMIT_TRUSTED_PROXY_HOPS for your platform, " +
        "or ack `trusted-proxy`.",
    );
  }

  // Un-verifiable Supabase dashboard settings — warn unless acknowledged.
  for (const token of ["secure-password-change", "email-confirmation", "redirect-urls", "network-egress", "no-demo-orgs"] as const) {
    if (!ack.has(token)) {
      warnings.push(`Unverified: ${describeAck(token)} (ack \`${token}\` once confirmed).`);
    }
  }

  // Demo chat must be OFF in production unless explicitly enabled.
  if (env.LEADFLOW_ENABLE_DEMO_CHAT === "1") {
    warnings.push(
      "LEADFLOW_ENABLE_DEMO_CHAT=1 — anonymous chats without a widget key can persist leads " +
        "into a seeded demo org. Only enable this if that is intended.",
    );
  }

  return { errors, warnings };
}

function parseAck(raw: string | undefined): Set<string> {
  const set = new Set<string>();
  if (!raw) return set;
  if (raw.trim().toLowerCase() === "all") {
    for (const t of ACK_TOKENS) set.add(t);
    return set;
  }
  for (const t of raw.split(",").map((s) => s.trim().toLowerCase())) {
    if (t) set.add(t);
  }
  return set;
}

function describeAck(token: (typeof ACK_TOKENS)[number]): string {
  switch (token) {
    case "secure-password-change":
      return "Supabase Auth → 'Secure password change' must be ON";
    case "email-confirmation":
      return "Supabase Auth → email confirmations ON with a real SMTP provider";
    case "redirect-urls":
      return "Supabase Auth → URL Configuration includes /auth/confirm redirect URLs";
    case "trusted-proxy":
      return "the deployment platform's trusted client-IP header is configured";
    case "network-egress":
      return "outbound network egress is restricted by a firewall/allowlist (final SSRF control)";
    case "no-demo-orgs":
      return "the production database has no seeded demo organizations";
  }
}

/**
 * Are we actually serving production traffic (vs. a local `next start` used to
 * smoke-test the production build)? A localhost `APP_BASE_URL` is the tell — a
 * real deployment always has a public https origin.
 */
export function isProductionRuntime(env: Env): boolean {
  if (env.NODE_ENV !== "production") return false;
  const base = env.APP_BASE_URL?.trim();
  if (base && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(base)) {
    return false;
  }
  return true;
}

/** Throws when there is any fatal error. Logs warnings. Call once at boot. */
export function assertProductionReadiness(
  env: Env = process.env as Env,
  log: Pick<Console, "warn" | "error"> = console,
): void {
  if (!isProductionRuntime(env)) return;
  const { errors, warnings } = assessProductionReadiness(env);

  for (const w of warnings) log.warn(`[production-readiness] ${w}`);

  if (errors.length > 0) {
    const message =
      "Refusing to start: production security configuration is incomplete.\n" +
      errors.map((e) => `  - ${e}`).join("\n") +
      "\nSee docs/PRODUCTION-SECURITY.md.";
    throw new Error(message);
  }
}
