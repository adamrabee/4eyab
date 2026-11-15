// Dates are handled in the school's timezone (Saudi Arabia) so "today" is right
// regardless of where the server runs.
export const SCHOOL_TZ = "Asia/Riyadh";

export const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"] as const;
export const SCHOOL_DAYS = [0, 1, 2, 3, 4] as const; // Sun–Thu

/** YYYY-MM-DD for "now" in the school timezone. */
export function todayISO(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** 0=Sunday … 6=Saturday for a YYYY-MM-DD date string. */
export function dayOfWeek(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function isISODate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Arabic long date, e.g. "الأحد، ١٥ نوفمبر ٢٠٢٦" (Gregorian). */
export function formatDateAr(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatTime(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : "";
}
