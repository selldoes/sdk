import assert from "node:assert/strict"
import test from "node:test"
import { describeSchedules, MAX_SCHEDULES, nextRunAt, validateCron, validateSchedules, validateTimeZone } from "./schedule.mjs"

test("validateCron accepts the documented syntax", () => {
  for (const expression of [
    "* * * * *",
    "*/5 * * * *",
    "0 9 * * MON-FRI",
    "15 2,14 1 JAN *",
    "0 0 1 * 7",
    "0 0 1-15/2 * *",
    "30 6 * * sun",
    "0 0 * * 5-7",
    "0 0 * * 0-7",
  ]) {
    assert.equal(validateCron(expression), null, expression)
  }
})

test("validateCron rejects malformed expressions with a reason", () => {
  assert.match(validateCron("* * * *"), /5 fields/)
  assert.match(validateCron("60 * * * *"), /minute value 60 is out of range/)
  assert.match(validateCron("* 24 * * *"), /hour value 24 is out of range/)
  assert.match(validateCron("* * 32 * *"), /day-of-month value 32 is out of range/)
  assert.match(validateCron("* * * FOO *"), /not a valid month/)
  assert.match(validateCron("* * * * */0"), /invalid step/)
  assert.match(validateCron("10-5 * * * *"), /runs backwards/)
})

test("nextRunAt walks forward in UTC", () => {
  const next = nextRunAt("*/15 * * * *", { from: new Date("2026-01-01T00:07:30Z") })
  assert.equal(next.toISOString(), "2026-01-01T00:15:00.000Z")
})

test("nextRunAt honours weekdays", () => {
  // 2026-10-04 is a Sunday.
  const next = nextRunAt("0 9 * * MON-FRI", { from: new Date("2026-10-04T12:00:00Z") })
  assert.equal(next.toISOString(), "2026-10-05T09:00:00.000Z")
})

test("nextRunAt honours IANA timezones", () => {
  const next = nextRunAt("0 9 * * *", { from: new Date("2026-01-01T00:00:00Z"), timeZone: "America/New_York" })
  assert.equal(next.toISOString(), "2026-01-01T14:00:00.000Z")
})

test("nextRunAt uses either day field when both are restricted", () => {
  const next = nextRunAt("0 0 13 * FRI", { from: new Date("2026-10-04T00:00:00Z") })
  assert.equal(next.toISOString(), "2026-10-09T00:00:00.000Z")
})

test("nextRunAt treats day-of-week 7 as Sunday", () => {
  // 2026-10-04 is a Sunday; the next Sunday after Monday is 2026-10-11.
  const next = nextRunAt("0 12 * * 5-7", { from: new Date("2026-10-05T00:00:00Z") })
  assert.equal(next.toISOString(), "2026-10-09T12:00:00.000Z")
  const sunday = nextRunAt("0 12 * * 7", { from: new Date("2026-10-05T00:00:00Z") })
  assert.equal(sunday.toISOString(), "2026-10-11T12:00:00.000Z")
})

test("validateTimeZone accepts IANA names and rejects junk", () => {
  assert.equal(validateTimeZone("Europe/Berlin"), null)
  assert.equal(validateTimeZone(undefined), null)
  assert.match(validateTimeZone("Mars/Olympus"), /unknown timezone/)
})

test("validateSchedules checks job references, cron, names and the limit", () => {
  const jobs = [{ type: "sync" }, { type: "cleanup" }]
  const clean = validateSchedules([{ job: "sync", cron: "0 * * * *" }], jobs)
  assert.deepEqual(clean.errors, [])

  const broken = validateSchedules(
    [
      { job: "missing", cron: "0 * * * *" },
      { name: "nightly", job: "sync", cron: "not a cron" },
      { name: "nightly", job: "cleanup", cron: "0 0 * * *" },
      { job: "cleanup", cron: "0 0 * * *", enabled: false },
    ],
    jobs,
  )
  assert.match(broken.errors.join("\n"), /undeclared job "missing"/)
  assert.match(broken.errors.join("\n"), /5 fields/)
  assert.match(broken.errors.join("\n"), /duplicate schedule name "nightly"/)
  assert.match(broken.warnings.join("\n"), /disabled/)

  const tooMany = validateSchedules(Array.from({ length: MAX_SCHEDULES + 1 }, () => ({ job: "sync", cron: "* * * * *" })), jobs)
  assert.match(tooMany.errors.join("\n"), /too many schedules/)
})

test("describeSchedules fills defaults and computes the next run", () => {
  const described = describeSchedules(
    { schedules: [{ job: "sync", cron: "0 12 * * *" }] },
    { from: new Date("2026-01-01T00:00:00Z") },
  )
  assert.equal(described.length, 1)
  assert.equal(described[0].name, "sync")
  assert.equal(described[0].timezone, "UTC")
  assert.equal(described[0].enabled, true)
  assert.equal(described[0].nextRunAt, "2026-01-01T12:00:00.000Z")
  assert.equal(described[0].error, null)
})
