import { test } from "node:test";
import assert from "node:assert/strict";
import { persistChatTurn, type PersistChatTurnInput } from "./persist.ts";
import type { LeadData } from "../../types/chat.ts";

// ── minimal in-memory fake of the Supabase query builder ─────────────────

type Row = Record<string, unknown>;
type Store = Record<string, Row[]>;

class FakeQuery {
  private filters: [string, unknown][] = [];
  private op: "select" | "insert" | "update" = "select";
  private values: Row | Row[] = {};
  private orderDesc = false;
  private limitN: number | null = null;
  private singleMode: "maybe" | "one" | null = null;
  private store: Store;
  private table: string;

  constructor(store: Store, table: string) {
    this.store = store;
    this.table = table;
  }

  select() {
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val]);
    return this;
  }
  order(_col: string, opts: { ascending: boolean }) {
    this.orderDesc = opts.ascending === false;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  insert(v: Row | Row[]) {
    this.op = "insert";
    this.values = v;
    return this;
  }
  update(v: Row) {
    this.op = "update";
    this.values = v;
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }
  single() {
    this.singleMode = "one";
    return this;
  }
  // Supabase's builder is thenable — awaiting runs the query.
  then<T>(resolve: (v: { data: unknown; error: unknown }) => T) {
    return Promise.resolve(resolve(this.run()));
  }

  private rows(): Row[] {
    return (this.store[this.table] ?? []).filter((r) =>
      this.filters.every(([c, v]) => r[c] === v),
    );
  }

  private run(): { data: unknown; error: unknown } {
    if (this.op === "insert") {
      const arr = Array.isArray(this.values) ? this.values : [this.values];
      const now = new Date().toISOString();
      const inserted = arr.map((v) => ({
        id: crypto.randomUUID(),
        created_at: now,
        updated_at: now,
        status: "new",
        ...v,
      }));
      (this.store[this.table] ??= []).push(...inserted);
      return { data: this.singleMode ? inserted[0] : inserted, error: null };
    }
    if (this.op === "update") {
      const matched = this.rows();
      for (const r of matched) Object.assign(r, this.values);
      return { data: this.singleMode ? (matched[0] ?? null) : matched, error: null };
    }
    let rows = this.rows();
    if (this.orderDesc) rows = [...rows].reverse();
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    if (this.singleMode === "maybe") return { data: rows[0] ?? null, error: null };
    if (this.singleMode === "one")
      return {
        data: rows[0] ?? null,
        error: rows[0] ? null : { message: "no rows" },
      };
    return { data: rows, error: null };
  }
}

class FakeSupabase {
  store: Store = {
    organizations: [],
    organization_members: [],
    organization_configs: [],
    leads: [],
    conversations: [],
    messages: [],
    lead_events: [],
  };
  from(table: string) {
    return new FakeQuery(this.store, table);
  }
}

type Db = Parameters<typeof persistChatTurn>[0];

const reLead: LeadData = {
  name: "محمد",
  phone: null,
  email: null,
  intent: "buy",
  customData: {
    location: "Riyadh",
    budget: 1_000_000,
    property_type: "apartment",
    bedrooms: 4,
    financing: true,
    timeline: "1 week",
  },
};

const baseInput = (
  over: Partial<PersistChatTurnInput> = {},
): PersistChatTurnInput => ({
  organizationId: "org-a",
  conversationId: null,
  channel: "web",
  source: "chat",
  userMessage: "I want a 4-bed apartment in Riyadh",
  assistantMessage: "Great — what's your budget?",
  lead: reLead,
  score: 100,
  temperature: "HOT",
  ...over,
});

test("new conversation: creates lead + conversation + 2 messages + events", async () => {
  const db = new FakeSupabase();
  const result = await persistChatTurn(db as unknown as Db, baseInput());

  assert.equal(result.leadCreated, true);
  assert.equal(result.messagesInserted, 2);
  assert.ok(result.conversationId);
  assert.ok(result.leadId);

  assert.equal(db.store.leads.length, 1);
  assert.equal(db.store.conversations.length, 1);
  assert.equal(db.store.messages.length, 2);
  assert.deepEqual(
    db.store.messages.map((m) => m.role).sort(),
    ["assistant", "user"],
  );
  assert.deepEqual(
    db.store.lead_events.map((e) => e.event_type),
    ["lead_created", "message_received"],
  );
});

test("customData maps to custom_data; core fields map to columns", async () => {
  const db = new FakeSupabase();
  await persistChatTurn(db as unknown as Db, baseInput());
  const lead = db.store.leads[0];
  assert.equal(lead.name, "محمد");
  assert.equal(lead.intent, "buy");
  assert.equal(lead.score, 100);
  assert.equal(lead.temperature, "hot"); // app HOT → db hot
  assert.deepEqual(lead.custom_data, reLead.customData);
  // no industry-specific columns
  assert.equal("budget" in lead, false);
  assert.equal("property_type" in lead, false);
  assert.equal("bedrooms" in lead, false);
});

test("continuing a conversation updates the same lead, no duplicate", async () => {
  const db = new FakeSupabase();
  const first = await persistChatTurn(
    db as unknown as Db,
    baseInput({ score: 35, temperature: "COLD" }),
  );

  const second = await persistChatTurn(
    db as unknown as Db,
    baseInput({
      conversationId: first.conversationId,
      userMessage: "budget is 1 million, financing",
      assistantMessage: "Noted. Timeline?",
      score: 80,
      temperature: "HOT",
    }),
  );

  assert.equal(second.leadCreated, false);
  assert.equal(second.leadId, first.leadId);
  assert.equal(db.store.leads.length, 1); // still one lead
  assert.equal(db.store.conversations.length, 1); // still one conversation
  assert.equal(db.store.messages.length, 4); // 2 + 2
  assert.equal(db.store.leads[0].score, 80);
  assert.equal(db.store.leads[0].temperature, "hot");

  // score + temperature change events
  const types = db.store.lead_events.map((e) => e.event_type);
  assert.ok(types.includes("score_changed"));
  assert.ok(types.includes("temperature_changed"));
  const scoreEvent = db.store.lead_events.find(
    (e) => e.event_type === "score_changed",
  );
  assert.deepEqual(scoreEvent?.metadata, { from: 35, to: 80 });
});

test("retrying the same turn does not duplicate messages", async () => {
  const db = new FakeSupabase();
  const first = await persistChatTurn(db as unknown as Db, baseInput());
  const retry = await persistChatTurn(
    db as unknown as Db,
    baseInput({ conversationId: first.conversationId }),
  );
  assert.equal(retry.messagesInserted, 0);
  assert.equal(db.store.messages.length, 2);
});

test("a conversation from another org is not reused", async () => {
  const db = new FakeSupabase();
  const orgA = await persistChatTurn(
    db as unknown as Db,
    baseInput({ organizationId: "org-a" }),
  );
  const orgB = await persistChatTurn(
    db as unknown as Db,
    baseInput({
      organizationId: "org-b",
      conversationId: orgA.conversationId, // stolen id
    }),
  );
  assert.notEqual(orgB.conversationId, orgA.conversationId);
  assert.equal(db.store.conversations.length, 2);
  assert.equal(db.store.leads.length, 2);
  assert.equal(db.store.leads[1].organization_id, "org-b");
});

test("clinic lead persists through the same function", async () => {
  const db = new FakeSupabase();
  const clinicLead: LeadData = {
    name: "Ahmed",
    phone: "+966555555555",
    email: null,
    intent: null,
    customData: {
      service: "Dental Cleaning",
      doctor: "Dr. Ahmed",
      appointment_date: "2026-09-10",
      insurance: true,
      urgency: "high",
    },
  };
  await persistChatTurn(
    db as unknown as Db,
    baseInput({ lead: clinicLead, score: 100, temperature: "HOT" }),
  );
  const row = db.store.leads[0];
  assert.equal(row.name, "Ahmed");
  assert.equal(row.phone, "+966555555555");
  assert.equal(row.intent, null);
  assert.deepEqual(row.custom_data, clinicLead.customData);
  assert.equal("service" in row, false); // still only custom_data, no column
});
