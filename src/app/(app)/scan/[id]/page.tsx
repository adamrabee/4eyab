import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Alert, ButtonLink, PageHeader } from "@/components/ui";
import type { RosterExtraction, ScheduleExtraction } from "@/lib/ai/schemas";
import { RosterReview } from "./roster-review";
import { ScheduleReview } from "./schedule-review";

export const metadata: Metadata = { title: "مراجعة نتيجة المسح" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("extraction_jobs")
    .select("id, kind, status, provider, result, error, classroom_id, upload:uploads(storage_path, mime_type)")
    .eq("id", id)
    .single();
  if (!job) notFound();

  const upload = Array.isArray(job.upload) ? job.upload[0] : job.upload;
  let fileUrl: string | null = null;
  if (upload) {
    const { data } = await supabase.storage.from("uploads").createSignedUrl(upload.storage_path, 600);
    fileUrl = data?.signedUrl ?? null;
  }
  const isPdf = upload?.mime_type === "application/pdf";
  const title = job.kind === "roster" ? "مراجعة كشف الأسماء" : "مراجعة الجدول الأسبوعي";

  if (job.status !== "needs_review") {
    const msg: Record<string, React.ReactNode> = {
      approved: <Alert tone="success">تم اعتماد هذا المسح وحفظ بياناته.</Alert>,
      rejected: <Alert tone="info">تم رفض هذا المسح ولم تُحفظ بياناته.</Alert>,
      failed: <Alert>{job.error ?? "فشل التحليل."}</Alert>,
      processing: <Alert tone="info">ما زال التحليل جاريًا… حدّث الصفحة بعد قليل.</Alert>,
    };
    return (
      <>
        <PageHeader title={title} />
        <div className="space-y-4">
          {msg[job.status]}
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/scan?kind=${job.kind}`}>مسح جديد</ButtonLink>
            {job.status === "approved" && job.kind === "roster" && job.classroom_id && (
              <ButtonLink href={`/classrooms/${job.classroom_id}`} variant="secondary">عرض الفصل</ButtonLink>
            )}
            {job.status === "approved" && job.kind === "schedule" && (
              <ButtonLink href="/schedule" variant="secondary">عرض الجدول</ButtonLink>
            )}
          </div>
        </div>
      </>
    );
  }

  const { data: classrooms } = await supabase
    .from("classrooms")
    .select("id, name")
    .eq("archived", false)
    .order("name");

  return (
    <>
      <PageHeader title={title} subtitle="تحقّق من البيانات وصحّح أي خطأ قبل الاعتماد. لن يُحفظ شيء حتى تضغط «اعتماد»." />
      {job.provider === "mock" && (
        <div className="mb-4">
          <Alert tone="warning">
            <strong>بيانات تجريبية</strong> — لم يقرأ الذكاء الاصطناعي ملفك لأن الخدمة غير مفعّلة. هذه أسماء وهمية لاختبار الخطوات فقط.
          </Alert>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <details className="rounded-2xl border border-border bg-surface p-3 lg:sticky lg:top-4 lg:self-start">
          <summary className="cursor-pointer text-sm font-medium">عرض الملف الأصلي للمقارنة</summary>
          {fileUrl ? (
            isPdf ? (
              <a href={fileUrl} target="_blank" rel="noreferrer" className="mt-3 block text-sm text-primary underline">
                فتح ملف PDF
              </a>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl} alt="الملف الأصلي" className="mt-3 max-h-[70vh] w-full rounded-lg object-contain" />
            )
          ) : (
            <p className="mt-3 text-sm text-muted">تعذّر عرض الملف.</p>
          )}
        </details>
        {job.kind === "roster" ? (
          <RosterReview jobId={job.id} data={job.result as RosterExtraction} classrooms={classrooms ?? []} />
        ) : (
          <ScheduleReview jobId={job.id} data={job.result as ScheduleExtraction} classrooms={classrooms ?? []} />
        )}
      </div>
    </>
  );
}
