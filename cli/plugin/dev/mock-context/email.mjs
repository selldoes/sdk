/**
 * Builds the mock `ctx.email` capability. Sent messages are recorded on the
 * shared `outbox` (last 100); `email.disabled` flips the reported result.
 */
export function createEmail({ outbox, config, requirePermission, log }) {
  return {
    async send({ to, subject, html, text }) {
      requirePermission("email:send", "ctx.email.send")
      const entry = {
        to: String(to ?? ""),
        subject: String(subject ?? ""),
        html: html ?? null,
        text: text ?? null,
        at: new Date().toISOString(),
      }
      outbox.push(entry)
      if (outbox.length > 100) outbox.shift()
      log(`[email] → ${entry.to}: ${entry.subject}`)
      return { sent: config.email?.disabled !== true }
    },
  }
}
