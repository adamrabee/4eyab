"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Input, cx } from "@/components/ui";
import { deleteSession, saveAttendance } from "../actions";

export type Status = "present" | "absent" | "late" | "excused";
type Rec = { status: Status; minutes_late: number | null; note: string };
type Marks = Record<string, Rec>;
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const LABEL: Record<Exclude<Status, "present">, string> = { absent: "غائب", late: "متأخر", excused: "مستأذن" };
const TONE: Record<Exclude<Status, "present">, { on: string; row: string; tag: string }> = {
  absent: { on: "bg-absent text-white border-absent", row: "bg-absent-soft", tag: "border-absent/40 text-absent" },
  late: { on: "bg-late text-white border-late", row: "bg-late-soft", tag: "border-late/40 text-late" },
  excused: { on: "bg-excused text-white border-excused", row: "bg-excused-soft", tag: "border-excused/40 text-excused" },
};

export function Taker(props: {
  classroomId: string;
  date: string;
  period: number;
  initialSubject: string;
  slots: { period: number; subject: string }[];
  takenPeriods: number[];
  students: { id: string; name: string; removed: boolean }[];
  initial: Marks;
  sessionId: string | null;
  previous: { period: number; records: Marks } | null;
}) {
  const { classroomId, date, period, students } = props;
  const router = useRouter();
  const [marks, setMarks] = useState<Marks>(props.initial);
  const [subject, setSubject] = useState(props.initialSubject);
  const [sessionId, setSessionId] = useState(props.sessionId);
  const [state, setState] = useState<SaveState>(props.sessionId ? "saved" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const version = useRef(0);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ marks, subject });
  useEffect(() => {
    latest.current = { marks, subject };
  }, [marks, subject]);

  const statusOf = useCallback((id: string): Status => marks[id]?.status ?? "present", [marks]);
  const byStatus = useMemo(() => {
    const g: Record<Status, typeof students> = { present: [], absent: [], late: [], excused: [] };
    students.forEach((s) => g[statusOf(s.id)].push(s));
    return g;
  }, [students, statusOf]);

  // ---- saving: debounced, never overlapping; re-saves if edits happened mid-flight
  const flush = useCallback(async () => {
    if (inFlight.current) return; // the running loop below will pick up newer edits
    inFlight.current = true;
    try {
      let v: number;
      do {
        // wait a tick so the ref reflects the latest render
        await new Promise((r) => setTimeout(r, 0));
        v = version.current;
        setState("saving");
        const { marks: m, subject: subj } = latest.current;
        const res = await saveAttendance({
          classroomId,
          date,
          period,
          subject: subj,
          records: students.map((s) => ({
            student_id: s.id,
            status: m[s.id]?.status ?? "present",
            minutes_late: m[s.id]?.status === "late" ? (m[s.id]?.minutes_late ?? null) : null,
            note: m[s.id]?.note ?? "",
          })),
        });
        if (!res.ok) {
          setState("error");
          setError(res.error);
          return;
        }
        setSessionId(res.sessionId);
        setError(null);
      } while (version.current !== v);
      setState("saved");
    } finally {
      inFlight.current = false;
    }
  }, [classroomId, date, period, students]);

  const schedule = useCallback(() => {
    version.current++;
    setState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 500);
  }, [flush]);

  // warn before leaving with unsaved changes
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (state === "dirty" || state === "saving" || state === "error") e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [state]);

  function setStatus(id: string, s: Status) {
    setMarks((m) => {
      const next = { ...m };
      const cur = m[id]?.status ?? "present";
      const target = cur === s ? "present" : s; // tapping the active status returns to present
      if (target === "present") delete next[id];
      else next[id] = { status: target, minutes_late: target === "late" ? (m[id]?.minutes_late ?? null) : null, note: m[id]?.note ?? "" };
      return next;
    });
    schedule();
  }

  function setMinutes(id: string, v: string) {
    const n = v === "" ? null : Math.max(0, Math.min(600, Math.trunc(Number(v)) || 0));
    setMarks((m) => (m[id] ? { ...m, [id]: { ...m[id], minutes_late: n } } : m));
    schedule();
  }

  function copyPrevious() {
    if (!props.previous) return;
    const ids = new Set(students.map((s) => s.id));
    const next: Marks = {};
    for (const [id, r] of Object.entries(props.previous.records)) {
      if (ids.has(id) && r.status !== "present") next[id] = { ...r };
    }
    setMarks(next);
    schedule();
  }

  function clearAll() {
    setMarks({});
    schedule();
  }

  async function copyNames() {
    const lines = [`غياب الحصة ${period}${subject ? ` (${subject})` : ""} — ${date}`];
    (["absent", "late", "excused"] as const).forEach((st) => {
      if (byStatus[st].length) lines.push("", `${LABEL[st]} (${byStatus[st].length}):`, ...byStatus[st].map((s, i) => `${i + 1}. ${s.name}`));
    });
    if (lines.length === 1) lines.push("لا يوجد غياب");
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("انسخ النص:", text);
    }
  }

  function go(p: number) {
    router.push(`/attendance/${classroomId}?date=${date}&period=${p}`);
  }

  const missing = byStatus.absent.length + byStatus.late.length + byStatus.excused.length;
  const statusText: Record<SaveState, string> = {
    idle: "لم يُحفظ بعد",
    dirty: "سيُحفظ تلقائيًا…",
    saving: "جارٍ الحفظ…",
    saved: "تم الحفظ ✓",
    error: "لم يُحفظ",
  };

  return (
    <div className="space-y-4">
      {/* period switcher: this classroom's periods today + any other number */}
      <div className="flex flex-wrap items-center gap-2">
        {props.slots.map((s) => (
          <button
            key={s.period}
            type="button"
            onClick={() => go(s.period)}
            className={cx(
              "h-9 rounded-full border px-3 text-sm",
              s.period === period ? "border-primary bg-primary text-on-primary" : "border-border bg-surface",
              props.takenPeriods.includes(s.period) && s.period !== period && "border-present text-present",
            )}
          >
            الحصة {s.period}
            {s.subject && <span className="opacity-75"> · {s.subject}</span>}
          </button>
        ))}
        {!props.slots.some((s) => s.period === period) && (
          <span className="h-9 rounded-full border border-primary bg-primary px-3 text-sm leading-9 text-on-primary">الحصة {period} (خارج الجدول)</span>
        )}
      </div>

      {/* summary box — mirrors the original: who is absent, count, quick tools */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">
            الغائبون: {byStatus.absent.length}
            {byStatus.late.length > 0 && <span className="text-late"> · متأخر: {byStatus.late.length}</span>}
            {byStatus.excused.length > 0 && <span className="text-excused"> · مستأذن: {byStatus.excused.length}</span>}
          </h2>
          <span
            role="status"
            className={cx(
              "rounded-full px-2.5 py-1 text-xs font-medium",
              state === "saved" ? "bg-present-soft text-present" : state === "error" ? "bg-absent-soft text-absent" : "bg-surface-2 text-muted",
            )}
          >
            {statusText[state]}
          </span>
        </div>

        {missing > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {(["absent", "late", "excused"] as const).flatMap((st) =>
              byStatus[st].map((s) => (
                <span key={s.id} className={cx("rounded-full border px-2.5 py-0.5 text-sm", TONE[st].tag)}>{s.name}</span>
              )),
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">{sessionId ? "جميع الطلاب حاضرون." : "لم يتم اختيار أي طالب غائب."}</p>
        )}

        {error && (
          <Alert>
            {error}{" "}
            <button type="button" className="font-medium underline" onClick={() => void flush()}>إعادة المحاولة</button>
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          {!sessionId && missing === 0 && (
            <Button type="button" onClick={() => { version.current++; void flush(); }} disabled={state === "saving"}>
              ✓ تأكيد: الجميع حاضر
            </Button>
          )}
          {props.previous && (
            <Button type="button" variant="secondary" className="h-10" onClick={copyPrevious}>
              نفس غياب الحصة {props.previous.period}
            </Button>
          )}
          <Button type="button" variant="secondary" className="h-10" onClick={copyNames}>
            {copied ? "تم النسخ ✓" : "نسخ الأسماء"}
          </Button>
          {missing > 0 && (
            <Button type="button" variant="secondary" className="h-10" onClick={clearAll}>مسح غياب الحصة</Button>
          )}
          {sessionId && (state === "saved" || state === "idle") && (
            <Link
              href={`/attendance/${classroomId}/sheet?date=${date}&period=${period}`}
              className="inline-flex h-10 items-center rounded-xl border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2"
            >
              🖨️ كشف الغائبين
            </Link>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="shrink-0 text-muted">المادة:</span>
          <Input value={subject} onChange={(e) => { setSubject(e.target.value); schedule(); }} maxLength={80} className="h-9" placeholder="اختياري" />
        </label>
      </Card>

      {/* roster */}
      <Card className="p-0 sm:p-0">
        <ol>
          {students.map((s, i) => {
            const st = statusOf(s.id);
            return (
              <li
                key={s.id}
                className={cx("flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 last:border-b-0", st !== "present" && TONE[st].row)}
              >
                <span className="w-6 shrink-0 text-center text-xs text-muted ltr-nums">{i + 1}</span>
                {/* full name always visible: own line on phones, inline on wider screens */}
                <span className={cx("min-w-0 basis-[calc(100%-2.5rem)] break-words sm:flex-1 sm:basis-auto", st !== "present" && "font-bold")}>
                  {s.name}
                  {s.removed && <span className="ms-1 text-xs font-normal text-muted">(محذوف من الفصل)</span>}
                </span>
                <div className="grid flex-1 grid-cols-3 gap-1 ps-8 sm:flex sm:flex-none sm:ps-0" role="group" aria-label={`حالة ${s.name}`}>
                  {(["absent", "late", "excused"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      aria-pressed={st === opt}
                      onClick={() => setStatus(s.id, opt)}
                      className={cx(
                        "h-10 rounded-lg border px-2.5 text-sm font-medium transition-colors",
                        st === opt ? TONE[opt].on : "border-border bg-surface text-muted hover:text-text",
                        "sm:min-w-16",
                      )}
                    >
                      {LABEL[opt]}
                    </button>
                  ))}
                </div>
                {st === "late" && (
                  <label className="flex w-full items-center gap-2 ps-8 text-xs text-muted">
                    دقائق التأخير:
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={600}
                      value={marks[s.id]?.minutes_late ?? ""}
                      onChange={(e) => setMinutes(s.id, e.target.value)}
                      className="h-8 w-24"
                      dir="ltr"
                    />
                  </label>
                )}
              </li>
            );
          })}
        </ol>
      </Card>
      <p className="text-xs text-muted">
        الطالب حاضر افتراضيًا. اضغط «غائب» أو «متأخر» أو «مستأذن» لتغيير حالته، واضغط مرة أخرى للإلغاء. يُحفظ كل تغيير تلقائيًا.
      </p>

      {sessionId && (
        <button
          type="button"
          className="text-xs text-muted underline hover:text-absent"
          onClick={async () => {
            if (!confirm("حذف تحضير هذه الحصة بالكامل؟")) return;
            const r = await deleteSession(sessionId);
            if (r.error) setError(r.error);
            else {
              setSessionId(null);
              setMarks({});
              setState("idle");
              router.refresh();
            }
          }}
        >
          حذف تحضير هذه الحصة
        </button>
      )}
    </div>
  );
}
