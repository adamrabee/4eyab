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

/** Create a teacher the way the app does (admin API + school membership marker), then sign in. */
export async function newTeacher(name = "معلم اختبار"): Promise<{ client: SupabaseClient; id: string; email: string }> {
  const email = `t-${randomUUID()}@hissati.invalid`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { hissati_member: true },
    user_metadata: { full_name: name },
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { client, id: data.user.id, email };
}

export async function deleteTeacher(id: string) {
  await admin().auth.admin.deleteUser(id);
}
