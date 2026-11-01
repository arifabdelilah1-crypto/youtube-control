// Copy of web/slots.js (kept in sync by hand; edge functions can't import from web/).
// Publishing slots: "Mon/Wed/Fri at 18:00 Europe/Madrid" -> concrete UTC times.
// Plain ES module with no dependencies: used by the dashboard, the render job (Node) and, as a copy, the publish edge function.

const DAY = 864e5;

/** Offset (ms) between UTC and the given time zone at instant t. */
function tzOffset(t: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t)).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - t;
}

/** UTC instant for a local wall-clock time in a time zone. */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, timeZone: string) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - tzOffset(guess, timeZone);
  t = guess - tzOffset(t, timeZone);   // second pass handles DST edges
  return t;
}

/** Local calendar date (y, m, d, weekday) of instant t in a time zone. */
function localDate(t: number, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
    .formatToParts(new Date(t)).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}

/** All slot instants (ms, ascending) from `from` for `days` days. */
export function slotsBetween(schedule: any, from: number, days = 14) {
  const tz = schedule.timezone || "UTC";
  const want = new Set((schedule.days || []).map(Number));
  const times = (schedule.times || []).map((s) => String(s).match(/^(\d{1,2}):(\d{2})$/)).filter(Boolean).map((m) => [+m[1], +m[2]]);
  const out = [];
  for (let i = 0; i <= days; i++) {
    const { y, m, d, wd } = localDate(from + i * DAY, tz);
    if (!want.has(wd)) continue;
    for (const [hh, mm] of times) {
      const t = zonedToUtc(y, m, d, hh, mm, tz);
      if (t >= from && t <= from + days * DAY) out.push(t);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * Next free slot (ms) after now + leadMinutes, skipping slots already taken (instants in ms).
 * A slot counts as taken when another post is within 30 minutes of it.
 */
export function nextFreeSlot(schedule: any, taken: number[] = [], now = Date.now(), leadMinutes = 45, horizonDays = 120) {
  const from = now + leadMinutes * 60e3;
  for (const t of slotsBetween(schedule, from, horizonDays)) {
    if (!taken.some((x) => Math.abs(x - t) < 30 * 60e3)) return t;
  }
  return null;
}
