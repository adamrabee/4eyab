"use client";
import Link from "next/link";
import { useActionState } from "react";
import { login } from "../actions";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

export function LoginForm({ next, confirm, confirmError }: { next?: string; confirm?: boolean; confirmError?: boolean }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <Card>
      <h1 className="mb-4 text-xl font-bold">تسجيل الدخول</h1>
      <form action={action} className="space-y-4">
        {confirm && <Alert tone="info">أرسلنا رابط تأكيد إلى بريدك. أكّد حسابك ثم سجّل الدخول.</Alert>}
        {confirmError && <Alert>رابط التأكيد غير صالح أو منتهي الصلاحية. سجّل الدخول، أو أنشئ الحساب من جديد لإرسال رابط جديد.</Alert>}
        {state?.error && <Alert>{state.error}</Alert>}
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label="البريد الإلكتروني" htmlFor="email">
          <Input id="email" name="email" type="email" dir="ltr" autoComplete="email" required defaultValue={state?.fields?.email} />
        </Field>
        <Field label="كلمة المرور" htmlFor="password">
          <Input id="password" name="password" type="password" dir="ltr" autoComplete="current-password" required />
        </Field>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "جارٍ الدخول…" : "دخول"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        ليس لديك حساب؟{" "}
        <Link href="/signup" className="font-medium text-primary">
          أنشئ حسابًا
        </Link>
      </p>
    </Card>
  );
}
