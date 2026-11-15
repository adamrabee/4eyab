"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert, Button, Card, cx } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

type Kind = "roster" | "schedule";
const MAX = 20 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

/**
 * Shrink big phone photos before upload (saves mobile data and time). Keeps the
 * original if it's already small, if it's a PDF, or if the browser can't decode it.
 */
async function shrinkImage(f: File): Promise<Blob> {
  if (!f.type.startsWith("image/") || f.type === "image/gif" || f.size < 1.5 * 1024 * 1024) return f;
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    return out && out.size < f.size ? out : f;
  } catch {
    return f;
  }
}

export function UploadForm({ initialKind }: { initialKind: Kind }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function pick(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (f.size > MAX) return setError("حجم الملف أكبر من 20 ميغابايت");
    if (!ACCEPT.split(",").includes(f.type)) return setError("صيغة غير مدعومة. استخدم صورة JPG/PNG أو PDF");
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getClaims();
      const uid = data?.claims?.sub;
      if (!uid) {
        setError("انتهت الجلسة. سجّل الدخول من جديد.");
        setBusy(false);
        return;
      }
      // 1) upload straight to the teacher's private folder in Supabase Storage
      const blob = await shrinkImage(file);
      const type = blob.type || file.type;
      const path = `${uid}/${crypto.randomUUID()}.${EXT[type] ?? "bin"}`;
      const up = await supabase.storage.from("uploads").upload(path, blob, { contentType: type, upsert: false });
      if (up.error) {
        setError("تعذّر رفع الملف. تحقق من الاتصال وحاول مرة أخرى.");
        setBusy(false);
        return;
      }
      // 2) ask the server to analyse it
      const res = await fetch("/api/extractions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, path, fileName: file.name }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.jobId) {
        router.push(`/scan/${json.jobId}`);
        return;
      }
      setError(json.error ?? "تعذّر تحليل الملف");
    } catch {
      setError("انقطع الاتصال. تحقق من الإنترنت وحاول مرة أخرى.");
    }
    setBusy(false);
  }

  const kinds: { k: Kind; t: string; d: string }[] = [
    { k: "roster", t: "كشف أسماء الطلاب", d: "يُنشئ الفصل ويضيف الطلاب" },
    { k: "schedule", t: "الجدول الأسبوعي", d: "يُنشئ حصصك لكل يوم" },
  ];

  return (
    <Card className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">ماذا تريد أن تمسح؟</legend>
        <div className="grid grid-cols-2 gap-2">
          {kinds.map((o) => (
            <label
              key={o.k}
              className={cx(
                "cursor-pointer rounded-xl border p-3 transition-colors",
                kind === o.k ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-2",
              )}
            >
              <input type="radio" name="kind" className="sr-only" checked={kind === o.k} onChange={() => setKind(o.k)} />
              <span className="block font-medium">{o.t}</span>
              <span className="block text-xs text-muted">{o.d}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />

      {file ? (
        <div className="rounded-xl border border-border p-3">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="معاينة الملف" className="mx-auto max-h-72 rounded-lg object-contain" />
          ) : (
            <p className="py-6 text-center text-sm">📄 {file.name}</p>
          )}
          <div className="mt-3 flex justify-center gap-2">
            <Button variant="ghost" type="button" onClick={() => { setFile(null); setPreview(null); }} disabled={busy}>
              تغيير الملف
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="button" className="h-14" onClick={() => cameraRef.current?.click()}>
            📷 التقط صورة
          </Button>
          <Button type="button" variant="secondary" className="h-14" onClick={() => fileRef.current?.click()}>
            اختر صورة أو PDF
          </Button>
        </div>
      )}

      <p className="text-xs text-muted">نصيحة: صوّر الورقة كاملة في إضاءة جيدة ومن الأعلى مباشرة.</p>

      {error && <Alert>{error}</Alert>}

      <Button type="button" className="w-full" disabled={!file || busy} onClick={submit}>
        {busy ? "جارٍ التحليل… قد يستغرق ذلك دقيقة" : "حلّل المستند"}
      </Button>
    </Card>
  );
}
