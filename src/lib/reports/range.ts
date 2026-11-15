import { addDays, isISODate, todayISO, weekStart } from "@/lib/dates";

export type Range = { from: string; to: string; preset: string };

/** Resolve report range from query params; defaults to "this month". */
export function resolveRange(sp: { from?: string; to?: string; preset?: string }): Range {
  const today = todayISO();
  const preset = sp.preset ?? (isISODate(sp.from) && isISODate(sp.to) ? "custom" : "month");
  switch (preset) {
    case "week":
      return { from: weekStart(today), to: today, preset };
    case "30":
      return { from: addDays(today, -29), to: today, preset };
    case "90":
      return { from: addDays(today, -89), to: today, preset };
    case "custom":
      if (isISODate(sp.from) && isISODate(sp.to)) {
        const [a, b] = sp.from <= sp.to ? [sp.from, sp.to] : [sp.to, sp.from];
        return { from: a, to: b, preset };
      }
    // falls through
    default:
      return { from: `${today.slice(0, 8)}01`, to: today, preset: "month" };
  }
}

export const STATUS_AR = { present: "حاضر", absent: "غائب", late: "متأخر", excused: "مستأذن" } as const;
