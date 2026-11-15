import type { Metadata } from "next";
import { SignupForm } from "./form";

export const metadata: Metadata = { title: "إنشاء حساب" };

export default function SignupPage() {
  return <SignupForm school={process.env.SCHOOL_NAME ?? ""} enabled={Boolean(process.env.SCHOOL_CODE?.trim())} />;
}
