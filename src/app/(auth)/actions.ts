"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; fields?: Record<string, string> } | undefined;

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("البريد الإلكتروني غير صحيح"),
  password: z.string().min(1, "أدخل كلمة المرور"),
  next: z.string().optional(),
});

const signupSchema = z.object({
  full_name: z.string().trim().min(2, "أدخل اسمك الكامل").max(120),
  school_name: z.string().trim().max(160).optional().default(""),
  email: z.string().trim().toLowerCase().email("البريد الإلكتروني غير صحيح"),
  password: z.string().min(8, "كلمة المرور 8 أحرف على الأقل").max(72),
});

/** Public base URL of the site, used in email links. Prefer the configured value. */
async function siteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Only allow same-site relative redirects. */
function safeNext(next?: string) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export async function login(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fields: { email: String(form.get("email") ?? "") } };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) {
    return { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة", fields: { email: parsed.data.email } };
  }
  redirect(safeNext(parsed.data.next));
}

export async function signup(_: AuthState, form: FormData): Promise<AuthState> {
  const raw = Object.fromEntries(form) as Record<string, string>;
  const parsed = signupSchema.safeParse(raw);
  const fields = { full_name: raw.full_name ?? "", school_name: raw.school_name ?? "", email: raw.email ?? "" };
  if (!parsed.success) return { error: parsed.error.issues[0].message, fields };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.full_name, school_name: parsed.data.school_name },
      emailRedirectTo: `${await siteUrl()}/auth/confirm?next=/dashboard`,
    },
  });
  if (error) {
    const msg = /registered|exists/i.test(error.message) ? "هذا البريد مسجّل مسبقًا" : "تعذّر إنشاء الحساب، حاول مرة أخرى";
    return { error: msg, fields };
  }
  if (!data.session) {
    // Email confirmation is enabled on this Supabase project.
    redirect("/login?confirm=1");
  }
  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
