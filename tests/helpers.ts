import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function hasLocalStack() {
  return Boolean(url && anonKey && serviceKey && url.includes("localhost"));
}

export const admin = () =>
  createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

export async function newTeacher(name = "معلم اختبار"): Promise<{ client: SupabaseClient; id: string; email: string }> {
  const email = `t-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signUp({ email, password, options: { data: { full_name: name } } });
  if (error || !data.user) throw error ?? new Error("signup failed");
  return { client, id: data.user.id, email };
}

export async function deleteTeacher(id: string) {
  await admin().auth.admin.deleteUser(id);
}
