import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { NewClassroomForm } from "./new-classroom-form";

export const metadata: Metadata = { title: "الفصول" };

export default async function ClassroomsPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const showArchived = (await searchParams).archived === "1";
  const supabase = await createClient();
  const { data: classrooms } = await supabase
    .from("classrooms")
    .select("id, name, grade, section, archived, students(count)")
    .eq("archived", showArchived)
    .eq("students.active", true)
    .order("name");

  return (
    <>
      <PageHeader
        title={showArchived ? "الفصول المؤرشفة" : "الفصول"}
        actions={
          <>
            <ButtonLink href="/scan?kind=roster">📷 مسح كشف أسماء</ButtonLink>
            <ButtonLink href={showArchived ? "/classrooms" : "/classrooms?archived=1"} variant="ghost">
              {showArchived ? "الفصول النشطة" : "المؤرشفة"}
            </ButtonLink>
          </>
        }
      />
      {classrooms && classrooms.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {classrooms.map((c) => {
            const count = (c.students as unknown as { count: number }[])?.[0]?.count ?? 0;
            return (
              <li key={c.id}>
                <Link href={`/classrooms/${c.id}`} className="block rounded-2xl border border-border bg-surface p-4 hover:border-primary">
                  <p className="font-bold">{c.name}</p>
                  <p className="mt-1 text-sm text-muted">
                    {[c.grade, c.section].filter(Boolean).join(" · ") || "—"} · {count} طالب
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          title={showArchived ? "لا توجد فصول مؤرشفة" : "لا توجد فصول بعد"}
          body={showArchived ? undefined : "صوّر كشف الأسماء ليُنشأ الفصل تلقائيًا، أو أضف فصلًا يدويًا."}
        />
      )}
      {!showArchived && (
        <Card className="mt-6">
          <h2 className="mb-3 font-bold">إضافة فصل يدويًا</h2>
          <NewClassroomForm />
        </Card>
      )}
    </>
  );
}
