import type { Metadata } from "next";
import { LoginForm } from "./form";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; confirm?: string; confirm_error?: string }> }) {
  const sp = await searchParams;
  return <LoginForm next={sp.next} confirm={sp.confirm === "1"} confirmError={sp.confirm_error === "1"} />;
}
