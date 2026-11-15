"use client";
import Link from "next/link";
import { useActionState } from "react";
import { login } from "../actions";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

export function LoginForm({ next, school }: { next?: string; school: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <Card>
      <h1 className="text-xl font-bold">تسجيل الدخول</h1>
      {school && <p className="mt-1 text-sm text-muted">{school}</p>}
      <form action={action} className="mt-4 space-y-4">
        {state?.error && <Alert>{state.error}</Alert>}
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label="اسم المستخدم" htmlFor="username">
          <Input id="username" name="username" dir="ltr" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required defaultValue={state?.fields?.username} />
        </Field>
        <Field label="كلمة المرور" htmlFor="password">
          <Input id="password" name="password" type="password" dir="ltr" autoComplete="current-password" required />
        </Field>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "جارٍ الدخول…" : "دخول"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        أول مرة؟{" "}
        <Link href="/signup" className="font-medium text-primary">
          أنشئ حسابك برمز المدرسة
        </Link>
      </p>
    </Card>
  );
}
