-- Storage bucket for uploaded rosters/timetables + transactional RPCs.

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', false, 20971520,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- objects are stored as "<teacher uuid>/<random>.<ext>"; a teacher sees only their folder
create policy "uploads: owner read" on storage.objects for select to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "uploads: owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "uploads: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------- helpers
-- Arabic-aware name normalisation used to skip duplicates on re-import:
-- unify alef/yaa/taa-marbuta variants, strip tatweel & diacritics, collapse spaces.
create or replace function public.normalize_ar_name(n text) returns text
language sql immutable parallel safe as $$
  select regexp_replace(
           translate(
             regexp_replace(coalesce(n, ''), '[ً-ْـ]', '', 'g'),
             'أإآىة', 'ااايه'),
           '\s+', ' ', 'g')
$$;

-- ---------------------------------------------------------------- approve roster
-- Saves reviewed student names into an existing classroom (target_classroom_id)
-- or a new one (new_classroom: {name, grade, section, academic_year}).
-- students: [{full_name, student_number?}]. Duplicate names already in the
-- classroom are skipped. Returns {classroom_id, inserted, skipped}.
create or replace function public.approve_roster_extraction(
  job_id uuid,
  students jsonb,
  target_classroom_id uuid default null,
  new_classroom jsonb default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  job public.extraction_jobs;
  cid uuid;
  next_order int;
  s jsonb;
  nm text;
  ins int := 0;
  skp int := 0;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if jsonb_typeof(students) <> 'array' then raise exception 'students must be an array' using errcode = '22023'; end if;
  if jsonb_array_length(students) > 200 then raise exception 'too many students (max 200)' using errcode = '22023'; end if;

  select * into job from public.extraction_jobs j
   where j.id = job_id and j.teacher_id = uid for update;
  if not found then raise exception 'job not found' using errcode = 'P0002'; end if;
  if job.kind <> 'roster' then raise exception 'job is not a roster extraction' using errcode = '22023'; end if;
  if job.status <> 'needs_review' then raise exception 'job is not awaiting review' using errcode = '55000'; end if;

  if target_classroom_id is not null then
    select c.id into cid from public.classrooms c where c.id = target_classroom_id and c.teacher_id = uid;
    if cid is null then raise exception 'classroom not found' using errcode = 'P0002'; end if;
  else
    if new_classroom is null or btrim(coalesce(new_classroom ->> 'name', '')) = '' then
      raise exception 'classroom name required' using errcode = '22023';
    end if;
    insert into public.classrooms (teacher_id, name, grade, section, academic_year)
    values (uid,
            btrim(new_classroom ->> 'name'),
            coalesce(btrim(new_classroom ->> 'grade'), ''),
            coalesce(btrim(new_classroom ->> 'section'), ''),
            coalesce(btrim(new_classroom ->> 'academic_year'), ''))
    returning id into cid;
  end if;

  select coalesce(max(st.sort_order), 0) into next_order from public.students st where st.classroom_id = cid;

  for s in select * from jsonb_array_elements(students) loop
    nm := regexp_replace(btrim(coalesce(s ->> 'full_name', '')), '\s+', ' ', 'g');
    if nm = '' then continue; end if;
    if exists (select 1 from public.students st
                where st.classroom_id = cid and st.active
                  and public.normalize_ar_name(st.full_name) = public.normalize_ar_name(nm)) then
      skp := skp + 1;
      continue;
    end if;
    next_order := next_order + 1;
    insert into public.students (teacher_id, classroom_id, full_name, student_number, sort_order)
    values (uid, cid, left(nm, 150), left(coalesce(btrim(s ->> 'student_number'), ''), 40), next_order);
    ins := ins + 1;
  end loop;

  update public.extraction_jobs
     set status = 'approved', approved_at = now(), classroom_id = cid
   where id = job.id;

  return jsonb_build_object('classroom_id', cid, 'inserted', ins, 'skipped', skp);
end $$;

-- ---------------------------------------------------------------- approve schedule
-- entries: [{day_of_week, period_number, start_time?, end_time?, subject?, room?,
--            classroom_id? | classroom_name?}]
-- A classroom_name that doesn't match an existing (non-archived) classroom of the
-- teacher creates one. replace_existing wipes the teacher's current timetable first;
-- otherwise entries overwrite only the slots they occupy.
create or replace function public.approve_schedule_extraction(
  job_id uuid,
  entries jsonb,
  replace_existing boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  job public.extraction_jobs;
  e jsonb;
  cid uuid;
  cname text;
  created int := 0;
  saved int := 0;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if jsonb_typeof(entries) <> 'array' then raise exception 'entries must be an array' using errcode = '22023'; end if;
  if jsonb_array_length(entries) > 84 then raise exception 'too many entries' using errcode = '22023'; end if;

  select * into job from public.extraction_jobs j
   where j.id = job_id and j.teacher_id = uid for update;
  if not found then raise exception 'job not found' using errcode = 'P0002'; end if;
  if job.kind <> 'schedule' then raise exception 'job is not a schedule extraction' using errcode = '22023'; end if;
  if job.status <> 'needs_review' then raise exception 'job is not awaiting review' using errcode = '55000'; end if;

  if replace_existing then
    delete from public.schedule_periods where teacher_id = uid;
  end if;

  for e in select * from jsonb_array_elements(entries) loop
    cid := nullif(e ->> 'classroom_id', '')::uuid;
    if cid is not null then
      if not exists (select 1 from public.classrooms c where c.id = cid and c.teacher_id = uid) then
        raise exception 'classroom not found' using errcode = 'P0002';
      end if;
    else
      cname := btrim(coalesce(e ->> 'classroom_name', ''));
      if cname = '' then raise exception 'each entry needs a classroom' using errcode = '22023'; end if;
      select c.id into cid from public.classrooms c
       where c.teacher_id = uid and not c.archived
         and public.normalize_ar_name(c.name) = public.normalize_ar_name(cname)
       limit 1;
      if cid is null then
        insert into public.classrooms (teacher_id, name) values (uid, left(cname, 80)) returning id into cid;
        created := created + 1;
      end if;
    end if;

    insert into public.schedule_periods (teacher_id, classroom_id, day_of_week, period_number, start_time, end_time, subject, room)
    values (uid, cid,
            (e ->> 'day_of_week')::smallint,
            (e ->> 'period_number')::smallint,
            nullif(e ->> 'start_time', '')::time,
            nullif(e ->> 'end_time', '')::time,
            left(coalesce(btrim(e ->> 'subject'), ''), 80),
            left(coalesce(btrim(e ->> 'room'), ''), 40))
    on conflict (teacher_id, day_of_week, period_number) do update
      set classroom_id = excluded.classroom_id, start_time = excluded.start_time,
          end_time = excluded.end_time, subject = excluded.subject, room = excluded.room;
    saved := saved + 1;
  end loop;

  update public.extraction_jobs set status = 'approved', approved_at = now() where id = job.id;
  return jsonb_build_object('saved', saved, 'classrooms_created', created);
end $$;

-- ---------------------------------------------------------------- save attendance
-- Upserts a session (classroom + date + period) and all its records atomically.
-- records: [{student_id, status, minutes_late?, note?}]
-- Runs as the caller, so RLS and the composite FKs enforce ownership.
create or replace function public.save_attendance(
  p_classroom_id uuid,
  p_session_date date,
  p_period_number smallint,
  p_records jsonb,
  p_subject text default '',
  p_notes text default ''
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if jsonb_typeof(p_records) <> 'array' then raise exception 'records must be an array' using errcode = '22023'; end if;
  if p_session_date > (now() at time zone 'Asia/Riyadh')::date + 1 then
    raise exception 'cannot record attendance for a future date' using errcode = '22023';
  end if;

  insert into public.attendance_sessions (teacher_id, classroom_id, session_date, period_number, subject, notes)
  values (uid, p_classroom_id, p_session_date, p_period_number, coalesce(p_subject, ''), coalesce(p_notes, ''))
  on conflict (classroom_id, session_date, period_number) do update
    set subject = excluded.subject, notes = excluded.notes
  returning id into sid;

  insert into public.attendance_records (teacher_id, session_id, student_id, status, minutes_late, note)
  select uid, sid, (r ->> 'student_id')::uuid,
         (r ->> 'status')::public.attendance_status,
         case when r ->> 'status' = 'late' then nullif(r ->> 'minutes_late', '')::smallint end,
         left(coalesce(r ->> 'note', ''), 500)
    from jsonb_array_elements(p_records) r
  on conflict (session_id, student_id) do update
    set status = excluded.status, minutes_late = excluded.minutes_late, note = excluded.note;

  return sid;
end $$;

-- ---------------------------------------------------------------- reporting
-- Per-student totals for a classroom over a date range (inclusive).
create or replace function public.attendance_summary(
  p_classroom_id uuid,
  p_from date,
  p_to date
) returns table (
  student_id uuid,
  full_name text,
  student_number text,
  sort_order int,
  present bigint,
  absent bigint,
  late bigint,
  excused bigint,
  total bigint,
  attendance_rate numeric
)
language sql stable security invoker set search_path = '' as $$
  select st.id, st.full_name, st.student_number, st.sort_order,
         count(*) filter (where r.status = 'present'),
         count(*) filter (where r.status = 'absent'),
         count(*) filter (where r.status = 'late'),
         count(*) filter (where r.status = 'excused'),
         count(r.id),
         case when count(r.id) = 0 then null
              else round(100.0 * count(*) filter (where r.status in ('present', 'late')) / count(r.id), 1) end
    from public.students st
    left join (
      select r.id, r.student_id, r.status
        from public.attendance_records r
        join public.attendance_sessions s on s.id = r.session_id
       where s.classroom_id = p_classroom_id
         and s.session_date between p_from and p_to
    ) r on r.student_id = st.id
   where st.classroom_id = p_classroom_id
     and (st.active or r.id is not null)
   group by st.id
   order by st.sort_order, st.full_name
$$;

revoke execute on function public.approve_roster_extraction(uuid, jsonb, uuid, jsonb) from public, anon;
revoke execute on function public.approve_schedule_extraction(uuid, jsonb, boolean) from public, anon;
revoke execute on function public.save_attendance(uuid, date, smallint, jsonb, text, text) from public, anon;
revoke execute on function public.attendance_summary(uuid, date, date) from public, anon;
grant execute on function public.approve_roster_extraction(uuid, jsonb, uuid, jsonb) to authenticated;
grant execute on function public.approve_schedule_extraction(uuid, jsonb, boolean) to authenticated;
grant execute on function public.save_attendance(uuid, date, smallint, jsonb, text, text) to authenticated;
grant execute on function public.attendance_summary(uuid, date, date) to authenticated;
