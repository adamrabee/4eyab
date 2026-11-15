"use client";
import Link from "next/link";
import { useActionState } from "react";
import { signup } from "../actions";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

export default function SignupPage() {
  const [state, action, pending] = useActionState(signup, undefined);
  return (
    <Card>
      <h1 className="mb-1 text-xl font-bold">إنشاء حساب معلم</h1>
      <p className="mb-4 text-sm text-muted">حساب خاص بك، بياناتك لا يراها غيرك.</p>
      <form action={action} className="space-y-4">
        {state?.error && <Alert>{state.error}</Alert>}
        <Field label="الاسم الكامل" htmlFor="full_name">
          <Input id="full_name" name="full_name" autoComplete="name" required defaultValue={state?.fields?.full_name} />
        </Field>
        <Field label="اسم المدرسة (اختياري)" htmlFor="school_name">
          <Input id="school_name" name="school_name" defaultValue={state?.fields?.school_name} />
        </Field>
        <Field label="البريد الإلكتروني" htmlFor="email">
          <Input id="email" name="email" type="email" dir="ltr" autoComplete="email" required defaultValue={state?.fields?.email} />
        </Field>
        <Field label="كلمة المرور" htmlFor="password" hint="8 أحرف على الأقل">
          <Input id="password" name="password" type="password" dir="ltr" autoComplete="new-password" minLength={8} required />
        </Field>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "جارٍ إنشاء الحساب…" : "إنشاء الحساب"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        لديك حساب؟{" "}
        <Link href="/login" className="font-medium text-primary">
          سجّل الدخول
        </Link>
      </p>
    </Card>
  );
}
