#!/usr/bin/env node
/**
 * Creates one Integration Hub endpoint per load-test org, pointed at the
 * local webhook-receiver-mock.mjs. Same insert shape hub.integration.test.ts's
 * makeEndpoint() uses. Not application code.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { encryptEndpointSecret, generateEndpointSecret, secretHint } from "../../src/lib/integrations/secret.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_FILE = join(__dirname, "..", "results", "seed-data.json");
const OUT_FILE = join(__dirname, "..", "results", "integration-endpoints.json");

const URL = process.env.LEADFLOW_DB_TEST_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.LEADFLOW_DB_TEST_SERVICE_KEY;
const WEBHOOK_PORT = process.env.MOCK_WEBHOOK_PORT ?? 9102;

if (!SERVICE_KEY) {
  console.error("Set LEADFLOW_DB_TEST_SERVICE_KEY");
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const seed = JSON.parse(readFileSync(SEED_FILE, "utf8"));
  const endpoints = [];
  for (const org of seed.orgs) {
    const secret = generateEndpointSecret();
    const { data, error } = await admin
      .from("integration_endpoints")
      .insert({
        organization_id: org.organizationId,
        name: "loadtest-hook",
        url: `http://localhost:${WEBHOOK_PORT}/webhook/org-${org.index}`,
        secret_encrypted: encryptEndpointSecret(secret),
        secret_hint: secretHint(secret),
        subscribed_events: ["lead.qualified", "lead.status_changed", "appointment.booked"],
      })
      .select("id")
      .single();
    if (error) throw new Error(`endpoint org${org.index}: ${error.message}`);
    endpoints.push({ organizationId: org.organizationId, endpointId: data.id });
  }
  writeFileSync(OUT_FILE, JSON.stringify({ endpoints }, null, 2));
  console.log(`Created ${endpoints.length} integration endpoints -> ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("SETUP FAILED:", err);
  process.exit(1);
});
