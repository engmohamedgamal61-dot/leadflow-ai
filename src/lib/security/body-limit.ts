/**
 * Bounded request-body reading for public / webhook endpoints.
 *
 * `request.text()` / `request.json()` will buffer an arbitrarily large body
 * into memory before any validation or signature check runs — a cheap DoS on
 * an unauthenticated route. These helpers cap it: the `Content-Length` header
 * is checked first, and the streamed bytes are counted so a lying / absent
 * header can't get past the limit either.
 *
 * Pure enough to unit-test: `readLimitedText` takes anything with `.headers`
 * and an async-iterable / `.text()` body.
 */

/** Reasonable ceilings per endpoint kind (bytes). */
export const BODY_LIMITS = {
  /** `/api/chat` — 100 messages × 4000 chars + envelope, generously. */
  chat: 512 * 1024,
  /** Provider webhooks (WhatsApp batches can be a few hundred KB). */
  webhook: 1024 * 1024,
  /** Inbound Integration Hub actions — tiny JSON. */
  inboundAction: 128 * 1024,
} as const;

export interface LimitedBody {
  ok: true;
  text: string;
}
export interface BodyTooLarge {
  ok: false;
  /** Bytes seen (from the header, or counted) when the limit tripped. */
  seenBytes: number;
}

function declaredLength(headers: { get(name: string): string | null }): number | null {
  const raw = headers.get("content-length");
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Read `request` as text, refusing anything over `maxBytes`. Returns
 * `{ ok: false }` (the caller responds 413) instead of throwing.
 */
export async function readLimitedText(
  request: Request,
  maxBytes: number,
): Promise<LimitedBody | BodyTooLarge> {
  const declared = declaredLength(request.headers);
  if (declared !== null && declared > maxBytes) {
    return { ok: false, seenBytes: declared };
  }

  const body = request.body;
  if (!body) {
    const text = await request.text();
    const bytes = Buffer.byteLength(text, "utf8");
    return bytes > maxBytes ? { ok: false, seenBytes: bytes } : { ok: true, text };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            /* already closing */
          }
          return { ok: false, seenBytes: total };
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

/** The 413 response body every capped route returns. */
export const bodyTooLargeResponse = () =>
  Response.json({ error: "payload too large" }, { status: 413 });
