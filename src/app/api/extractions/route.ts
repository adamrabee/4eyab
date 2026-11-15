import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { EXT, MAX_UPLOAD_BYTES, prepareForModel, sniffMime } from "@/lib/ai/files";
import { aiStatus, getProvider } from "@/lib/ai";
import { ExtractionError } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const maxDuration = 180;

const HOURLY_LIMIT = 30;

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub as string | undefined;
  if (!uid) return fail(401, "يجب تسجيل الدخول");

  const status = aiStatus();
  if (!status.configured) return fail(503, "خدمة الذكاء الاصطناعي غير مهيّأة على الخادم");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "طلب غير صالح");
  }
  const kind = form.get("kind");
  const file = form.get("file");
  if (kind !== "roster" && kind !== "schedule") return fail(400, "نوع المستند غير معروف");
  if (!(file instanceof File)) return fail(400, "لم يتم إرفاق ملف");
  if (file.size === 0) return fail(400, "الملف فارغ");
  if (file.size > MAX_UPLOAD_BYTES) return fail(413, "حجم الملف أكبر من 20 ميغابايت");

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffMime(buf);
  if (!mime) return fail(415, "صيغة غير مدعومة. استخدم صورة (JPG/PNG/WEBP) أو PDF");

  const admin = createAdminClient();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin
    .from("extraction_jobs")
    .select("id", { count: "exact", head: true })
    .eq("teacher_id", uid)
    .gte("created_at", since);
  if ((count ?? 0) >= HOURLY_LIMIT) return fail(429, "تجاوزت الحد المسموح من عمليات المسح لهذه الساعة");

  // 1) store the original privately under the teacher's folder (RLS-checked)
  const path = `${uid}/${randomUUID()}.${EXT[mime]}`;
  const up = await supabase.storage.from("uploads").upload(path, buf, { contentType: mime, upsert: false });
  if (up.error) return fail(500, "تعذّر حفظ الملف");

  const { data: upload, error: upErr } = await supabase
    .from("uploads")
    .insert({ kind, storage_path: path, file_name: file.name.slice(0, 255), mime_type: mime, size_bytes: buf.length })
    .select("id")
    .single();
  if (upErr || !upload) {
    await supabase.storage.from("uploads").remove([path]);
    return fail(500, "تعذّر حفظ الملف");
  }

  // 2) job row (service role: teachers can't write AI results themselves)
  const { data: job, error: jobErr } = await admin
    .from("extraction_jobs")
    .insert({ teacher_id: uid, upload_id: upload.id, kind, provider: status.provider, status: "processing" })
    .select("id")
    .single();
  if (jobErr || !job) return fail(500, "تعذّر بدء التحليل");

  // 3) run extraction
  try {
    const prepared = await prepareForModel(buf, mime);
    const out = await getProvider().extract({ kind, data: prepared.data, mime: prepared.mime });
    await admin
      .from("extraction_jobs")
      .update({ status: "needs_review", result: out.result.data, model: out.model, provider: out.provider })
      .eq("id", job.id)
      .eq("teacher_id", uid);
    return NextResponse.json({ jobId: job.id, status: "needs_review" });
  } catch (err) {
    const message = err instanceof ExtractionError ? err.userMessage : "تعذّر تحليل الملف. جرّب صورة أوضح.";
    console.error("extraction failed", { jobId: job.id, err: err instanceof Error ? err.message : err });
    await admin.from("extraction_jobs").update({ status: "failed", error: message }).eq("id", job.id).eq("teacher_id", uid);
    return NextResponse.json({ jobId: job.id, status: "failed", error: message }, { status: 422 });
  }
}
