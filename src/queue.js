function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends a batch of messages through `sendFn` at no more than `ratePerSecond`,
 * retrying transient failures with exponential backoff, and never letting one
 * recipient's failure stop the rest of the campaign.
 *
 * @param {Array<{to: string, body: string}>} recipients
 * @param {(msg: {to: string, body: string}) => Promise<any>} sendFn - e.g. twilioClient.messages.create
 * @param {object} opts
 * @param {number} opts.ratePerSecond - max sends per second (Twilio's own per-number/service cap)
 * @param {number} opts.maxRetries - retries per recipient before giving up
 * @param {number} opts.baseBackoffMs - first retry delay; doubles each retry
 * @param {(err: any) => boolean} opts.isRetryable - decide if an error is worth retrying (default: 429/5xx-shaped)
 * @returns {Promise<Array<{to: string, status: 'sent'|'failed', attempts: number, error?: string}>>}
 */
async function sendBulkSms(recipients, sendFn, opts = {}) {
  const {
    ratePerSecond = 1,
    maxRetries = 3,
    baseBackoffMs = 500,
    isRetryable = defaultIsRetryable,
  } = opts;

  const minGapMs = 1000 / ratePerSecond;
  const results = [];

  for (const recipient of recipients) {
    const start = Date.now();
    const outcome = await sendOneWithRetry(recipient, sendFn, { maxRetries, baseBackoffMs, isRetryable });
    results.push(outcome);

    // Pace sends to stay under the rate limit regardless of how long sendFn took.
    const elapsed = Date.now() - start;
    if (elapsed < minGapMs) {
      await sleep(minGapMs - elapsed);
    }
  }

  return results;
}

async function sendOneWithRetry(recipient, sendFn, { maxRetries, baseBackoffMs, isRetryable }) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      await sendFn(recipient);
      return { to: recipient.to, status: "sent", attempts: attempt };
    } catch (err) {
      lastError = err;
      const retriesLeft = maxRetries + 1 - attempt;
      if (retriesLeft <= 0 || !isRetryable(err)) {
        break;
      }
      await sleep(baseBackoffMs * 2 ** (attempt - 1));
    }
  }
  return {
    to: recipient.to,
    status: "failed",
    attempts: maxRetries + 1,
    error: lastError?.message || String(lastError),
  };
}

function defaultIsRetryable(err) {
  const code = err?.status || err?.code;
  if (code === 429) return true;
  if (typeof code === "number" && code >= 500) return true;
  return false;
}

module.exports = { sendBulkSms, defaultIsRetryable };
