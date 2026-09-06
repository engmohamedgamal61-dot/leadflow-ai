/**
 * DB-backed fixed-window rate limiting for the public AI/chat entry points.
 *
 * Uses the atomic `public.hit_rate_limit` RPC (service-role only) — one fast
 * indexed upsert, shared across every serverless instance, no extra
 * infrastructure. Reuses the trusted admin-client boundary the chat route
 * already holds (same as reading calendar availability).
 *
 * Fails OPEN: if the limiter RPC errors, the request is allowed through and
 * the failure is reported. For a pilot, availability of the qualification
 * chat matters more than a strict cap, and the per-widget limit still bounds
 * the worst case.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
// Relative value import so this module (and its test) load under `node --test`.
import { reportError } from "../observability/report.ts";

type Db = SupabaseClient<Database>;

export interface RateLimitRule {
  /** Stable bucket name, e.g. "chat:ip" or "chat:widget". */
  bucket: string;
  /** The caller identity within the bucket, e.g. an IP or a widget key. */
  id: string;
  max: number;
  windowSeconds: number;
}

export interface RateLimitOutcome {
  allowed: boolean;
  /** Seconds until the window resets — for the `Retry-After` header. */
  retryAfterSeconds: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Per-IP burst limit for `/api/chat`. */
export function chatIpRule(ip: string): RateLimitRule {
  return {
    bucket: "chat:ip",
    id: ip,
    max: envInt("CHAT_RATE_LIMIT_PER_IP", 20),
    windowSeconds: envInt("CHAT_RATE_WINDOW_SECONDS", 60),
  };
}

/**
 * Coarser cap per organization / widget — bounds a single tenant's spend even
 * if their traffic is spread across many IPs.
 */
export function chatOrgRule(orgKey: string): RateLimitRule {
  return {
    bucket: "chat:org",
    id: orgKey,
    max: envInt("CHAT_RATE_LIMIT_PER_ORG_HOURLY", 600),
    windowSeconds: 3600,
  };
}

export async function enforceRateLimit(
  db: Db,
  rule: RateLimitRule,
): Promise<RateLimitOutcome> {
  const key = `${rule.bucket}:${rule.id}`;
  try {
    const { data, error } = await db.rpc("hit_rate_limit", {
      p_key: key,
      p_max: rule.max,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) {
      void reportError(error, { scope: "rate-limit", bucket: rule.bucket });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: data === true,
      retryAfterSeconds: data === true ? 0 : rule.windowSeconds,
    };
  } catch (err) {
    void reportError(err, { scope: "rate-limit", bucket: rule.bucket });
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
