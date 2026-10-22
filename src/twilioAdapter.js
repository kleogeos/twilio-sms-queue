// Thin adapter showing how to plug a real Twilio client into sendBulkSms().
// Not wired to a live account here (no credentials in this repo) - this is the
// shape the client's real backend would call with its own twilio() client instance.

function makeTwilioSendFn(twilioClient, { from, messagingServiceSid } = {}) {
  return async function sendFn({ to, body }) {
    try {
      return await twilioClient.messages.create({
        to,
        body,
        ...(messagingServiceSid ? { messagingServiceSid } : { from }),
      });
    } catch (err) {
      // Twilio's SDK already exposes `.status` (HTTP status) and `.code` (Twilio error code)
      // on thrown errors, which is exactly what queue.js's defaultIsRetryable reads.
      throw err;
    }
  };
}

module.exports = { makeTwilioSendFn };
