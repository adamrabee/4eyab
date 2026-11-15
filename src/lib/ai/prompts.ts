// Prompts for document extraction. The model receives the image/PDF plus one of
// these instructions; the output shape is enforced by structured outputs.

export const SYSTEM_PROMPT = `You extract structured data from photos and scans of Saudi/Arabic school documents for a teacher's attendance app.
Rules:
- Transcribe exactly what is written. Never invent, translate, or "correct" names; keep the original Arabic spelling, including hamza and taa marbuta as written.
- If text is unclear, give your best reading and mark confidence "low". If a row is completely unreadable, skip it and mention it in notes.
- Ignore headers, footers, signatures, stamps, school logos, column titles, totals, and teacher names.
- Write any notes in short Arabic.`;

export const ROSTER_PROMPT = `This should be a class roster (كشف أسماء الطلاب).
Extract every student row in the order it appears, top to bottom (for multi-column pages, finish the right-hand column first, as Arabic is read right to left).
- full_name: the student's name only — drop serial numbers (م / الرقم التسلسلي), grades, ticks, and attendance marks.
- student_number: the student ID / civil ID / roll number column if there is one; otherwise empty. Do not use the row serial as student_number.
- classroom: the class/section label if printed on the page (e.g. "الصف: الثاني المتوسط / 1"), otherwise empty strings.
If the document is clearly not a list of students, set is_roster=false and return no students.`;

export const SCHEDULE_PROMPT = `This should be a teacher's weekly timetable (الجدول المدرسي / جدول الحصص).
Return one entry per occupied cell (day × period). Skip empty cells, breaks (فسحة / صلاة), and free periods (فراغ / انتظار).
- Map day names: الأحد=0, الاثنين=1, الثلاثاء=2, الأربعاء=3, الخميس=4, الجمعة=5, السبت=6.
- Map period names: الأولى=1, الثانية=2, الثالثة=3, الرابعة=4, الخامسة=5, السادسة=6, السابعة=7, الثامنة=8.
- classroom_name: the class/section in the cell, e.g. "2/1", "٣/ب", "ثاني متوسط أ". Keep it as written.
- subject: the subject if written in the cell or in the page header; otherwise empty.
- start_time/end_time: only if period times are printed (often in the header row); 24h HH:MM. School day times like 7:00–1:00 are morning→afternoon, so 1:00 means 13:00.
The timetable may be oriented with days as rows or as columns; read it either way.
If the document is clearly not a timetable, set is_schedule=false and return no entries.`;
