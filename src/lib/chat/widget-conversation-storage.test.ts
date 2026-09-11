import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  conversationStorageKey,
  readStoredConversationId,
  writeStoredConversationId,
} from "./widget-conversation-storage.ts";

const KEY = "8174d33a-3ab9-4dc2-963b-dd4ad0c3920d";
const CONV = "05b7f92c-4bd0-4d1e-b567-11f70a0a6ef5";

/** A minimal, real Map-backed localStorage — no `node --test` DOM available. */
class FakeStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? this.store.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = { localStorage: new FakeStorage() };
});

test("conversationStorageKey is namespaced per widget key", () => {
  assert.equal(conversationStorageKey(KEY), `leadflow:widget:${KEY}:conversation`);
});

test("round-trip: write then read returns the same id", () => {
  writeStoredConversationId(KEY, CONV);
  assert.equal(readStoredConversationId(KEY), CONV);
});

test("nothing stored → null", () => {
  assert.equal(readStoredConversationId(KEY), null);
});

test("no widgetKey → always null, and write is a no-op", () => {
  assert.equal(readStoredConversationId(undefined), null);
  writeStoredConversationId(undefined, CONV);
  assert.equal(readStoredConversationId(KEY), null, "nothing leaked into the real key");
});

test("REGRESSION: a corrupted / non-UUID stored value is never trusted", () => {
  for (const garbage of ["", "not-a-uuid", "<script>alert(1)</script>", "null", "undefined", "12345"]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window.localStorage.setItem(conversationStorageKey(KEY), garbage);
    assert.equal(readStoredConversationId(KEY), null, `garbage "${garbage}" must be ignored`);
  }
});

test("writing null / an invalid id clears the stored value", () => {
  writeStoredConversationId(KEY, CONV);
  assert.equal(readStoredConversationId(KEY), CONV);
  writeStoredConversationId(KEY, null);
  assert.equal(readStoredConversationId(KEY), null);

  writeStoredConversationId(KEY, CONV);
  writeStoredConversationId(KEY, "not-a-uuid");
  assert.equal(readStoredConversationId(KEY), null, "an invalid new value also clears it");
});

test("two different widget keys never collide (no cross-widget / cross-org reuse)", () => {
  const otherKey = "097699b9-0d2d-4579-bacd-80d362c2ec85";
  const otherConv = "7b2a7df7-0a38-409d-b945-459320de7850";
  writeStoredConversationId(KEY, CONV);
  writeStoredConversationId(otherKey, otherConv);
  assert.equal(readStoredConversationId(KEY), CONV);
  assert.equal(readStoredConversationId(otherKey), otherConv);
});

test("a storage that throws (private mode / quota) degrades to null / no-op, never crashes", () => {
  const throwing = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = { localStorage: throwing };
  assert.doesNotThrow(() => {
    assert.equal(readStoredConversationId(KEY), null);
    writeStoredConversationId(KEY, CONV);
  });
});

test("no window (SSR) → null / no-op, never throws", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).window;
  assert.doesNotThrow(() => {
    assert.equal(readStoredConversationId(KEY), null);
    writeStoredConversationId(KEY, CONV);
  });
});
