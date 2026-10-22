const test = require("node:test");
const assert = require("node:assert/strict");
const { sendBulkSms, defaultIsRetryable } = require("../src/queue");

const FAST_OPTS = { ratePerSecond: 1000, baseBackoffMs: 1 }; // keep tests fast; rate math is the same at any scale

test("sends every recipient and reports 'sent' on success", async () => {
  const sent = [];
  const sendFn = async (msg) => sent.push(msg.to);
  const recipients = [{ to: "+1", body: "a" }, { to: "+2", body: "b" }];

  const results = await sendBulkSms(recipients, sendFn, FAST_OPTS);

  assert.deepEqual(sent, ["+1", "+2"]);
  assert.deepEqual(
    results.map((r) => r.status),
    ["sent", "sent"]
  );
});

test("a failure on one recipient does not stop the rest of the campaign", async () => {
  const attemptedTo = [];
  const sendFn = async (msg) => {
    attemptedTo.push(msg.to);
    if (msg.to === "+bad") {
      const err = new Error("invalid number");
      err.status = 400; // not retryable
      throw err;
    }
  };
  const recipients = [{ to: "+1" }, { to: "+bad" }, { to: "+3" }];

  const results = await sendBulkSms(recipients, sendFn, FAST_OPTS);

  // all three were attempted, including the one after the failure
  assert.deepEqual(attemptedTo, ["+1", "+bad", "+3"]);
  assert.deepEqual(
    results.map((r) => r.status),
    ["sent", "failed", "sent"]
  );
  assert.match(results[1].error, /invalid number/);
});

test("retries a 429 (rate-limited) send and eventually succeeds", async () => {
  let calls = 0;
  const sendFn = async () => {
    calls++;
    if (calls < 3) {
      const err = new Error("Too Many Requests");
      err.status = 429;
      throw err;
    }
  };

  const results = await sendBulkSms([{ to: "+1" }], sendFn, { ...FAST_OPTS, maxRetries: 5 });

  assert.equal(calls, 3);
  assert.equal(results[0].status, "sent");
  assert.equal(results[0].attempts, 3);
});

test("gives up after maxRetries and reports 'failed', not a thrown exception", async () => {
  const sendFn = async () => {
    const err = new Error("Too Many Requests");
    err.status = 429;
    throw err;
  };

  const results = await sendBulkSms([{ to: "+1" }], sendFn, { ...FAST_OPTS, maxRetries: 2 });

  assert.equal(results[0].status, "failed");
  assert.equal(results[0].attempts, 3); // 1 initial + 2 retries
});

test("does not retry a non-retryable error (e.g. invalid number, 400)", async () => {
  let calls = 0;
  const sendFn = async () => {
    calls++;
    const err = new Error("invalid number");
    err.status = 400;
    throw err;
  };

  const results = await sendBulkSms([{ to: "+1" }], sendFn, { ...FAST_OPTS, maxRetries: 5 });

  assert.equal(calls, 1, "should not retry a 400");
  assert.equal(results[0].status, "failed");
});

test("respects ratePerSecond by pacing sends (not just firing them all at once)", async () => {
  const timestamps = [];
  const sendFn = async () => {
    timestamps.push(Date.now());
  };
  const recipients = [{ to: "+1" }, { to: "+2" }, { to: "+3" }];

  await sendBulkSms(recipients, sendFn, { ratePerSecond: 20, baseBackoffMs: 1 }); // 50ms min gap

  const gap1 = timestamps[1] - timestamps[0];
  const gap2 = timestamps[2] - timestamps[1];
  assert.ok(gap1 >= 40, `expected >=40ms gap, got ${gap1}ms`); // small tolerance for timer jitter
  assert.ok(gap2 >= 40, `expected >=40ms gap, got ${gap2}ms`);
});

test("defaultIsRetryable treats 429 and 5xx as retryable, 4xx as not", () => {
  assert.equal(defaultIsRetryable({ status: 429 }), true);
  assert.equal(defaultIsRetryable({ status: 503 }), true);
  assert.equal(defaultIsRetryable({ status: 400 }), false);
  assert.equal(defaultIsRetryable({ status: 404 }), false);
});
