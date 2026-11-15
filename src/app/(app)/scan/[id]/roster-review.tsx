"use client";
import { useState, useTransition } from "react";
import type { RosterExtraction } from "@/lib/ai/schemas";
import { Alert, Button, Card, Field, Input, Select, cx } from "@/components/ui";
import { approveRoster, rejectJob } from "../actions";

type Row = { key: number; full_name: string; student_number: string; low: boolean };

export function RosterReview({ jobId, data, classrooms }: { jobId: string; data: RosterExtraction; classrooms: { id: string; name: string }[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    (data.students ?? []).map((s, i) => ({ key: i, full_name: s.full_name, student_number: s.student_number ?? "", low: s.confidence === "low" })),
  );
  const [nextKey, setNextKey] = useState(rows.length);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [classroomId, setClassroomId] = useState(classrooms[0]?.id ?? "");
  const [name, setName] = useState(data.classroom?.name ?? "");
  const [grade, setGrade] = useState(data.classroom?.grade ?? "");
  const [section, setSection] = useState(data.classroom?.section ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const filled = rows.filter((r) => r.full_name.trim()).length;
  const lowCount = rows.filter((r) => r.low && r.full_name.trim()).length;

  function update(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, low: patch.full_name !== undefined ? false : r.low } : r)));
  }

  function approve() {
    setError(null);
    start(async () => {
      const res = await approveRoster({
        jobId,
        target: mode === "existing" ? { mode, classroomId } : { mode, name, grade, section },
        students: rows.map((r) => ({ full_name: r.full_name, student_number: r.student_number })),
      });
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-4">
      {!data.is_roster && <Alert tone="warning">يبدو أن الملف ليس كشف أسماء. تحقّق من النتيجة جيدًا.</Alert>}
      {data.notes && <Alert tone="info">{data.notes}</Alert>}

      <Card className="space-y-3">
        <p className="font-medium">احفظ الطلاب في:</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> فصل جديد
          </label>
          <label className={cx("flex items-center gap-2", !classrooms.length && "opacity-50")}>
            <input type="radio" checked={mode === "existing"} disabled={!classrooms.length} onChange={() => setMode("existing")} /> فصل موجود
          </label>
        </div>
        {mode === "new" ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="اسم الفصل" htmlFor="c-name">
              <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: ثاني متوسط ١" required />
            </Field>
            <Field label="الصف (اختياري)" htmlFor="c-grade">
              <Input id="c-grade" value={grade} onChange={(e) => setGrade(e.target.value)} />
            </Field>
            <Field label="الشعبة (اختياري)" htmlFor="c-section">
              <Input id="c-section" value={section} onChange={(e) => setSection(e.target.value)} />
            </Field>
          </div>
        ) : (
          <Field label="الفصل" htmlFor="c-existing" hint="الأسماء الموجودة مسبقًا في الفصل لن تُكرَّر.">
            <Select id="c-existing" value={classroomId} onChange={(e) => setClassroomId(e.target.value)}>
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
        )}
      </Card>

      <Card className="p-0 sm:p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="font-medium">الطلاب ({filled})</p>
          {lowCount > 0 && <span className="text-xs text-late">{lowCount} اسم بحاجة لتأكيد</span>}
        </div>
        <ol className="divide-y divide-border">
          {rows.map((r, i) => (
            <li key={r.key} className={cx("flex items-center gap-2 px-3 py-2", r.low && "bg-late-soft")}>
              <span className="w-6 shrink-0 text-center text-xs text-muted ltr-nums">{i + 1}</span>
              <Input
                aria-label={`اسم الطالب ${i + 1}`}
                value={r.full_name}
                onChange={(e) => update(r.key, { full_name: e.target.value })}
                className="h-10 flex-1"
              />
              <Input
                aria-label={`رقم الطالب ${i + 1}`}
                value={r.student_number}
                onChange={(e) => update(r.key, { student_number: e.target.value })}
                placeholder="الرقم"
                dir="ltr"
                className="hidden h-10 w-28 sm:block"
              />
              <button
                type="button"
                aria-label={`حذف ${r.full_name || "السطر"}`}
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                className="grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-absent-soft hover:text-absent"
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
        <div className="border-t border-border p-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setRows((rs) => [...rs, { key: nextKey, full_name: "", student_number: "", low: false }]);
              setNextKey((k) => k + 1);
            }}
          >
            + إضافة طالب
          </Button>
        </div>
      </Card>

      {error && <Alert>{error}</Alert>}
      <div className="no-print sticky bottom-20 z-10 flex gap-2 rounded-2xl border border-border bg-surface p-3 shadow-lg lg:bottom-4">
        <Button type="button" className="flex-1" onClick={approve} disabled={pending || filled === 0}>
          {pending ? "جارٍ الحفظ…" : `اعتماد وحفظ ${filled} طالب`}
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await rejectJob(jobId); if (r?.error) setError(r.error); })}>
          رفض
        </Button>
      </div>
    </div>
  );
}
