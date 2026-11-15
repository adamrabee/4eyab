import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { formatShortDate, isISODate } from "@/lib/dates";
import { STATUS_AR } from "@/lib/reports/range";

export const runtime = "nodejs";

type Summary = { student_id: string; full_name: string; student_number: string; present: number; absent: number; late: number; excused: number; total: number; attendance_rate: number | null };

const SHORT: Record<string, string> = { present: "✓", absent: "غ", late: "ت", excused: "س" };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const classroomId = url.searchParams.get("classroom") ?? "";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(classroomId) || !isISODate(from) || !isISODate(to)) {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });

  const [{ data: classroom }, { data: summary }, { data: sessions }, { data: profile }] = await Promise.all([
    supabase.from("classrooms").select("name").eq("id", classroomId).single(),
    supabase.rpc("attendance_summary", { p_classroom_id: classroomId, p_from: from, p_to: to }),
    supabase
      .from("attendance_sessions")
      .select("session_date, period_number, subject, attendance_records(student_id, status)")
      .eq("classroom_id", classroomId)
      .gte("session_date", from)
      .lte("session_date", to)
      .order("session_date")
      .order("period_number"),
    supabase.from("profiles").select("full_name, school_name").single(),
  ]);
  if (!classroom) return NextResponse.json({ error: "الفصل غير موجود" }, { status: 404 });
  const rows = (summary ?? []) as Summary[];

  const wb = new ExcelJS.Workbook();
  wb.creator = "HISSATI";
  wb.created = new Date();
  const title = `تقرير الحضور والغياب — ${classroom.name}`;
  const period = `من ${formatShortDate(from)} إلى ${formatShortDate(to)}`;
  const font = { name: "Arial", size: 11 };
  const header = (ws: ExcelJS.Worksheet, cols: number) => {
    ws.mergeCells(1, 1, 1, cols);
    ws.getCell(1, 1).value = title;
    ws.getCell(1, 1).font = { ...font, size: 14, bold: true };
    ws.mergeCells(2, 1, 2, cols);
    ws.getCell(2, 1).value = [profile?.school_name, profile?.full_name, period].filter(Boolean).join(" · ");
    ws.getCell(2, 1).font = font;
    [1, 2].forEach((r) => (ws.getCell(r, 1).alignment = { horizontal: "center" }));
  };
  const styleHead = (row: ExcelJS.Row) => {
    row.font = { ...font, bold: true };
    row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    row.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F4F2" } };
      c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
    });
  };

  // --- sheet 1: summary
  const s1 = wb.addWorksheet("الملخص", { views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }] });
  header(s1, 9);
  const h1 = s1.getRow(4);
  h1.values = ["م", "اسم الطالب", "رقم الطالب", "حاضر", "غائب", "متأخر", "مستأذن", "عدد الحصص", "نسبة الحضور %"];
  styleHead(h1);
  rows.forEach((r, i) => {
    const row = s1.addRow([i + 1, r.full_name, r.student_number || "", r.present, r.absent, r.late, r.excused, r.total, r.attendance_rate === null ? "" : Number(r.attendance_rate)]);
    row.font = font;
    row.alignment = { horizontal: "center" };
    row.getCell(2).alignment = { horizontal: "right" };
    if (r.absent > 0) row.getCell(5).font = { ...font, bold: true, color: { argb: "FFC62828" } };
  });
  s1.columns = [{ width: 6 }, { width: 34 }, { width: 14 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 11 }, { width: 13 }];

  // --- sheet 2: detail grid (students × sessions)
  const list = sessions ?? [];
  const s2 = wb.addWorksheet("التفاصيل", { views: [{ rightToLeft: true, state: "frozen", xSplit: 2, ySplit: 4 }] });
  header(s2, Math.max(3, list.length + 2));
  const h2 = s2.getRow(4);
  h2.values = ["م", "اسم الطالب", ...list.map((s) => `${formatShortDate(s.session_date)}\nح${s.period_number}${s.subject ? ` ${s.subject}` : ""}`)];
  h2.height = 42;
  styleHead(h2);
  const lookup = list.map((s) => new Map(((s.attendance_records ?? []) as { student_id: string; status: string }[]).map((r) => [r.student_id, r.status])));
  rows.forEach((r, i) => {
    const row = s2.addRow([i + 1, r.full_name, ...lookup.map((m) => SHORT[m.get(r.student_id) ?? ""] ?? "")]);
    row.font = font;
    row.alignment = { horizontal: "center" };
    row.getCell(2).alignment = { horizontal: "right" };
    lookup.forEach((m, j) => {
      const st = m.get(r.student_id);
      const color = st === "absent" ? "FFFDECEC" : st === "late" ? "FFFDF3E3" : st === "excused" ? "FFE9EFFD" : null;
      if (color) row.getCell(j + 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    });
  });
  s2.getColumn(1).width = 6;
  s2.getColumn(2).width = 32;
  for (let j = 0; j < list.length; j++) s2.getColumn(j + 3).width = 12;
  const legend = s2.addRow([]);
  legend.getCell(2).value = `المفتاح: ✓ ${STATUS_AR.present} · غ ${STATUS_AR.absent} · ت ${STATUS_AR.late} · س ${STATUS_AR.excused}`;

  const buf = await wb.xlsx.writeBuffer();
  const fname = `حضور_${classroom.name}_${from}_${to}.xlsx`.replace(/[\\/:*?"<>|\s]+/g, "_");
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent(fname)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
