import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { aiStatus } from "@/lib/ai";
import { Alert, Card, PageHeader } from "@/components/ui";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "المسح الذكي" };

const STATUS: Record<string, { label: string; cls: string }> = {
  processing: { label: "قيد التحليل", cls: "bg-surface-2 text-muted" },
  needs_review: { label: "بانتظار المراجعة", cls: "bg-late-soft text-late" },
  approved: { label: "معتمد", cls: "bg-present-soft text-present" },
  rejected: { label: "مرفوض", cls: "bg-surface-2 text-muted" },
  failed: { label: "فشل", cls: "bg-absent-soft text-absent" },
};

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  const supabase = await createClient();
  const { data: jobs } = await supabase
    .from("extraction_jobs")
    .select("id, kind, status, created_at, provider")
    .order("created_at", { ascending: false })
    .limit(10);
  const ai = aiStatus();

  return (
    <>
      <PageHeader title="المسح الذكي" subtitle="صوّر كشف الأسماء أو الجدول، وراجع النتيجة قبل الحفظ." />
      {ai.provider === "mock" && (
        <div className="mb-4">
          <Alert tone="warning">
            وضع التجربة: خدمة الذكاء الاصطناعي غير مفعّلة بعد، لذلك ستظهر بيانات تجريبية بدل محتوى الملف.
          </Alert>
        </div>
      )}
      <UploadForm initialKind={kind === "schedule" ? "schedule" : "roster"} />

      {jobs && jobs.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-bold">آخر عمليات المسح</h2>
          <Card className="divide-y divide-border p-0 sm:p-0">
            {jobs.map((j) => {
              const st = STATUS[j.status] ?? STATUS.processing;
              return (
                <Link key={j.id} href={`/scan/${j.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
                  <span>
                    <span className="font-medium">{j.kind === "roster" ? "كشف أسماء" : "جدول أسبوعي"}</span>
                    <span className="ms-2 text-xs text-muted ltr-nums">
                      {new Date(j.created_at).toLocaleString("ar-SA-u-ca-gregory-nu-latn", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Riyadh" })}
                    </span>
                    {j.provider === "mock" && <span className="ms-2 text-xs text-late">(تجريبي)</span>}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${st.cls}`}>{st.label}</span>
                </Link>
              );
            })}
          </Card>
        </section>
      )}
    </>
  );
}
