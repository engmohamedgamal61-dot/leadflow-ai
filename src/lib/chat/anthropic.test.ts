import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STREAM_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_REQUEST_MAX_RETRIES,
  resolveStreamTimeoutMs,
  resolveRequestTimeoutMs,
  resolveRequestMaxRetries,
  streamCallOptions,
  requestCallOptions,
} from "./anthropic.ts";

test("resolveStreamTimeoutMs: sane default, honors a valid override, rejects garbage", () => {
  assert.equal(resolveStreamTimeoutMs(undefined), DEFAULT_STREAM_TIMEOUT_MS);
  assert.equal(resolveStreamTimeoutMs("45000"), 45_000);
  assert.equal(resolveStreamTimeoutMs("0"), DEFAULT_STREAM_TIMEOUT_MS);
  assert.equal(resolveStreamTimeoutMs("-5"), DEFAULT_STREAM_TIMEOUT_MS);
  assert.equal(resolveStreamTimeoutMs("not-a-number"), DEFAULT_STREAM_TIMEOUT_MS);
});

test("resolveRequestTimeoutMs: sane default, honors a valid override, rejects garbage", () => {
  assert.equal(resolveRequestTimeoutMs(undefined), DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(resolveRequestTimeoutMs("5000"), 5_000);
  assert.equal(resolveRequestTimeoutMs("0"), DEFAULT_REQUEST_TIMEOUT_MS);
});

test("resolveRequestMaxRetries: sane default, honors 0 (no retries), rejects negative/garbage", () => {
  assert.equal(resolveRequestMaxRetries(undefined), DEFAULT_REQUEST_MAX_RETRIES);
  assert.equal(resolveRequestMaxRetries("0"), 0);
  assert.equal(resolveRequestMaxRetries("3"), 3);
  assert.equal(resolveRequestMaxRetries("-1"), DEFAULT_REQUEST_MAX_RETRIES);
  assert.equal(resolveRequestMaxRetries("nope"), DEFAULT_REQUEST_MAX_RETRIES);
});

test("streamCallOptions never retries, uses the stream timeout, forwards a signal", () => {
  const controller = new AbortController();
  const opts = streamCallOptions(controller.signal);
  assert.equal(opts.maxRetries, 0);
  assert.equal(opts.timeout, DEFAULT_STREAM_TIMEOUT_MS);
  assert.equal(opts.signal, controller.signal);
});

test("streamCallOptions omits signal cleanly when none is given", () => {
  const opts = streamCallOptions(null);
  assert.equal(opts.signal, undefined);
  const optsNoArg = streamCallOptions();
  assert.equal(optsNoArg.signal, undefined);
});

test("requestCallOptions uses the request timeout + bounded retry budget, forwards a signal", () => {
  const controller = new AbortController();
  const opts = requestCallOptions(controller.signal);
  assert.equal(opts.timeout, DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(opts.maxRetries, DEFAULT_REQUEST_MAX_RETRIES);
  assert.equal(opts.signal, controller.signal);
});

test("requestCallOptions is callable with no signal at all (dashboard / webhook contexts)", () => {
  const opts = requestCallOptions();
  assert.equal(opts.signal, undefined);
  assert.equal(typeof opts.timeout, "number");
});
