import { NextResponse } from "next/server";
import { z } from "zod";
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

/**
 * The browser uploads the file straight to Supabase Storage (into the teacher's
 * own folder, enforced by storage RLS) and then sends us only its path. This
 * keeps large phone photos out of the request body, which hosting platforms
 * such as Vercel cap at a few MB.
 */
const Body = z.object({
  kind: z.enum(["roster", "schedule"]),
  path: z.string().max(200),
  fileName: z.string().max(255).default(""),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub as string | undefined;
  if (!uid) return fail(401, "يجب تسجيل الدخول");

  const status = aiStatus();
  if (!status.configured) return fail(503, "خدمة الذكاء الاصطناعي غير مهيّأة على الخادم");

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "طلب غير صالح");
  const { kind, path, fileName } = parsed.data;

  // the object must be a fresh upload in the caller's own folder
  const m = path.match(/^([0-9a-f-]{36})\/[0-9a-f-]{36}\.(jpg|png|webp|gif|pdf)$/i);
  if (!m || m[1] !== uid) return fail(400, "مسار الملف غير صالح");

  const admin = createAdminClient();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin
    .from("extraction_jobs")
    .select("id", { count: "exact", head: true })
    .eq("teacher_id", uid)
    .gte("created_at", since);
  if ((count ?? 0) >= HOURLY_LIMIT) {
    await supabase.storage.from("uploads").remove([path]);
    return fail(429, "تجاوزت الحد المسموح من عمليات المسح لهذه الساعة");
  }

  // 1) read the uploaded object back (as the teacher, so storage RLS applies)
  const dl = await supabase.storage.from("uploads").download(path);
  if (dl.error || !dl.data) return fail(404, "لم يتم العثور على الملف المرفوع");
  const buf = Buffer.from(await dl.data.arrayBuffer());
  const reject = async (status: number, msg: string) => {
    await supabase.storage.from("uploads").remove([path]);
    return fail(status, msg);
  };
  if (buf.length === 0) return reject(400, "الملف فارغ");
  if (buf.length > MAX_UPLOAD_BYTES) return reject(413, "حجم الملف أكبر من 20 ميغابايت");
  const mime = sniffMime(buf);
  if (!mime || EXT[mime] !== m[2].toLowerCase()) return reject(415, "صيغة غير مدعومة. استخدم صورة (JPG/PNG/WEBP) أو PDF");

  // storage_path is unique, so the same object can't be submitted twice
  const { data: upload, error: upErr } = await supabase
    .from("uploads")
    .insert({ kind, storage_path: path, file_name: fileName.slice(0, 255), mime_type: mime, size_bytes: buf.length })
    .select("id")
    .single();
  if (upErr || !upload) {
    console.error("upload: uploads row insert failed", { uid, code: upErr?.code, message: upErr?.message });
    if (upErr?.code === "23505") return fail(409, "تمت معالجة هذا الملف مسبقًا");
    return reject(500, "تعذّر حفظ الملف");
  }

  // 2) job row (service role: teachers can't write AI results themselves)
  const { data: job, error: jobErr } = await admin
    .from("extraction_jobs")
    .insert({ teacher_id: uid, upload_id: upload.id, kind, provider: status.provider, status: "processing" })
    .select("id")
    .single();
  if (jobErr || !job) {
    console.error("upload: job insert failed", { uid, code: jobErr?.code, message: jobErr?.message });
    return fail(500, "تعذّر بدء التحليل");
  }

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
