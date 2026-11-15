import type { Metadata } from "next";
import { SignupForm } from "./form";

export const metadata: Metadata = { title: "إنشاء حساب" };
// read SCHOOL_CODE / SCHOOL_NAME per request, so changing them needs no rebuild
export const dynamic = "force-dynamic";

export default function SignupPage() {
  return <SignupForm school={process.env.SCHOOL_NAME ?? ""} requireCode={Boolean(process.env.SCHOOL_CODE?.trim())} />;
}
