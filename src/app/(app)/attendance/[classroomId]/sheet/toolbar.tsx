"use client";
import { useState } from "react";
import { Alert, Button, ButtonLink } from "@/components/ui";

export type SheetData = {
  school: string;
  classroom: string;
  grade: string;
  day: string;
  hijri: string;
  gregorian: string;
  period: number;
  subject: string;
  teacher: string;
  absent: { name: string; minutes: number | null }[];
  late: { name: string; minutes: number | null }[];
  excused: { name: string; minutes: number | null }[];
  total: number;
  fileName: string;
};

/**
 * Draws the A4 sheet on a canvas (ported from the original single-page tool).
 * Rendering text through the browser keeps Arabic letters correctly joined,
 * which most PDF libraries can't do on their own.
 */
function drawSheet(d: SheetData): HTMLCanvasElement {
  const W = 1240, H = 1754, M = 90; // A4 @150dpi
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;
  const F = '"IBM Plex Sans Arabic", Tahoma, sans-serif';
  c.fillStyle = "#fff";
  c.fillRect(0, 0, W, H);
  c.fillStyle = "#111";
  c.strokeStyle = "#555";
  c.lineWidth = 2;
  c.direction = "rtl";
  c.textBaseline = "middle";
  const text = (t: string, x: number, y: number, size: number, bold = false, align: CanvasTextAlign = "center") => {
    c.font = `${bold ? 700 : 400} ${size}px ${F}`;
    c.textAlign = align;
    c.fillText(t, x, y);
  };
  const cell = (x: number, y: number, w: number, h: number, t?: string, bold = false, align: "center" | "right" = "center", size = 28) => {
    c.strokeRect(x, y, w, h);
    if (t === undefined) return;
    if (align === "right") text(t, x + w - 20, y + h / 2, size, bold, "right");
    else text(t, x + w / 2, y + h / 2, size, bold, "center");
  };
  const R = W - M, TW = W - 2 * M;
  let y = M;
  if (d.school) { text(d.school, W / 2, y, 26); y += 44; }
  text("كشف الطلاب الغائبين", W / 2, y, 50, true); y += 60;
  text(d.classroom + (d.grade ? ` — ${d.grade}` : ""), W / 2, y, 30); y += 60;

  const rh = 70, w1 = TW * 0.16, w2 = TW * 0.34;
  const infoRow = (a: string, b: string, c2: string, e: string) => {
    let x = R;
    cell(x - w1, y, w1, rh, a, true); x -= w1;
    cell(x - w2, y, w2, rh, b); x -= w2;
    cell(x - w1, y, w1, rh, c2, true); x -= w1;
    cell(x - w2, y, w2, rh, e, false, "center", 24);
    y += rh;
  };
  infoRow("اليوم", d.day, "التاريخ", `${d.hijri}`);
  infoRow("الحصة", String(d.period), "المادة", d.subject || "—");
  y += 40;

  const sections: { title: string; rows: string[]; empty?: string }[] = [
    { title: "اسم الطالب الغائب", rows: d.absent.map((a) => a.name), empty: "لا يوجد غياب في هذه الحصة" },
  ];
  if (d.late.length) sections.push({ title: "الطلاب المتأخرون", rows: d.late.map((a) => (a.minutes ? `${a.name} (${a.minutes} د)` : a.name)) });
  if (d.excused.length) sections.push({ title: "الطلاب المستأذنون", rows: d.excused.map((a) => a.name) });

  // fit all rows on one page: shrink row height if needed
  const totalRows = sections.reduce((n, s) => n + 1 + Math.max(1, s.rows.length), 0);
  const room = H - y - 260 - (sections.length - 1) * 30 - 60;
  const lh = Math.max(34, Math.min(62, Math.floor(room / totalRows)));
  const fs = lh < 44 ? 22 : 28;
  const nw = 90;

  sections.forEach((s, si) => {
    if (si > 0) y += 30;
    cell(R - nw, y, nw, lh, "م", true, "center", fs);
    cell(M, y, TW - nw, lh, s.title, true, "center", fs);
    y += lh;
    if (!s.rows.length) { cell(M, y, TW, lh, s.empty ?? "—", false, "center", fs); y += lh; }
    s.rows.forEach((name, n) => {
      cell(R - nw, y, nw, lh, String(n + 1), false, "center", fs);
      cell(M, y, TW - nw, lh, name, false, "right", fs);
      y += lh;
    });
    if (si === 0) { y += 40; text(`عدد الغائبين: ${d.absent.length} من ${d.total}`, R, y, 30, true, "right"); y += 20; }
  });
  y = Math.min(y + 110, H - 80);
  if (d.teacher) text(d.teacher, R, y, 34, true, "right");
  text("التوقيع: ____________________", M, y, 30, false, "left");
  return cv;
}

export function SheetToolbar({ data, back }: { data: SheetData; back: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadPdf() {
    setBusy(true);
    setError(null);
    try {
      await document.fonts.ready;
      const canvas = drawSheet(data);
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 210, 297);
      pdf.save(`${data.fileName}.pdf`);
    } catch {
      setError("تعذّر إنشاء ملف PDF. استخدم «طباعة» ثم اختر «حفظ كـ PDF».");
    }
    setBusy(false);
  }

  return (
    <div className="no-print mb-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={downloadPdf} disabled={busy}>{busy ? "جارٍ التحميل…" : "تحميل PDF"}</Button>
        <Button variant="secondary" onClick={() => window.print()}>طباعة</Button>
        <ButtonLink href={back} variant="ghost">رجوع</ButtonLink>
      </div>
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
