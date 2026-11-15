"use client";
import Link from "next/link";
import { useActionState } from "react";
import { signup } from "../actions";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

export function SignupForm({ school, enabled }: { school: string; enabled: boolean }) {
  const [state, action, pending] = useActionState(signup, undefined);
  return (
    <Card>
      <h1 className="text-xl font-bold">إنشاء حساب معلم</h1>
      <p className="mt-1 text-sm text-muted">{school ? `خاص بمعلمي ${school}.` : "خاص بمعلمي المدرسة."} تحتاج رمز المدرسة من الإدارة أو زملائك.</p>
      {!enabled ? (
        <div className="mt-4"><Alert tone="info">التسجيل غير مفعّل بعد على هذا الموقع.</Alert></div>
      ) : (
        <form action={action} className="mt-4 space-y-4">
          {state?.error && <Alert>{state.error}</Alert>}
          <Field label="اسمك الكامل" htmlFor="full_name">
            <Input id="full_name" name="full_name" autoComplete="name" required defaultValue={state?.fields?.full_name} />
          </Field>
          <Field label="اسم المستخدم" htmlFor="username" hint="بالإنجليزية أو أرقام، مثل: noura أو رقم جوالك. ستدخل به كل مرة.">
            <Input id="username" name="username" dir="ltr" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required defaultValue={state?.fields?.username} />
          </Field>
          <Field label="كلمة المرور" htmlFor="password" hint="8 أحرف أو أرقام على الأقل. احفظها جيدًا.">
            <Input id="password" name="password" type="password" dir="ltr" autoComplete="new-password" minLength={8} required />
          </Field>
          <Field label="رمز المدرسة" htmlFor="school_code">
            <Input id="school_code" name="school_code" dir="ltr" autoComplete="off" autoCapitalize="none" required defaultValue={state?.fields?.school_code} />
          </Field>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "جارٍ إنشاء الحساب…" : "إنشاء الحساب والدخول"}
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-muted">
        لديك حساب؟{" "}
        <Link href="/login" className="font-medium text-primary">سجّل الدخول</Link>
      </p>
    </Card>
  );
}
