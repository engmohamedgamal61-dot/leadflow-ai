import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessProductionReadiness,
  assertProductionReadiness,
  type Env,
} from "./production-readiness.ts";

const HEX = "a".repeat(63) + "b"; // 64 hex, not a repeated-char key

const GOOD: Env = {
  NODE_ENV: "production",
  ANTHROPIC_API_KEY: "sk-ant-real-xxxxxxxxxxxxxxxxxxxxx",
  SUPABASE_SERVICE_ROLE_KEY: "eyJreal.body.sig",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJanon.body.sig",
  FOLLOW_UP_CRON_SECRET: "9f2c1b7e4d6a8c0f2e4b6d8a0c2e4f6b",
  CALENDAR_TOKEN_ENCRYPTION_KEY: HEX,
  INTEGRATION_TOKEN_ENCRYPTION_KEY: HEX,
  WHATSAPP_TOKEN_ENCRYPTION_KEY: HEX,
  INTEGRATION_HUB_CRON_SECRET: "aa11bb22cc33dd44",
  WHATSAPP_APP_SECRET: "meta-real-app-secret-value",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "meta-real-verify-token",
  APP_BASE_URL: "https://app.example.com",
  LEADFLOW_PRODUCTION_CHECKS_ACK: "all",
  RATE_LIMIT_CLIENT_IP_HEADER: "x-real-ip",
};

test("a fully configured production env has no errors", () => {
  const r = assessProductionReadiness(GOOD);
  assert.deepEqual(r.errors, [], r.errors.join("; "));
});

test("a missing critical secret is a fatal error", () => {
  const r = assessProductionReadiness({ ...GOOD, ANTHROPIC_API_KEY: undefined });
  assert.ok(r.errors.some((e) => e.includes("ANTHROPIC_API_KEY")));
});

test("a dev-placeholder secret is a fatal error", () => {
  for (const v of ["dev-whatsapp-app-secret-0123456789", "changeme", "your-key-here"]) {
    const r = assessProductionReadiness({ ...GOOD, FOLLOW_UP_CRON_SECRET: v });
    assert.ok(
      r.errors.some((e) => e.includes("FOLLOW_UP_CRON_SECRET")),
      `should flag placeholder ${v}`,
    );
  }
});

test("a repeated-character encryption key (the dev default) is rejected", () => {
  const r = assessProductionReadiness({ ...GOOD, CALENDAR_TOKEN_ENCRYPTION_KEY: "d".repeat(64) });
  assert.ok(r.errors.some((e) => e.includes("CALENDAR_TOKEN_ENCRYPTION_KEY")));
});

test("the bundled Supabase demo service-role key is rejected", () => {
  const demo =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
  const r = assessProductionReadiness({ ...GOOD, SUPABASE_SERVICE_ROLE_KEY: demo });
  assert.ok(r.errors.some((e) => e.includes("SUPABASE_SERVICE_ROLE_KEY")));
});

test("APP_BASE_URL must be https in production", () => {
  assert.ok(
    assessProductionReadiness({ ...GOOD, APP_BASE_URL: "http://app.example.com" }).errors.some((e) =>
      e.includes("APP_BASE_URL"),
    ),
  );
  assert.ok(
    assessProductionReadiness({ ...GOOD, APP_BASE_URL: undefined }).errors.some((e) =>
      e.includes("APP_BASE_URL"),
    ),
  );
});

test("hex-key format is enforced", () => {
  const r = assessProductionReadiness({ ...GOOD, INTEGRATION_TOKEN_ENCRYPTION_KEY: "short" });
  assert.ok(r.errors.some((e) => e.includes("INTEGRATION_TOKEN_ENCRYPTION_KEY")));
});

test("provider secrets missing → warning, not a fatal error", () => {
  const noWa: Env = {
    ...GOOD,
    WHATSAPP_APP_SECRET: undefined,
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: undefined,
    GOOGLE_CALENDAR_CLIENT_ID: undefined,
    GOOGLE_CALENDAR_CLIENT_SECRET: undefined,
  };
  const r = assessProductionReadiness(noWa);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => w.includes("WHATSAPP_APP_SECRET")));
});

test("a provider secret that IS set but is a placeholder is still fatal", () => {
  const r = assessProductionReadiness({ ...GOOD, WHATSAPP_APP_SECRET: "dev-whatsapp-app-secret-0123456789" });
  assert.ok(r.errors.some((e) => e.includes("WHATSAPP_APP_SECRET")));
});

test("every at-rest encryption key is required in production", () => {
  for (const key of [
    "CALENDAR_TOKEN_ENCRYPTION_KEY",
    "INTEGRATION_TOKEN_ENCRYPTION_KEY",
    "WHATSAPP_TOKEN_ENCRYPTION_KEY",
    "INTEGRATION_HUB_CRON_SECRET",
  ]) {
    const r = assessProductionReadiness({ ...GOOD, [key]: undefined });
    assert.ok(r.errors.some((e) => e.includes(key)), `${key} should be required`);
  }
});

test("unverifiable Supabase settings warn unless acknowledged", () => {
  const noAck = assessProductionReadiness({ ...GOOD, LEADFLOW_PRODUCTION_CHECKS_ACK: undefined });
  assert.ok(noAck.warnings.some((w) => w.includes("Secure password change")));
  assert.ok(noAck.warnings.some((w) => w.toLowerCase().includes("smtp") || w.includes("email confirmation")));
  assert.deepEqual(noAck.errors, [], "warnings only, not errors");

  const partial = assessProductionReadiness({ ...GOOD, LEADFLOW_PRODUCTION_CHECKS_ACK: "secure-password-change" });
  assert.ok(!partial.warnings.some((w) => w.includes("Secure password change")));
});

test("demo chat enabled in production warns", () => {
  const r = assessProductionReadiness({ ...GOOD, LEADFLOW_ENABLE_DEMO_CHAT: "1" });
  assert.ok(r.warnings.some((w) => w.includes("LEADFLOW_ENABLE_DEMO_CHAT")));
});

test("assertProductionReadiness: no-op outside production", () => {
  assert.doesNotThrow(() => assertProductionReadiness({ NODE_ENV: "development" }));
  assert.doesNotThrow(() => assertProductionReadiness({}));
});

test("assertProductionReadiness: no-op for a local `next start` smoke test (localhost APP_BASE_URL)", () => {
  // dev placeholders everywhere, but a localhost base URL → not real production.
  assert.doesNotThrow(() =>
    assertProductionReadiness(
      {
        NODE_ENV: "production",
        APP_BASE_URL: "http://localhost:3000",
        ANTHROPIC_API_KEY: "dev-key",
      },
      { warn: () => {}, error: () => {} },
    ),
  );
});

test("assertProductionReadiness: DOES run for a real https deployment", () => {
  assert.throws(
    () =>
      assertProductionReadiness(
        { NODE_ENV: "production", APP_BASE_URL: "https://app.example.com", ANTHROPIC_API_KEY: "dev-key" },
        { warn: () => {}, error: () => {} },
      ),
    /Refusing to start/,
  );
});

test("assertProductionReadiness: throws on a fatal error, logs warnings", () => {
  const warns: string[] = [];
  assert.throws(
    () =>
      assertProductionReadiness(
        { ...GOOD, ANTHROPIC_API_KEY: "dev-placeholder", LEADFLOW_PRODUCTION_CHECKS_ACK: "all" },
        { warn: (m) => warns.push(String(m)), error: () => {} },
      ),
    /Refusing to start/,
  );
  assert.doesNotThrow(() =>
    assertProductionReadiness(GOOD, { warn: () => {}, error: () => {} }),
  );
});
