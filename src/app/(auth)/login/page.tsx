import type { Metadata } from "next";
import { LoginForm } from "./form";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  return <LoginForm next={sp.next} school={process.env.SCHOOL_NAME ?? ""} />;
}
