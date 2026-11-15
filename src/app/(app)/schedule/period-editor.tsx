"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import { DAY_NAMES, SCHOOL_DAYS, formatTime } from "@/lib/dates";
import { Alert, Button, Card, Field, Input, Select, cx } from "@/components/ui";
import { deletePeriod, savePeriod } from "./actions";
import type { Period } from "./page";

export function PeriodEditor({ periods, classrooms }: { periods: Period[]; classrooms: { id: string; name: string }[] }) {
  const [day, setDay] = useState<number>(SCHOOL_DAYS[0]);
  const [editing, setEditing] = useState<Period | "new" | null>(null);
  const names = new Map(classrooms.map((c) => [c.id, c.name]));
  const list = periods.filter((p) => p.day_of_week === day).sort((a, b) => a.period_number - b.period_number);

  return (
    <section className="mt-6">
      <div className="mb-3 flex gap-1 overflow-x-auto" role="tablist" aria-label="أيام الأسبوع">
        {SCHOOL_DAYS.map((d) => (
          <button
            key={d}
            role="tab"
            aria-selected={day === d}
            onClick={() => { setDay(d); setEditing(null); }}
            className={cx("h-10 shrink-0 rounded-full px-4 text-sm font-medium", day === d ? "bg-primary text-on-primary" : "bg-surface text-muted border border-border")}
          >
            {DAY_NAMES[d]}
          </button>
        ))}
      </div>

      <Card className="p-0 sm:p-0">
        <ul className="divide-y divide-border">
          {list.map((p) => (
            <li key={p.id} id={`edit-${p.id}`}>
              <button type="button" onClick={() => setEditing(p)} className="flex w-full items-center gap-3 p-3 text-start hover:bg-surface-2">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft font-bold text-primary">{p.period_number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{names.get(p.classroom_id) ?? "—"}</span>
                  <span className="block truncate text-xs text-muted">
                    {p.subject}
                    {p.start_time && <span className="ltr-nums"> · {formatTime(p.start_time)}–{formatTime(p.end_time)}</span>}
                  </span>
                </span>
                <span className="text-xs text-muted">تعديل</span>
              </button>
              {editing !== "new" && editing?.id === p.id && (
                <PeriodForm key={p.id} period={p} day={day} classrooms={classrooms} onDone={() => setEditing(null)} />
              )}
            </li>
          ))}
          {list.length === 0 && <li className="p-4 text-center text-sm text-muted">لا توجد حصص يوم {DAY_NAMES[day]}.</li>}
        </ul>
        <div className="border-t border-border p-3">
          {editing === "new" ? (
            <PeriodForm key={`new-${day}`} day={day} classrooms={classrooms} onDone={() => setEditing(null)} nextPeriod={(list.at(-1)?.period_number ?? 0) + 1} />
          ) : (
            <Button variant="ghost" onClick={() => setEditing("new")}>+ إضافة حصة يوم {DAY_NAMES[day]}</Button>
          )}
        </div>
      </Card>
    </section>
  );
}

function PeriodForm({ period, day, classrooms, onDone, nextPeriod = 1 }: { period?: Period; day: number; classrooms: { id: string; name: string }[]; onDone: () => void; nextPeriod?: number }) {
  const [state, action, saving] = useActionState(savePeriod, undefined);
  const [pending, start] = useTransition();
  const [delError, setDelError] = useState<string | null>(null);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="grid gap-3 bg-surface-2 p-3 sm:grid-cols-3">
      <input type="hidden" name="id" value={period?.id ?? ""} />
      <Field label="اليوم" htmlFor="pf-day">
        <Select id="pf-day" name="day_of_week" defaultValue={period?.day_of_week ?? day}>
          {DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </Select>
      </Field>
      <Field label="رقم الحصة" htmlFor="pf-num">
        <Select id="pf-num" name="period_number" defaultValue={period?.period_number ?? Math.min(nextPeriod, 12)}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
      </Field>
      <Field label="الفصل" htmlFor="pf-class">
        <Select id="pf-class" name="classroom_id" defaultValue={period?.classroom_id ?? classrooms[0]?.id}>
          {classrooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="المادة" htmlFor="pf-subject"><Input id="pf-subject" name="subject" defaultValue={period?.subject ?? ""} /></Field>
      <Field label="من" htmlFor="pf-start"><Input id="pf-start" name="start_time" type="time" defaultValue={formatTime(period?.start_time)} dir="ltr" /></Field>
      <Field label="إلى" htmlFor="pf-end"><Input id="pf-end" name="end_time" type="time" defaultValue={formatTime(period?.end_time)} dir="ltr" /></Field>
      {(state?.error || delError) && <div className="sm:col-span-3"><Alert>{state?.error ?? delError}</Alert></div>}
      <div className="flex flex-wrap gap-2 sm:col-span-3">
        <Button type="submit" disabled={saving}>حفظ</Button>
        <Button type="button" variant="secondary" onClick={onDone}>إلغاء</Button>
        {period && (
          <Button
            type="button"
            variant="ghost"
            className="ms-auto text-absent"
            disabled={pending}
            onClick={() => start(async () => { const r = await deletePeriod(period.id); if (r?.error) setDelError(r.error); else onDone(); })}
          >
            حذف الحصة
          </Button>
        )}
      </div>
    </form>
  );
}
