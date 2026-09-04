/**
 * The Meta Cloud API transport — the ONLY place that knows Meta's request /
 * response / error shapes. Everything above it (adapter, inbound service)
 * works with the normalised `MetaSendResult`.
 *
 * `MetaTransport` is an injection seam: automated tests pass a fake and never
 * hit the network.
 */

import { graphApiVersion, graphMessagesUrl } from "./config.ts";

export interface MetaSendInput {
  phoneNumberId: string;
  accessToken: string;
  /** A fully-formed message body (see `buildTextMessage` / `buildTemplateMessage`). */
  body: Record<string, unknown>;
  apiVersion?: string;
}

export interface MetaSendResult {
  ok: boolean;
  providerMessageId?: string;
  /** Only meaningful when `ok` is false. */
  retryable: boolean;
  errorCode?: number;
  /** Short, non-sensitive. Safe for `last_error` / dashboard. */
  errorDetail?: string;
}

export interface MetaTransport {
  send(input: MetaSendInput): Promise<MetaSendResult>;
}

export function buildTextMessage(to: string, text: string): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: text.slice(0, 4096) },
  };
}

export function buildTemplateMessage(
  to: string,
  templateName: string,
  languageCode: string,
): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode || "en_US" },
      components: [],
    },
  };
}

/**
 * Meta error codes that are worth retrying (rate limits, transient upstream
 * issues). Everything else — bad token, invalid recipient, template problems,
 * malformed params — is a configuration error and must NOT loop.
 */
const RETRYABLE_CODES = new Set([
  4, // application request limit reached
  80007, // rate limit hit
  130429, // rate limit hit
  131056, // (business, recipient) pair rate limit
  133016, // resend on read-timeout
  500, 502, 503, 504, // pseudo-codes we assign to HTTP 5xx / network
]);

export function isRetryableMetaError(code: number | undefined): boolean {
  return code !== undefined && RETRYABLE_CODES.has(code);
}

/**
 * A no-network transport for local development / E2E: succeeds with a fake
 * provider id and never sends anything. Enabled by `WHATSAPP_MOCK_TRANSPORT=1`.
 */
export const mockMetaTransport: MetaTransport = {
  async send({ phoneNumberId }) {
    console.log(`[whatsapp:mock] send via ${phoneNumberId} (no external delivery)`);
    return {
      ok: true,
      retryable: false,
      providerMessageId: `wamid.mock-${Math.random().toString(36).slice(2, 14)}`,
    };
  },
};

/** Real transport: a single POST to the Graph API. Never logs the token. */
export const fetchMetaTransport: MetaTransport = {
  async send({ phoneNumberId, accessToken, body, apiVersion }) {
    const version = graphApiVersion(apiVersion);
    const url = graphMessagesUrl(phoneNumberId, version);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorCode: 503,
        errorDetail:
          error instanceof Error ? error.message.slice(0, 200) : "network error",
      };
    }

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* empty / non-JSON body */
    }

    if (res.ok) {
      const id =
        (json as { messages?: { id?: string }[] } | null)?.messages?.[0]?.id;
      return id
        ? { ok: true, retryable: false, providerMessageId: id }
        : { ok: false, retryable: true, errorCode: 502, errorDetail: "no message id in response" };
    }

    const err = (json as { error?: { code?: number; message?: string; type?: string } } | null)?.error;
    const code = typeof err?.code === "number" ? err.code : res.status;
    return {
      ok: false,
      retryable: isRetryableMetaError(code) || (res.status >= 500 && res.status < 600),
      errorCode: code,
      errorDetail: (err?.message ?? `HTTP ${res.status}`).slice(0, 200),
    };
  },
};

/** The transport for production code paths — mock when explicitly enabled. */
export function getMetaTransport(): MetaTransport {
  return process.env.WHATSAPP_MOCK_TRANSPORT === "1"
    ? mockMetaTransport
    : fetchMetaTransport;
}

export interface MetaPhoneCheck {
  ok: boolean;
  displayPhoneNumber?: string;
  verifiedName?: string;
  errorDetail?: string;
}

/**
 * Lightweight "does this token + phone number id work" check for the dashboard
 * "Test connection" button — a read-only `GET` on the phone number. Mocked when
 * `WHATSAPP_MOCK_TRANSPORT=1`. Never logs the token.
 */
export async function checkMetaPhoneNumber(input: {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
}): Promise<MetaPhoneCheck> {
  if (process.env.WHATSAPP_MOCK_TRANSPORT === "1") {
    return { ok: true, displayPhoneNumber: "+1 555 000 0000", verifiedName: "Mock Business" };
  }
  const version = graphApiVersion(input.apiVersion);
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(
    input.phoneNumberId,
  )}?fields=display_phone_number,verified_name`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });
    const json = (await res.json().catch(() => null)) as {
      display_phone_number?: string;
      verified_name?: string;
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      return { ok: false, errorDetail: (json?.error?.message ?? `HTTP ${res.status}`).slice(0, 200) };
    }
    return {
      ok: true,
      displayPhoneNumber: json?.display_phone_number,
      verifiedName: json?.verified_name,
    };
  } catch (error) {
    return {
      ok: false,
      errorDetail: error instanceof Error ? error.message.slice(0, 200) : "network error",
    };
  }
}
