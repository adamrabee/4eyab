-- Hardening based on Supabase database advisors.

-- 1) Pin search_path on helper functions (lint 0011_function_search_path_mutable).
--    Both only use built-ins, which always resolve via pg_catalog.
alter function public.set_updated_at() set search_path = '';
alter function public.normalize_ar_name(text) set search_path = '';

-- 2) handle_new_user only runs as the auth.users trigger; nobody should call it
--    through the API (lint 0028/0029). Triggers fire regardless of EXECUTE grants.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 3) approve_roster_extraction / approve_schedule_extraction stay SECURITY DEFINER
--    on purpose: teachers can't mark AI jobs approved directly (column grants +
--    RLS), so these functions do it in the same transaction that saves the
--    reviewed data. Each one checks auth.uid() owns the job and every classroom
--    it touches (covered by tests/db.security.test.ts).
comment on function public.approve_roster_extraction(uuid, jsonb, uuid, jsonb) is
  'SECURITY DEFINER by design: verifies auth.uid() owns the job/classroom, saves reviewed students and marks the job approved atomically.';
comment on function public.approve_schedule_extraction(uuid, jsonb, boolean) is
  'SECURITY DEFINER by design: verifies auth.uid() owns the job/classrooms, saves reviewed periods and marks the job approved atomically.';

-- 4) Cover the composite (parent_id, teacher_id) foreign keys with indexes
--    (lint 0001_unindexed_foreign_keys). These also serve cascading deletes.
create index if not exists students_classroom_teacher_idx          on public.students (classroom_id, teacher_id);
create index if not exists schedule_periods_classroom_teacher_idx  on public.schedule_periods (classroom_id, teacher_id);
create index if not exists attendance_sessions_classroom_teacher_idx on public.attendance_sessions (classroom_id, teacher_id);
create index if not exists attendance_records_session_teacher_idx  on public.attendance_records (session_id, teacher_id);
create index if not exists attendance_records_student_teacher_idx  on public.attendance_records (student_id, teacher_id);
create index if not exists extraction_jobs_upload_teacher_idx      on public.extraction_jobs (upload_id, teacher_id);

-- the new composite indexes make these single-column ones redundant
drop index if exists public.schedule_classroom_idx;
drop index if exists public.attendance_records_student_idx;
