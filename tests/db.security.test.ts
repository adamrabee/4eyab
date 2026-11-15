/**
 * Database security & integrity tests against the LOCAL Supabase stack
 * (`npm run db:up`). Each run creates throwaway teacher accounts and deletes them.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, deleteTeacher, hasLocalStack, newTeacher } from "./helpers";

const run = hasLocalStack() ? describe : describe.skip;

run("multi-teacher isolation (RLS)", () => {
  let a: { client: SupabaseClient; id: string };
  let b: { client: SupabaseClient; id: string };
  let classA: string;
  let studentA: string;

  beforeAll(async () => {
    a = await newTeacher("المعلم أ");
    b = await newTeacher("المعلم ب");
    const { data: c, error } = await a.client.from("classrooms").insert({ name: "الصف الثاني أ" }).select().single();
    expect(error).toBeNull();
    classA = c!.id;
    const { data: s } = await a.client
      .from("students")
      .insert({ classroom_id: classA, full_name: "طالب تجريبي" })
      .select()
      .single();
    studentA = s!.id;
  });

  afterAll(async () => {
    await deleteTeacher(a.id);
    await deleteTeacher(b.id);
  });

  it("rejects sign-ups that don't come from the app (school-only accounts)", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const email = `outsider-${Date.now()}@example.test`;
    const pub = await anon.auth.signUp({ email, password: "outsider-pass-1", options: { data: { hissati_member: true } } });
    expect(pub.error).not.toBeNull();
    const noMarker = await admin().auth.admin.createUser({ email: `nomarker-${Date.now()}@hissati.invalid`, password: "pw-123456789", email_confirm: true });
    expect(noMarker.error).not.toBeNull();
    const { data } = await admin().auth.admin.listUsers({ perPage: 1000 });
    expect(data.users.some((u) => u.email === email)).toBe(false);
  });

  it("creates a profile automatically on signup", async () => {
    const { data } = await a.client.from("profiles").select("full_name").single();
    expect(data?.full_name).toBe("المعلم أ");
  });

  it("teacher B cannot read teacher A's classrooms or students", async () => {
    const { data: cls } = await b.client.from("classrooms").select("*");
    const { data: sts } = await b.client.from("students").select("*");
    const { data: prof } = await b.client.from("profiles").select("*");
    expect(cls).toEqual([]);
    expect(sts).toEqual([]);
    expect(prof).toHaveLength(1); // only their own
  });

  it("teacher B cannot update or delete teacher A's rows", async () => {
    const upd = await b.client.from("classrooms").update({ name: "مخترق" }).eq("id", classA).select();
    expect(upd.data).toEqual([]);
    const del = await b.client.from("students").delete().eq("id", studentA).select();
    expect(del.data).toEqual([]);
    const { data } = await a.client.from("classrooms").select("name").eq("id", classA).single();
    expect(data?.name).toBe("الصف الثاني أ");
  });

  it("teacher B cannot insert a student into teacher A's classroom", async () => {
    const { error } = await b.client.from("students").insert({ classroom_id: classA, full_name: "دخيل" });
    expect(error).not.toBeNull();
  });

  it("teacher B cannot spoof teacher_id on insert", async () => {
    const { error } = await b.client.from("classrooms").insert({ name: "x", teacher_id: a.id });
    expect(error).not.toBeNull();
  });

  it("composite FK blocks cross-teacher links even for the service role", async () => {
    const { data: cB } = await b.client.from("classrooms").insert({ name: "صف ب" }).select().single();
    const { error } = await admin()
      .from("students")
      .insert({ teacher_id: a.id, classroom_id: cB!.id, full_name: "رابط خاطئ" });
    expect(error?.code).toBe("23503"); // foreign_key_violation
  });

  it("anonymous users see nothing", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data, error } = await anon.from("classrooms").select("*");
    expect(data ?? []).toEqual([]);
    expect(error === null || error.code === "42501").toBe(true);
  });

  it("teacher B cannot save attendance for teacher A's classroom", async () => {
    const { error } = await b.client.rpc("save_attendance", {
      p_classroom_id: classA,
      p_session_date: "2026-11-10",
      p_period_number: 1,
      p_records: [{ student_id: studentA, status: "absent" }],
    });
    expect(error).not.toBeNull();
  });
});

run("attendance workflow", () => {
  let t: { client: SupabaseClient; id: string };
  let classId: string;
  let students: { id: string }[];

  beforeAll(async () => {
    t = await newTeacher();
    const { data: c } = await t.client.from("classrooms").insert({ name: "٢/١" }).select().single();
    classId = c!.id;
    const { data } = await t.client
      .from("students")
      .insert(["أ", "ب", "ج"].map((n, i) => ({ classroom_id: classId, full_name: `طالب ${n}`, sort_order: i })))
      .select("id");
    students = data!;
  });
  afterAll(() => deleteTeacher(t.id));

  it("saves and then updates a session idempotently", async () => {
    const base = { p_classroom_id: classId, p_session_date: "2026-11-09", p_period_number: 2 };
    const first = await t.client.rpc("save_attendance", {
      ...base,
      p_records: [
        { student_id: students[0].id, status: "present" },
        { student_id: students[1].id, status: "absent" },
        { student_id: students[2].id, status: "late", minutes_late: 10 },
      ],
    });
    expect(first.error).toBeNull();
    const second = await t.client.rpc("save_attendance", {
      ...base,
      p_records: [{ student_id: students[1].id, status: "excused", note: "عذر طبي" }],
    });
    expect(second.data).toBe(first.data); // same session row
    const { data: recs } = await t.client.from("attendance_records").select("student_id,status,minutes_late").eq("session_id", first.data);
    expect(recs).toHaveLength(3);
    expect(recs!.find((r) => r.student_id === students[1].id)?.status).toBe("excused");
    expect(recs!.find((r) => r.student_id === students[2].id)?.minutes_late).toBe(10);
  });

  it("rejects future dates", async () => {
    const { error } = await t.client.rpc("save_attendance", {
      p_classroom_id: classId,
      p_session_date: "2099-01-01",
      p_period_number: 1,
      p_records: [],
    });
    expect(error?.message).toMatch(/future/);
  });

  it("summarises per student over a date range", async () => {
    const { data, error } = await t.client.rpc("attendance_summary", {
      p_classroom_id: classId,
      p_from: "2026-11-01",
      p_to: "2026-11-30",
    });
    expect(error).toBeNull();
    const late = data!.find((r: { student_id: string }) => r.student_id === students[2].id);
    expect(late).toMatchObject({ late: 1, total: 1, attendance_rate: 100 });
    const outOfRange = await t.client.rpc("attendance_summary", {
      p_classroom_id: classId,
      p_from: "2026-12-01",
      p_to: "2026-12-31",
    });
    expect(outOfRange.data).toHaveLength(3); // students still listed with zero totals
    expect(outOfRange.data!.every((r: { total: number }) => r.total === 0)).toBe(true);
  });
});

run("extraction approval", () => {
  let t: { client: SupabaseClient; id: string };
  let other: { client: SupabaseClient; id: string };

  async function makeJob(teacherId: string, kind: "roster" | "schedule") {
    const db = admin();
    const path = `${teacherId}/${crypto.randomUUID()}.png`;
    const { data: up, error: e1 } = await db
      .from("uploads")
      .insert({ teacher_id: teacherId, kind, storage_path: path, mime_type: "image/png", size_bytes: 100 })
      .select()
      .single();
    if (e1) throw e1;
    const { data: job, error: e2 } = await db
      .from("extraction_jobs")
      .insert({ teacher_id: teacherId, upload_id: up!.id, kind, provider: "mock", status: "needs_review", result: {} })
      .select()
      .single();
    if (e2) throw e2;
    return job!.id as string;
  }

  beforeAll(async () => {
    t = await newTeacher();
    other = await newTeacher();
  });
  afterAll(async () => {
    await deleteTeacher(t.id);
    await deleteTeacher(other.id);
  });

  it("approves a roster into a new classroom and skips duplicate names on re-import", async () => {
    const job1 = await makeJob(t.id, "roster");
    const r1 = await t.client.rpc("approve_roster_extraction", {
      job_id: job1,
      students: [{ full_name: "أحمد علي" }, { full_name: "  سارة   محمد " }, { full_name: "" }],
      new_classroom: { name: "الصف الثاني", grade: "ثاني متوسط" },
    });
    expect(r1.error).toBeNull();
    expect(r1.data).toMatchObject({ inserted: 2, skipped: 0 });

    const job2 = await makeJob(t.id, "roster");
    const r2 = await t.client.rpc("approve_roster_extraction", {
      job_id: job2,
      students: [{ full_name: "احمد علي" }, { full_name: "خالد" }], // alef variant = duplicate
      target_classroom_id: r1.data.classroom_id,
    });
    expect(r2.data).toMatchObject({ inserted: 1, skipped: 1 });

    const { data: names } = await t.client.from("students").select("full_name").eq("classroom_id", r1.data.classroom_id).order("sort_order");
    expect(names!.map((n) => n.full_name)).toEqual(["أحمد علي", "سارة محمد", "خالد"]);
  });

  it("cannot approve the same job twice, or another teacher's job", async () => {
    const job = await makeJob(t.id, "roster");
    const args = { job_id: job, students: [{ full_name: "س" }], new_classroom: { name: "ص" } };
    expect((await other.client.rpc("approve_roster_extraction", args)).error?.message).toMatch(/not found/);
    expect((await t.client.rpc("approve_roster_extraction", args)).error).toBeNull();
    expect((await t.client.rpc("approve_roster_extraction", args)).error?.message).toMatch(/not awaiting review/);
  });

  it("teacher cannot mark a job approved directly or tamper with AI results", async () => {
    const job = await makeJob(t.id, "roster");
    const approve = await t.client.from("extraction_jobs").update({ status: "approved" }).eq("id", job).select();
    expect(approve.error ?? approve.data?.length === 0).toBeTruthy();
    const tamper = await t.client.from("extraction_jobs").update({ result: { hacked: true } }).eq("id", job);
    expect(tamper.error).not.toBeNull();
    const reject = await t.client.from("extraction_jobs").update({ status: "rejected" }).eq("id", job).select();
    expect(reject.data?.[0]?.status).toBe("rejected");
  });

  it("approves a schedule, creating classrooms by name and upserting slots", async () => {
    const job = await makeJob(t.id, "schedule");
    const { data, error } = await t.client.rpc("approve_schedule_extraction", {
      job_id: job,
      replace_existing: true,
      entries: [
        { day_of_week: 0, period_number: 1, classroom_name: "الصف الثاني", subject: "رياضيات", start_time: "07:00", end_time: "07:45" },
        { day_of_week: 0, period_number: 2, classroom_name: "ثالث ب", subject: "رياضيات" },
        { day_of_week: 1, period_number: 1, classroom_name: "ثالث ب", subject: "رياضيات" },
      ],
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ saved: 3, classrooms_created: 1 }); // "الصف الثاني" already exists
    const { data: rows } = await t.client.from("schedule_periods").select("*");
    expect(rows).toHaveLength(3);
  });

  it("storage: a teacher cannot read or write another teacher's folder", async () => {
    const file = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    const own = await t.client.storage.from("uploads").upload(`${t.id}/a.png`, file);
    expect(own.error).toBeNull();
    const foreignWrite = await other.client.storage.from("uploads").upload(`${t.id}/evil.png`, file);
    expect(foreignWrite.error).not.toBeNull();
    const foreignRead = await other.client.storage.from("uploads").download(`${t.id}/a.png`);
    expect(foreignRead.error).not.toBeNull();
    await t.client.storage.from("uploads").remove([`${t.id}/a.png`]);
  });
});
