"use client";
import { useActionState, useState, useTransition } from "react";
import { Alert, Button, Card, Field, Input, Textarea } from "@/components/ui";
import {
  addStudent,
  deleteClassroom,
  moveStudent,
  setClassroomArchived,
  setStudentActive,
  updateClassroom,
  updateStudent,
} from "../actions";

type Student = { id: string; full_name: string; student_number: string; guardian_phone: string; notes: string };

export function StudentRow({ student: s, index, classroomId, isFirst, isLast }: { student: Student; index: number; classroomId: string; isFirst: boolean; isLast: boolean }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [state, action, saving] = useActionState(updateStudent.bind(null, s.id, classroomId), undefined);

  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="w-7 shrink-0 text-center text-xs text-muted ltr-nums">{index + 1}</span>
        <button type="button" onClick={() => setEditing((e) => !e)} className="min-w-0 flex-1 truncate py-2 text-start font-medium">
          {s.full_name}
          {s.student_number && <span className="ms-2 text-xs font-normal text-muted ltr-nums">{s.student_number}</span>}
        </button>
        <div className="flex shrink-0 items-center">
          <button type="button" aria-label="تحريك لأعلى" disabled={isFirst || pending} onClick={() => start(() => moveStudent(s.id, classroomId, "up"))} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 disabled:opacity-30">▲</button>
          <button type="button" aria-label="تحريك لأسفل" disabled={isLast || pending} onClick={() => start(() => moveStudent(s.id, classroomId, "down"))} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 disabled:opacity-30">▼</button>
        </div>
      </div>
      {editing && (
        <form action={action} className="mt-2 grid gap-3 rounded-xl bg-surface-2 p-3 sm:grid-cols-2">
          <Field label="الاسم" htmlFor={`n-${s.id}`}><Input id={`n-${s.id}`} name="full_name" defaultValue={s.full_name} required /></Field>
          <Field label="رقم الطالب" htmlFor={`sn-${s.id}`}><Input id={`sn-${s.id}`} name="student_number" defaultValue={s.student_number} dir="ltr" /></Field>
          <Field label="جوال ولي الأمر" htmlFor={`p-${s.id}`}><Input id={`p-${s.id}`} name="guardian_phone" type="tel" defaultValue={s.guardian_phone} dir="ltr" /></Field>
          <Field label="ملاحظات" htmlFor={`no-${s.id}`}><Textarea id={`no-${s.id}`} name="notes" defaultValue={s.notes} rows={1} /></Field>
          {state?.error && <div className="sm:col-span-2"><Alert>{state.error}</Alert></div>}
          {state?.ok && <div className="sm:col-span-2"><Alert tone="success">{state.ok}</Alert></div>}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" disabled={saving}>حفظ</Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>إغلاق</Button>
            <Button
              type="button"
              variant="ghost"
              className="ms-auto text-absent"
              disabled={pending}
              onClick={() => {
                if (confirm(`حذف ${s.full_name} من الفصل؟ يبقى سجل حضوره محفوظًا ويمكن استعادته.`)) start(() => setStudentActive(s.id, classroomId, false));
              }}
            >
              حذف من الفصل
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

export function InactiveStudentRow({ student: s, classroomId }: { student: Student; classroomId: string }) {
  const [pending, start] = useTransition();
  return (
    <li className="flex items-center justify-between px-4 py-2 text-sm">
      <span className="text-muted">{s.full_name}</span>
      <Button variant="ghost" className="h-9" disabled={pending} onClick={() => start(() => setStudentActive(s.id, classroomId, true))}>
        استعادة
      </Button>
    </li>
  );
}

export function AddStudentForm({ classroomId }: { classroomId: string }) {
  const [state, action, pending] = useActionState(addStudent.bind(null, classroomId), undefined);
  return (
    <form
      action={action}
      key={state?.ok ?? "form"}
      className="flex flex-wrap items-end gap-2"
    >
      <div className="min-w-48 flex-1">
        <Field label="إضافة طالب" htmlFor="new-student"><Input id="new-student" name="full_name" placeholder="الاسم الكامل" required /></Field>
      </div>
      <div className="w-32">
        <Field label="الرقم (اختياري)" htmlFor="new-student-no"><Input id="new-student-no" name="student_number" dir="ltr" /></Field>
      </div>
      <Button type="submit" disabled={pending}>إضافة</Button>
      {state?.error && <div className="w-full"><Alert>{state.error}</Alert></div>}
      {state?.ok && <div className="w-full"><Alert tone="success">{state.ok}</Alert></div>}
    </form>
  );
}

export function ClassroomSettings({ classroom: c }: { classroom: { id: string; name: string; grade: string; section: string; academic_year: string; archived: boolean } }) {
  const [state, action, saving] = useActionState(updateClassroom.bind(null, c.id), undefined);
  const [pending, start] = useTransition();
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm font-medium text-muted">إعدادات الفصل</summary>
      <Card className="mt-3 space-y-4">
        <form action={action} className="grid gap-3 sm:grid-cols-2">
          <Field label="اسم الفصل" htmlFor="cs-name"><Input id="cs-name" name="name" defaultValue={c.name} required /></Field>
          <Field label="الصف" htmlFor="cs-grade"><Input id="cs-grade" name="grade" defaultValue={c.grade} /></Field>
          <Field label="الشعبة" htmlFor="cs-section"><Input id="cs-section" name="section" defaultValue={c.section} /></Field>
          <Field label="العام الدراسي" htmlFor="cs-year"><Input id="cs-year" name="academic_year" defaultValue={c.academic_year} placeholder="1448" /></Field>
          {state?.error && <div className="sm:col-span-2"><Alert>{state.error}</Alert></div>}
          {state?.ok && <div className="sm:col-span-2"><Alert tone="success">{state.ok}</Alert></div>}
          <div className="sm:col-span-2"><Button type="submit" disabled={saving}>حفظ التعديلات</Button></div>
        </form>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="secondary" disabled={pending} onClick={() => start(() => setClassroomArchived(c.id, !c.archived))}>
            {c.archived ? "إلغاء الأرشفة" : "أرشفة الفصل"}
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              const typed = prompt(`سيُحذف الفصل وجميع طلابه وسجلات حضوره نهائيًا. للتأكيد اكتب اسم الفصل:\n${c.name}`);
              if (typed?.trim() === c.name.trim()) start(() => deleteClassroom(c.id));
            }}
          >
            حذف الفصل نهائيًا
          </Button>
        </div>
      </Card>
    </details>
  );
}
