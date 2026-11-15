import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "../(auth)/actions";
import { BottomNav, SideNav } from "./nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("full_name, school_name").single();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="no-print sticky top-0 hidden h-dvh flex-col border-e border-border bg-surface p-4 lg:flex">
        <Link href="/dashboard" className="mb-6 px-2">
          <span className="text-2xl font-bold text-primary">حصتي</span>
        </Link>
        <SideNav />
        <div className="mt-auto border-t border-border pt-4 px-2">
          <p className="truncate text-sm font-medium">{profile?.full_name || "معلم"}</p>
          {profile?.school_name && <p className="truncate text-xs text-muted">{profile.school_name}</p>}
          <form action={logout} className="mt-3">
            <button className="text-sm text-muted hover:text-absent">تسجيل الخروج</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-surface/95 px-4 backdrop-blur lg:hidden">
          <Link href="/dashboard" className="text-xl font-bold text-primary">
            حصتي
          </Link>
          <form action={logout}>
            <button className="text-sm text-muted">خروج</button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-5 sm:px-6 lg:pb-10">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
