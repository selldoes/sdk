/**
 * Builds the mock `ctx.realtime` capability. Published events are kept on the
 * shared `events` list (last 500) for `poll` to replay.
 */
export function createRealtime({ events, requirePermission, log }) {
  let realtimeCursor = 0

  return {
    async publish(channel, event, data) {
      requirePermission("realtime:publish", "ctx.realtime.publish")
      const entry = { id: ++realtimeCursor, channel: String(channel), event: String(event), data, at: new Date().toISOString() }
      events.push(entry)
      if (events.length > 500) events.shift()
      log(`[realtime] ${channel} → ${event}`)
      return { id: entry.id, pushed: false }
    },
    async poll(channel, opts = {}) {
      const since = Number(opts.since) || 0
      const list = events.filter((entry) => entry.channel === String(channel) && entry.id > since)
      const limited = list.slice(0, opts.limit ?? 50)
      return {
        events: limited.map((entry) => ({ id: entry.id, event: entry.event, data: entry.data })),
        cursor: limited.at(-1)?.id ?? since,
      }
    },
  }
}
