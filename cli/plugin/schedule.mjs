/**
 * Five-field cron helpers shared by manifest validation and the dev preview.
 * The host owns the real scheduler (enqueue, retries, timezones); the SDK
 * validates expressions up front and computes the next fire time locally so
 * the Jobs page can show it.
 *
 * Field order: minute hour day-of-month month day-of-week.
 * Supported syntax per field: `*`, `a`, `a-b`, `a,b,c`, star-steps (`*` + `/n`),
 * `a-b/n`, and `a/n` (every n starting at a). Month and weekday accept
 * three-letter names (JAN…DEC, SUN…SAT). Day-of-week treats 0 and 7 as Sunday.
 */
export const MAX_SCHEDULES = 10

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: MONTHS },
  { name: "day-of-week", min: 0, max: 6, names: DAYS, sundaySeven: true },
]

function fieldValue(raw, field) {
  const text = String(raw).trim().toUpperCase()
  if (!text) throw new Error(`empty ${field.name} value`)
  if (field.names) {
    const named = field.names.indexOf(text)
    if (named >= 0) return named + (field.name === "month" ? 1 : 0)
  }
  if (!/^\d+$/.test(text)) throw new Error(`"${raw}" is not a valid ${field.name} value`)
  let value = Number(text)
  if (field.sundaySeven && value === 7) value = 0
  if (value < field.min || value > field.max) {
    throw new Error(`${field.name} value ${raw} is out of range (${field.min}-${field.max})`)
  }
  return value
}

/** Range bounds allow day-of-week 7 as an upper bound (FRI–SUN / 5-7). */
function boundValue(raw, field) {
  if (field.sundaySeven && String(raw).trim() === "7") return 7
  return fieldValue(raw, field)
}

function parseField(spec, field) {
  const allowed = new Set()
  for (const part of String(spec).split(",")) {
    if (!part) throw new Error(`empty ${field.name} value in "${spec}"`)
    const [rangePart, stepPart, ...rest] = part.split("/")
    if (rest.length > 0) throw new Error(`invalid step in ${field.name} "${part}"`)
    let step = 1
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) < 1) throw new Error(`invalid step in ${field.name} "${part}"`)
      step = Number(stepPart)
    }
    let start
    let end
    if (rangePart === "*") {
      start = field.min
      end = field.max
    } else if (rangePart.includes("-")) {
      const [from, to, ...extra] = rangePart.split("-")
      if (extra.length > 0) throw new Error(`invalid range in ${field.name} "${part}"`)
      start = boundValue(from, field)
      end = boundValue(to, field)
    } else {
      start = fieldValue(rangePart, field)
      end = stepPart !== undefined ? field.max : start
    }
    if (start > end) throw new Error(`range ${part} in ${field.name} runs backwards`)
    for (let value = start; value <= end; value += step) allowed.add(value)
  }
  // Sunday can be written 0 or 7; the matcher uses 0-6.
  if (field.sundaySeven && allowed.has(7)) {
    allowed.delete(7)
    allowed.add(0)
  }
  return allowed
}

/** Parses a five-field cron expression. Throws on invalid input. */
export function parseCron(expression) {
  const fields = String(expression ?? "").trim().split(/\s+/).filter(Boolean)
  if (fields.length !== 5) {
    throw new Error(`cron must have exactly 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}`)
  }
  const parsed = fields.map((spec, index) => parseField(spec, FIELDS[index]))
  return {
    minute: parsed[0],
    hour: parsed[1],
    dayOfMonth: parsed[2],
    month: parsed[3],
    dayOfWeek: parsed[4],
    // Vixie-cron semantics: when both day fields are restricted, either may match.
    dayOfMonthRestricted: fields[2] !== "*",
    dayOfWeekRestricted: fields[4] !== "*",
  }
}

/** Returns an error string for an invalid expression, or null when valid. */
export function validateCron(expression) {
  try {
    parseCron(expression)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Validates an IANA timezone; returns an error string or null. */
export function validateTimeZone(timeZone) {
  if (!timeZone) return null
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: String(timeZone) })
    return null
  } catch {
    return `unknown timezone "${timeZone}"`
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MAX_MINUTES = 366 * 24 * 60

function matches(parsed, parts) {
  if (!parsed.minute.has(parts.minute) || !parsed.hour.has(parts.hour) || !parsed.month.has(parts.month)) return false
  const dom = parsed.dayOfMonth.has(parts.dayOfMonth)
  const dow = parsed.dayOfWeek.has(parts.dayOfWeek)
  if (parsed.dayOfMonthRestricted && parsed.dayOfWeekRestricted) return dom || dow
  if (parsed.dayOfMonthRestricted) return dom
  if (parsed.dayOfWeekRestricted) return dow
  return true
}

/**
 * Next fire time at or after `from` (minute precision), evaluated in
 * `timeZone`. Returns a Date or null when nothing matches within a year.
 */
export function nextRunAt(expression, { from = new Date(), timeZone = "UTC" } = {}) {
  const parsed = parseCron(expression)
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: String(timeZone || "UTC"),
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  })
  const date = new Date(from.getTime())
  date.setUTCSeconds(0, 0)
  date.setUTCMinutes(date.getUTCMinutes() + 1)
  for (let i = 0; i < MAX_MINUTES; i += 1) {
    const parts = {}
    for (const part of formatter.formatToParts(date)) parts[part.type] = part.value
    const weekday = WEEKDAYS.indexOf(parts.weekday)
    if (
      weekday >= 0 &&
      matches(parsed, {
        minute: Number(parts.minute),
        hour: Number(parts.hour),
        dayOfMonth: Number(parts.day),
        month: Number(parts.month),
        dayOfWeek: weekday,
      })
    ) {
      return new Date(date.getTime())
    }
    date.setUTCMinutes(date.getUTCMinutes() + 1)
  }
  return null
}

/**
 * Validates the manifest `schedules` array against the declared jobs.
 * Returns `{ errors, warnings }`; each schedule's next run is left to callers.
 */
export function validateSchedules(schedules, jobs) {
  const errors = []
  const warnings = []
  const list = Array.isArray(schedules) ? schedules : []
  if (list.length > MAX_SCHEDULES) errors.push(`too many schedules (${list.length}); the limit is ${MAX_SCHEDULES}`)
  const jobTypes = new Set((jobs ?? []).map((job) => String(job?.type ?? "")))
  const names = new Set()
  for (const schedule of list) {
    const label = String(schedule?.name ?? schedule?.job ?? "(unnamed)")
    if (!schedule || typeof schedule !== "object") {
      errors.push("each schedule must be an object")
      continue
    }
    const job = String(schedule.job ?? "")
    if (!job) errors.push(`schedule "${label}" needs a job type`)
    else if (!jobTypes.has(job)) errors.push(`schedule "${label}" references undeclared job "${job}"`)
    const cronError = validateCron(schedule.cron)
    if (cronError) errors.push(`schedule "${label}": ${cronError}`)
    const tzError = validateTimeZone(schedule.timezone)
    if (tzError) errors.push(`schedule "${label}": ${tzError}`)
    const name = String(schedule.name ?? job)
    if (names.has(name)) errors.push(`duplicate schedule name "${name}"`)
    names.add(name)
    if (schedule.enabled === false) warnings.push(`schedule "${label}" is disabled`)
  }
  return { errors, warnings }
}

/** Reads a manifest's schedules with computed next-run times (dev preview). */
export function describeSchedules(manifest, { from = new Date() } = {}) {
  return (manifest?.schedules ?? []).map((schedule) => {
    let nextRunAtIso = null
    let error = null
    try {
      const next = nextRunAt(String(schedule.cron), { from, timeZone: schedule.timezone || "UTC" })
      nextRunAtIso = next ? next.toISOString() : null
      if (!next) error = "no fire time within a year"
    } catch (parseError) {
      error = parseError instanceof Error ? parseError.message : String(parseError)
    }
    return {
      ...schedule,
      name: String(schedule.name ?? schedule.job ?? ""),
      timezone: schedule.timezone || "UTC",
      enabled: schedule.enabled !== false,
      nextRunAt: nextRunAtIso,
      error,
    }
  })
}
