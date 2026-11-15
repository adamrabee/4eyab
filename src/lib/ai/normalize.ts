import type { RosterExtraction, ScheduleExtraction } from "./schemas";

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Convert Arabic-Indic / Persian digits to ASCII. */
export function toAsciiDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (c) => {
    const i = ARABIC_DIGITS.indexOf(c);
    return String(i >= 0 ? i : PERSIAN_DIGITS.indexOf(c));
  });
}

/** Trim, collapse whitespace, strip tatweel and stray punctuation at the edges. */
export function cleanName(s: string): string {
  return s
    .replace(/ـ/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—.,:;|/\\*•·\d٠-٩]+/, "") // leading serial numbers / bullets
    .replace(/[\s\-–—.,:;|/\\*•·]+$/, "")
    .trim()
    .slice(0, 150);
}

/** Key for duplicate detection — mirrors public.normalize_ar_name in SQL. */
export function nameKey(s: string): string {
  return s
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTime(s: string): string {
  const m = toAsciiDigits(s ?? "").trim().match(/^(\d{1,2})[:.٫](\d{2})/);
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function normalizeRoster(r: RosterExtraction): RosterExtraction {
  const seen = new Set<string>();
  const students = [];
  for (const s of r.students ?? []) {
    const full_name = cleanName(s.full_name ?? "");
    if (full_name.length < 2) continue;
    const key = nameKey(full_name);
    if (seen.has(key)) continue;
    seen.add(key);
    students.push({
      full_name,
      student_number: toAsciiDigits(s.student_number ?? "").replace(/\s+/g, "").slice(0, 40),
      confidence: s.confidence ?? "medium",
    });
  }
  return {
    is_roster: Boolean(r.is_roster),
    classroom: {
      name: (r.classroom?.name ?? "").trim().slice(0, 80),
      grade: (r.classroom?.grade ?? "").trim().slice(0, 60),
      section: (r.classroom?.section ?? "").trim().slice(0, 30),
    },
    students: students.slice(0, 200),
    notes: (r.notes ?? "").trim().slice(0, 500),
  };
}

export function normalizeSchedule(s: ScheduleExtraction): ScheduleExtraction {
  const bySlot = new Map<string, ScheduleExtraction["entries"][number]>();
  for (const e of s.entries ?? []) {
    const day = Math.trunc(Number(e.day_of_week));
    const period = Math.trunc(Number(e.period_number));
    if (!(day >= 0 && day <= 6) || !(period >= 1 && period <= 12)) continue;
    const classroom_name = (e.classroom_name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!classroom_name) continue; // free period
    const start = normalizeTime(e.start_time);
    let end = normalizeTime(e.end_time);
    if (start && end && end <= start) end = "";
    if (!start) end = "";
    bySlot.set(`${day}:${period}`, {
      day_of_week: day,
      period_number: period,
      start_time: start,
      end_time: end,
      classroom_name,
      subject: (e.subject ?? "").trim().slice(0, 80),
      room: (e.room ?? "").trim().slice(0, 40),
      confidence: e.confidence ?? "medium",
    });
  }
  const entries = [...bySlot.values()].sort((a, b) => a.day_of_week - b.day_of_week || a.period_number - b.period_number);
  return { is_schedule: Boolean(s.is_schedule), entries, notes: (s.notes ?? "").trim().slice(0, 500) };
}
