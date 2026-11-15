"use client";
import { useMemo, useState, useTransition } from "react";
import type { ScheduleExtraction } from "@/lib/ai/schemas";
import { DAY_NAMES } from "@/lib/dates";
import { Alert, Button, Card, Input, Select, cx } from "@/components/ui";
import { approveSchedule, rejectJob } from "../actions";

type Entry = {
  key: number;
  day_of_week: number;
  period_number: number;
  start_time: string;
  end_time: string;
  label: string; // classroom label as extracted; mapped below
  subject: string;
  low: boolean;
};

// mapping value: "new" → create classroom with label as name, otherwise an existing classroom id
type Mapping = Record<string, string>;

const norm = (s: string) => s.replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();

export function ScheduleReview({ jobId, data, classrooms }: { jobId: string; data: ScheduleExtraction; classrooms: { id: string; name: string }[] }) {
  const [entries, setEntries] = useState<Entry[]>(() =>
    (data.entries ?? []).map((e, i) => ({
      key: i,
      day_of_week: e.day_of_week,
      period_number: e.period_number,
      start_time: e.start_time,
      end_time: e.end_time,
      label: e.classroom_name,
      subject: e.subject,
      low: e.confidence === "low",
    })),
  );
  const [nextKey, setNextKey] = useState(entries.length);
  const labels = useMemo(() => [...new Set(entries.map((e) => e.label).filter(Boolean))], [entries]);
  const [mapping, setMapping] = useState<Mapping>(() => {
    const m: Mapping = {};
    for (const l of new Set((data.entries ?? []).map((e) => e.classroom_name))) {
      const match = classrooms.find((c) => norm(c.name) === norm(l));
      m[l] = match ? match.id : "new";
    }
    return m;
  });
  const [replace, setReplace] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const conflicts = useMemo(() => {
    const seen = new Map<string, number>();
    entries.forEach((e) => seen.set(`${e.day_of_week}:${e.period_number}`, (seen.get(`${e.day_of_week}:${e.period_number}`) ?? 0) + 1));
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }, [entries]);

  function update(key: number, patch: Partial<Entry>) {
    setEntries((es) => es.map((e) => (e.key === key ? { ...e, ...patch, low: false } : e)));
  }

  function approve() {
    setError(null);
    start(async () => {
      const res = await approveSchedule({
        jobId,
        replaceExisting: replace,
        entries: entries.map((e) => {
          const m = mapping[e.label] ?? "new";
          return {
            day_of_week: e.day_of_week,
            period_number: e.period_number,
            start_time: e.start_time,
            end_time: e.end_time,
            subject: e.subject,
            room: "",
            ...(m === "new" ? { classroom_name: e.label } : { classroom_id: m }),
          };
        }),
      });
      if (res?.error) setError(res.error);
    });
  }

  const sorted = [...entries].sort((a, b) => a.day_of_week - b.day_of_week || a.period_number - b.period_number);

  return (
    <div className="space-y-4">
      {!data.is_schedule && <Alert tone="warning">يبدو أن الملف ليس جدولًا دراسيًا. تحقّق من النتيجة جيدًا.</Alert>}
      {data.notes && <Alert tone="info">{data.notes}</Alert>}

      {labels.length > 0 && (
        <Card className="space-y-3">
          <p className="font-medium">ربط الفصول</p>
          <p className="text-xs text-muted">اختر لكل فصل ظهر في الجدول: فصل موجود لديك، أو أنشئ فصلًا جديدًا بنفس الاسم.</p>
          <ul className="space-y-2">
            {labels.map((l) => (
              <li key={l} className="grid grid-cols-[1fr_1.4fr] items-center gap-2">
                <span className="truncate font-medium">{l}</span>
                <Select aria-label={`ربط ${l}`} value={mapping[l] ?? "new"} onChange={(e) => setMapping((m) => ({ ...m, [l]: e.target.value }))}>
                  <option value="new">➕ فصل جديد «{l}»</option>
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-0 sm:p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="font-medium">الحصص ({entries.length})</p>
          {conflicts.size > 0 && <span className="text-xs text-absent">يوجد تعارض في {conflicts.size} موضع</span>}
        </div>
        <ul className="divide-y divide-border">
          {sorted.map((e) => {
            const clash = conflicts.has(`${e.day_of_week}:${e.period_number}`);
            return (
              <li key={e.key} className={cx("grid grid-cols-2 gap-2 p-3 sm:grid-cols-[7rem_5rem_1fr_1fr_auto]", e.low && "bg-late-soft", clash && "bg-absent-soft")}>
                <Select aria-label="اليوم" value={e.day_of_week} onChange={(ev) => update(e.key, { day_of_week: Number(ev.target.value) })} className="h-10">
                  {DAY_NAMES.map((d, i) => (
                    <option key={d} value={i}>{d}</option>
                  ))}
                </Select>
                <Select aria-label="رقم الحصة" value={e.period_number} onChange={(ev) => update(e.key, { period_number: Number(ev.target.value) })} className="h-10">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>الحصة {n}</option>
                  ))}
                </Select>
                <Select aria-label="الفصل" value={e.label} onChange={(ev) => update(e.key, { label: ev.target.value })} className="h-10">
                  {labels.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </Select>
                <Input aria-label="المادة" value={e.subject} onChange={(ev) => update(e.key, { subject: ev.target.value })} placeholder="المادة" className="h-10" />
                <button
                  type="button"
                  aria-label="حذف الحصة"
                  onClick={() => setEntries((es) => es.filter((x) => x.key !== e.key))}
                  className="col-span-2 h-10 rounded-lg text-sm text-muted hover:bg-absent-soft hover:text-absent sm:col-span-1 sm:w-10"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-border p-3">
          <Button
            type="button"
            variant="ghost"
            disabled={labels.length === 0}
            onClick={() => {
              setEntries((es) => [...es, { key: nextKey, day_of_week: 0, period_number: 1, start_time: "", end_time: "", label: labels[0] ?? "", subject: "", low: false }]);
              setNextKey((k) => k + 1);
            }}
          >
            + إضافة حصة
          </Button>
        </div>
      </Card>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
        <span>استبدال جدولي الحالي بالكامل بهذا الجدول (إن لم تختر ذلك، تُحدَّث الحصص المتطابقة فقط).</span>
      </label>

      {error && <Alert>{error}</Alert>}
      <div className="no-print sticky bottom-20 z-10 flex gap-2 rounded-2xl border border-border bg-surface p-3 shadow-lg lg:bottom-4">
        <Button type="button" className="flex-1" onClick={approve} disabled={pending || entries.length === 0 || conflicts.size > 0}>
          {pending ? "جارٍ الحفظ…" : `اعتماد وحفظ ${entries.length} حصة`}
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await rejectJob(jobId); if (r?.error) setError(r.error); })}>
          رفض
        </Button>
      </div>
    </div>
  );
}
