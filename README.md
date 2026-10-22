# twilio-sms-queue

A small, dependency-free rate-limited send queue for bulk Twilio SMS campaigns. Built as a scoped prototype for the problem "Twilio stops sending after ~50 messages in a mass campaign to people who responded to ads" — which is a rate-limit/queue problem, not a hard API cap.

## What it does

- Paces sends to stay under a configurable `ratePerSecond` (Twilio's per-number / messaging-service throughput cap), instead of firing all requests at once and hitting 429s.
- Retries transient failures (429 rate-limited, 5xx) with exponential backoff.
- Does **not** retry non-retryable errors (e.g. 400 invalid number) — fails that one recipient immediately instead of wasting retries.
- **Never lets one recipient's failure halt the campaign** — every recipient in the list gets attempted, and you get a per-recipient status report (`sent` / `failed`, attempt count, error) at the end instead of the whole run silently stopping partway through.

## Usage

```js
const { sendBulkSms } = require("./src/queue");
const { makeTwilioSendFn } = require("./src/twilioAdapter");
const twilio = require("twilio")(accountSid, authToken);

const sendFn = makeTwilioSendFn(twilio, { messagingServiceSid: "MGxxxxxxxx" });

const results = await sendBulkSms(recipients, sendFn, {
  ratePerSecond: 1,   // match whatever Twilio allows for your number/service
  maxRetries: 3,
});

const failed = results.filter((r) => r.status === "failed");
console.log(`${results.length - failed.length}/${results.length} sent`, failed);
```

`twilioAdapter.js` isn't wired to a live account (no credentials live in this repo) — it's the exact shape to drop into the client's existing backend; `sendFn` itself is just `(msg) => Promise`, so it also works directly against the Twilio SDK, a mock, or any other provider.

## Test it

```
npm test
```

7 tests covering: successful sends, a mid-campaign failure not halting the rest, 429 retry-then-succeed, giving up after `maxRetries`, not retrying non-retryable errors, actual rate pacing (measured via timestamps), and the default retryability rule.
