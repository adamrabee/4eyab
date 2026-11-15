"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const items = [
  { href: "/dashboard", label: "الرئيسية", icon: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/attendance", label: "التحضير", icon: "M9 11l3 3 8-8M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11" },
  { href: "/classrooms", label: "الفصول", icon: "M16 11a4 4 0 1 0-8 0M4 20a8 8 0 0 1 16 0M12 7a3 3 0 1 0 0-6" },
  { href: "/scan", label: "المسح الذكي", icon: "M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 12h8" },
  { href: "/schedule", label: "الجدول", icon: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4" },
  { href: "/reports", label: "التقارير", icon: "M5 20V10M12 20V4M19 20v-7" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function SideNav() {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="التنقل الرئيسي">
      {items.map((it) => {
        const active = path === it.href || path.startsWith(`${it.href}/`);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex items-center gap-3 rounded-xl px-3 h-11 text-sm font-medium",
              active ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            <Icon d={it.icon} />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="التنقل الرئيسي"
      className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-border bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {items.map((it) => {
        const active = path === it.href || path.startsWith(`${it.href}/`);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cx("flex flex-col items-center gap-0.5 py-2 text-[10px] sm:text-[11px]", active ? "text-primary" : "text-muted")}
          >
            <Icon d={it.icon} />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
