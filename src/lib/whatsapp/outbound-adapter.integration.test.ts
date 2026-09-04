import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createWhatsAppAdapter } from "./outbound-adapter.ts";
import {
  resolveOrgByPhoneNumberId,
  getSendCredentials,
  resolveRecipientWaId,
} from "./connections.ts";
import { encryptToken } from "./crypto.ts";
import type { MetaTransport } from "./meta-client.ts";
import type { FollowUpChannelAdapter, FollowUpDeliveryContext } from "../follow-ups/channels.ts";

const URL = process.env.LEADFLOW_DB_TEST_URL;
const SERVICE_KEY = process.env.LEADFLOW_DB_TEST_SERVICE_KEY;
const ANON_KEY = process.env.LEADFLOW_DB_TEST_ANON_KEY;
const enabled = Boolean(URL && SERVICE_KEY && ANON_KEY && ANON_KEY !== SERVICE_KEY);
const skip = enabled
  ? false
  : "set LEADFLOW_DB_TEST_URL + LEADFLOW_DB_TEST_SERVICE_KEY + LEADFLOW_DB_TEST_ANON_KEY";

const ENC_KEY = "c".repeat(64);
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = ENC_KEY;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
const stamp = Date.now();
let admin: AnyClient;
let orgA = "", orgB = "", leadA = "", convA = "", demoOrg = "", demoLead = "", demoConv = "";
let userId = "";

const okTransport = (): { transport: MetaTransport; sent: unknown[] } => {
  const sent: unknown[] = [];
  return {
    sent,
    transport: {
      async send(input) {
        sent.push(input.body);
        return { ok: true, retryable: false, providerMessageId: `wamid.out-${sent.length}` };
      },
    },
  };
};
const failTransport = (retryable: boolean): MetaTransport => ({
  async send() {
    return { ok: false, retryable, errorCode: retryable ? 80007 : 190, errorDetail: "mock" };
  },
});

function ctx(
  over: Partial<FollowUpDeliveryContext>,
): FollowUpDeliveryContext {
  return {
    db: admin,
    organizationId: orgA,
    leadId: leadA,
    conversationId: convA,
    channel: "whatsapp",
    message: "Hi, following up as promised.",
    isDemo: false,
    ...over,
  };
}

before(async () => {
  if (!enabled) return;
  admin = createClient(URL as string, SERVICE_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  userId = (
    await admin.auth.admin.createUser({
      email: `wa-adapter-${stamp}@example.test`,
      password: "test-password-123",
      email_confirm: true,
    })
  ).data.user.id;

  const mk = async (slug: string, withMember: boolean) => {
    const org = (
      await admin.from("organizations").insert({ name: slug, slug: `${slug}-${stamp}`, industry_template_id: "real-estate" }).select("id").single()
    ).data.id;
    if (withMember) await admin.from("organization_members").insert({ organization_id: org, user_id: userId, role: "owner" });
    const lead = (
      await admin.from("leads").insert({ organization_id: org, name: `${slug} Lead`, phone: "16505550001", score: 50, temperature: "warm", status: "new" }).select("id").single()
    ).data.id;
    const conv = (
      await admin.from("conversations").insert({
        organization_id: org, lead_id: lead, channel: "whatsapp",
        external_contact_id: "16505550001", last_inbound_at: new Date().toISOString(),
      }).select("id").single()
    ).data.id;
    return { org, lead, conv };
  };

  ({ org: orgA, lead: leadA, conv: convA } = await mk("wa-a", true));
  ({ org: orgB } = await mk("wa-b", true));
  ({ org: demoOrg, lead: demoLead, conv: demoConv } = await mk("wa-demo", false));

  // connect org A + demo org
  for (const [org, pn] of [[orgA, `PN-A-${stamp}`], [demoOrg, `PN-D-${stamp}`]] as const) {
    await admin.from("whatsapp_connections").insert({
      organization_id: org, phone_number_id: pn, status: "connected",
      access_token_encrypted: encryptToken("meta-token-value-1234567890", ENC_KEY),
    });
  }
});

after(async () => {
  if (!enabled) return;
  for (const o of [orgA, orgB, demoOrg]) if (o) await admin.from("organizations").delete().eq("id", o);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

beforeEach(async () => {
  if (!enabled) return;
  await admin.from("messages").delete().eq("conversation_id", convA);
  await admin.from("messages").delete().eq("conversation_id", demoConv);
  await admin.from("conversations").update({ last_inbound_at: new Date().toISOString() }).eq("id", convA);
});

test("resolveOrgByPhoneNumberId: connected → org, unknown/disconnected → null", { skip }, async () => {
  const r = await resolveOrgByPhoneNumberId(admin, `PN-A-${stamp}`);
  assert.equal(r?.organizationId, orgA);
  assert.equal(r?.orgHasMembers, true);
  assert.equal(await resolveOrgByPhoneNumberId(admin, "PN-does-not-exist"), null);

  await admin.from("whatsapp_connections").update({ status: "disconnected" }).eq("organization_id", orgB);
  assert.equal(await resolveOrgByPhoneNumberId(admin, `PN-B`), null);
});

test("adapter: in-window send → text, persists the outbound message", { skip }, async () => {
  const { transport, sent } = okTransport();
  const adapter: FollowUpChannelAdapter = createWhatsAppAdapter({ transport });
  const r = await adapter.deliver(ctx({}));
  assert.equal(r.ok, true);
  assert.equal(r.detail, "text");
  assert.equal((sent[0] as { type: string }).type, "text");

  const msg = (await admin.from("messages").select("role, channel, provider_message_id, delivery_status").eq("conversation_id", convA).single()).data;
  assert.equal(msg.role, "assistant");
  assert.equal(msg.channel, "whatsapp");
  assert.equal(msg.delivery_status, "sent");
  assert.match(msg.provider_message_id, /^wamid\.out-/);
});

test("adapter: outside the window with a template configured → template send", { skip }, async () => {
  await admin.from("conversations").update({ last_inbound_at: new Date(Date.now() - 40 * 3600_000).toISOString() }).eq("id", convA);
  await admin.from("whatsapp_connections").update({ metadata: { followUpTemplate: { name: "lead_follow_up", language: "en_US" } } }).eq("organization_id", orgA);
  const { transport, sent } = okTransport();
  const r = await createWhatsAppAdapter({ transport }).deliver(ctx({}));
  assert.equal(r.ok, true);
  assert.equal(r.detail, "template");
  assert.equal((sent[0] as { type: string }).type, "template");
  await admin.from("whatsapp_connections").update({ metadata: {} }).eq("organization_id", orgA);
});

test("adapter: outside the window with NO template → non-retryable config failure", { skip }, async () => {
  await admin.from("conversations").update({ last_inbound_at: new Date(Date.now() - 40 * 3600_000).toISOString() }).eq("id", convA);
  const r = await createWhatsAppAdapter({ transport: okTransport().transport }).deliver(ctx({}));
  assert.equal(r.ok, false);
  assert.equal(r.retryable, false);
  assert.match(r.detail ?? "", /template/);
});

test("adapter: no connection → non-retryable; retryable + non-retryable Meta errors classified", { skip }, async () => {
  const noConn = await createWhatsAppAdapter({ transport: okTransport().transport }).deliver(ctx({ organizationId: orgB, leadId: leadA, conversationId: null }));
  assert.equal(noConn.ok, false);
  assert.equal(noConn.retryable, false);

  const rt = await createWhatsAppAdapter({ transport: failTransport(true) }).deliver(ctx({}));
  assert.equal(rt.ok, false);
  assert.equal(rt.retryable, true);

  const nrt = await createWhatsAppAdapter({ transport: failTransport(false) }).deliver(ctx({}));
  assert.equal(nrt.ok, false);
  assert.equal(nrt.retryable, false);
});

test("adapter: a demo org is refused (never sends)", { skip }, async () => {
  const { transport, sent } = okTransport();
  const r = await createWhatsAppAdapter({ transport }).deliver(
    ctx({ organizationId: demoOrg, leadId: demoLead, conversationId: demoConv, isDemo: true }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.retryable, false);
  assert.equal(sent.length, 0);
});

test("getSendCredentials decrypts the token; resolveRecipientWaId finds the contact", { skip }, async () => {
  const creds = await getSendCredentials(admin, orgA);
  assert.equal(creds?.phoneNumberId, `PN-A-${stamp}`);
  assert.equal(creds?.accessToken, "meta-token-value-1234567890");

  const wa = await resolveRecipientWaId(admin, orgA, convA, leadA);
  assert.equal(wa, "16505550001");
});
