"use client";
import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { createClassroom } from "./actions";

export function NewClassroomForm() {
  const [state, action, pending] = useActionState(createClassroom, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4 sm:items-end">
      <Field label="اسم الفصل" htmlFor="name">
        <Input id="name" name="name" required placeholder="ثاني متوسط ١" />
      </Field>
      <Field label="الصف" htmlFor="grade">
        <Input id="grade" name="grade" />
      </Field>
      <Field label="الشعبة" htmlFor="section">
        <Input id="section" name="section" />
      </Field>
      <Button type="submit" disabled={pending}>{pending ? "…" : "إضافة"}</Button>
      {state?.error && <div className="sm:col-span-4"><Alert>{state.error}</Alert></div>}
    </form>
  );
}
