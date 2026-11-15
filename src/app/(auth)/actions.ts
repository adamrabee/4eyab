"use server";
import { createHash, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidUsername, normalizeUsername, usernameToEmail } from "@/lib/auth/username";

export type AuthState = { error?: string; fields?: Record<string, string> } | undefined;

const loginSchema = z.object({
  username: z.string().transform(normalizeUsername).refine(isValidUsername, "اسم المستخدم غير صحيح"),
  password: z.string().min(1, "أدخل كلمة المرور"),
  next: z.string().optional(),
});

const signupSchema = z.object({
  full_name: z.string().trim().min(2, "أدخل اسمك الكامل").max(120),
  username: z
    .string()
    .transform(normalizeUsername)
    .refine(isValidUsername, "اسم المستخدم: 3 أحرف أو أكثر، بالإنجليزية أو أرقام فقط (مثل noura أو رقم جوالك)"),
  password: z.string().min(8, "كلمة المرور 8 أحرف أو أرقام على الأقل").max(72),
  school_code: z.string().trim().optional().default(""),
});

/** Only allow same-site relative redirects. */
function safeNext(next?: string) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

/** Optional: when SCHOOL_CODE is set, sign-up requires it. Unset = open sign-up. */
function schoolCodeRequired(): boolean {
  return Boolean(process.env.SCHOOL_CODE?.trim());
}

/** Constant-time comparison of the school code (server-only env var). */
function schoolCodeMatches(input: string): boolean {
  const expected = process.env.SCHOOL_CODE?.trim();
  if (!expected) return true;
  const a = createHash("sha256").update(input.trim()).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function login(_: AuthState, form: FormData): Promise<AuthState> {
  const raw = Object.fromEntries(form) as Record<string, string>;
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { error: "اسم المستخدم أو كلمة المرور غير صحيحة", fields: { username: raw.username ?? "" } };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(parsed.data.username),
    password: parsed.data.password,
  });
  if (error) return { error: "اسم المستخدم أو كلمة المرور غير صحيحة", fields: { username: parsed.data.username } };
  redirect(safeNext(parsed.data.next));
}

export async function signup(_: AuthState, form: FormData): Promise<AuthState> {
  const raw = Object.fromEntries(form) as Record<string, string>;
  // keep what the teacher typed (except the password) so an error doesn't wipe the form
  const fields = { full_name: raw.full_name ?? "", username: raw.username ?? "", school_code: raw.school_code ?? "" };
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message, fields };
  const { full_name, username, password, school_code } = parsed.data;

  if (schoolCodeRequired() && !schoolCodeMatches(school_code)) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return { error: "رمز المدرسة غير صحيح", fields: { ...fields, school_code: "" } };
  }

  // Create the account server-side: no email is sent, and the membership marker
  // lets it past the database guard that blocks sign-ups made outside the app.
  const admin = createAdminClient();
  const { error: createErr } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
    app_metadata: { hissati_member: true },
    user_metadata: { full_name, username, school_name: process.env.SCHOOL_NAME ?? "" },
  });
  if (createErr) {
    const taken = /already|exists|registered/i.test(createErr.message) || createErr.status === 422;
    if (!taken) console.error("signup: createUser failed", { status: createErr.status, message: createErr.message });
    return { error: taken ? "اسم المستخدم محجوز، اختر اسمًا آخر" : "تعذّر إنشاء الحساب، حاول مرة أخرى", fields };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
  if (error) redirect("/login");
  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
