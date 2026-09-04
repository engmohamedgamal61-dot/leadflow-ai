import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWhatsAppWebhook } from "./payload.ts";

const inboundText = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550783881", phone_number_id: "106540352242922" },
            contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: "16505551234" }],
            messages: [
              {
                from: "16505551234",
                id: "wamid.HBgLMTY1MDM4Nzk0MzkVAgAS",
                timestamp: "1749416383",
                type: "text",
                text: { body: "Does it come in another color?" },
              },
            ],
          },
        },
      ],
    },
  ],
};

const statusPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "106540352242922" },
            statuses: [
              {
                id: "wamid.OUT123",
                status: "delivered",
                timestamp: "1750263773",
                recipient_id: "16505551234",
              },
            ],
          },
        },
      ],
    },
  ],
};

test("parses an inbound text message", () => {
  const p = parseWhatsAppWebhook(inboundText);
  assert.equal(p.phoneNumberId, "106540352242922");
  assert.equal(p.displayPhoneNumber, "15550783881");
  assert.equal(p.messages.length, 1);
  assert.deepEqual(p.messages[0], {
    providerMessageId: "wamid.HBgLMTY1MDM4Nzk0MzkVAgAS",
    from: "16505551234",
    contactName: "Sheena Nelson",
    timestamp: "1749416383",
    type: "text",
    text: "Does it come in another color?",
    supported: true,
  });
  assert.equal(p.statuses.length, 0);
});

test("parses a delivery status", () => {
  const p = parseWhatsAppWebhook(statusPayload);
  assert.equal(p.messages.length, 0);
  assert.deepEqual(p.statuses[0], {
    providerMessageId: "wamid.OUT123",
    status: "delivered",
    timestamp: "1750263773",
    recipientId: "16505551234",
    errorDetail: null,
  });
});

test("an image/audio/document message is normalised as unsupported", () => {
  const p = parseWhatsAppWebhook({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "PN" },
              messages: [{ from: "111", id: "wamid.IMG", type: "image", image: { id: "m1" } }],
            },
          },
        ],
      },
    ],
  });
  assert.equal(p.messages[0].supported, false);
  assert.equal(p.messages[0].type, "image");
  assert.equal(p.messages[0].text, null);
});

test("malformed / empty payloads never throw and yield empty arrays", () => {
  for (const bad of [null, undefined, {}, [], "x", 42, { entry: "nope" }, { entry: [{ changes: null }] }]) {
    const p = parseWhatsAppWebhook(bad);
    assert.deepEqual(p.messages, []);
    assert.deepEqual(p.statuses, []);
  }
});

test("a message missing from/id is dropped", () => {
  const p = parseWhatsAppWebhook({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "PN" }, messages: [{ type: "text", text: { body: "hi" } }] } }] }],
  });
  assert.equal(p.messages.length, 0);
});
