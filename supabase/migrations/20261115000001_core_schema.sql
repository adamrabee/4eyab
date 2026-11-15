-- HISSATI core schema
-- Every row belongs to exactly one teacher (auth.users.id). Child tables carry a
-- denormalised teacher_id so RLS is a cheap equality check, and composite foreign
-- keys (parent_id, teacher_id) guarantee a child can never point at another
-- teacher's parent row, even through the service role.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
create type public.attendance_status as enum ('present', 'absent', 'late', 'excused');
create type public.upload_kind as enum ('roster', 'schedule');
create type public.extraction_status as enum ('processing', 'needs_review', 'approved', 'rejected', 'failed');

-- ---------------------------------------------------------------- helpers
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '' check (char_length(full_name) <= 120),
  school_name text not null default '' check (char_length(school_name) <= 160),
  subject     text not null default '' check (char_length(subject) <= 80),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- create a profile automatically for every new auth user
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, school_name)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120),
    left(coalesce(new.raw_user_meta_data ->> 'school_name', ''), 160)
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- classrooms
create table public.classrooms (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  grade         text not null default '' check (char_length(grade) <= 60),
  section       text not null default '' check (char_length(section) <= 30),
  academic_year text not null default '' check (char_length(academic_year) <= 20),
  archived      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, teacher_id)
);
create index classrooms_teacher_idx on public.classrooms (teacher_id) where not archived;
create trigger classrooms_updated_at before update on public.classrooms
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- students
create table public.students (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid not null default auth.uid(),
  classroom_id   uuid not null,
  full_name      text not null check (char_length(btrim(full_name)) between 1 and 150),
  student_number text not null default '' check (char_length(student_number) <= 40),
  guardian_phone text not null default '' check (char_length(guardian_phone) <= 30),
  notes          text not null default '' check (char_length(notes) <= 1000),
  sort_order     integer not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, teacher_id),
  foreign key (classroom_id, teacher_id) references public.classrooms (id, teacher_id) on delete cascade
);
create index students_classroom_idx on public.students (classroom_id, sort_order) where active;
create index students_teacher_idx on public.students (teacher_id);
create trigger students_updated_at before update on public.students
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- weekly schedule
-- day_of_week: 0 = Sunday … 6 = Saturday (Saudi school week is Sun–Thu)
create table public.schedule_periods (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid not null default auth.uid(),
  classroom_id  uuid not null,
  day_of_week   smallint not null check (day_of_week between 0 and 6),
  period_number smallint not null check (period_number between 1 and 12),
  start_time    time,
  end_time      time,
  subject       text not null default '' check (char_length(subject) <= 80),
  room          text not null default '' check (char_length(room) <= 40),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (start_time is null or end_time is null or end_time > start_time),
  -- a teacher can't be in two classrooms in the same slot
  unique (teacher_id, day_of_week, period_number),
  foreign key (classroom_id, teacher_id) references public.classrooms (id, teacher_id) on delete cascade
);
create index schedule_classroom_idx on public.schedule_periods (classroom_id);
create trigger schedule_periods_updated_at before update on public.schedule_periods
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- attendance
create table public.attendance_sessions (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid not null default auth.uid(),
  classroom_id  uuid not null,
  session_date  date not null,
  period_number smallint not null default 1 check (period_number between 1 and 12),
  subject       text not null default '' check (char_length(subject) <= 80),
  notes         text not null default '' check (char_length(notes) <= 1000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, teacher_id),
  unique (classroom_id, session_date, period_number),
  foreign key (classroom_id, teacher_id) references public.classrooms (id, teacher_id) on delete cascade
);
create index attendance_sessions_teacher_date_idx on public.attendance_sessions (teacher_id, session_date desc);
create trigger attendance_sessions_updated_at before update on public.attendance_sessions
  for each row execute function public.set_updated_at();

create table public.attendance_records (
  id           uuid primary key default gen_random_uuid(),
  teacher_id   uuid not null default auth.uid(),
  session_id   uuid not null,
  student_id   uuid not null,
  status       public.attendance_status not null default 'present',
  minutes_late smallint check (minutes_late is null or minutes_late between 0 and 600),
  note         text not null default '' check (char_length(note) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (session_id, student_id),
  foreign key (session_id, teacher_id) references public.attendance_sessions (id, teacher_id) on delete cascade,
  foreign key (student_id, teacher_id) references public.students (id, teacher_id) on delete cascade
);
create index attendance_records_student_idx on public.attendance_records (student_id);
create trigger attendance_records_updated_at before update on public.attendance_records
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- uploads & AI extraction
create table public.uploads (
  id           uuid primary key default gen_random_uuid(),
  teacher_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind         public.upload_kind not null,
  storage_path text not null unique,
  file_name    text not null default '' check (char_length(file_name) <= 255),
  mime_type    text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf')),
  size_bytes   integer not null check (size_bytes > 0 and size_bytes <= 20 * 1024 * 1024),
  created_at   timestamptz not null default now(),
  unique (id, teacher_id),
  -- objects must live under the owner's folder in the bucket
  check (split_part(storage_path, '/', 1) = teacher_id::text)
);
create index uploads_teacher_idx on public.uploads (teacher_id, created_at desc);

create table public.extraction_jobs (
  id           uuid primary key default gen_random_uuid(),
  teacher_id   uuid not null default auth.uid(),
  upload_id    uuid not null,
  kind         public.upload_kind not null,
  status       public.extraction_status not null default 'processing',
  provider     text not null check (provider in ('anthropic', 'mock')),
  model        text not null default '',
  result       jsonb,
  error        text,
  classroom_id uuid,
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, teacher_id),
  foreign key (upload_id, teacher_id) references public.uploads (id, teacher_id) on delete cascade
);
create index extraction_jobs_teacher_idx on public.extraction_jobs (teacher_id, created_at desc);
create trigger extraction_jobs_updated_at before update on public.extraction_jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- RLS
alter table public.profiles            enable row level security;
alter table public.classrooms          enable row level security;
alter table public.students            enable row level security;
alter table public.schedule_periods    enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records  enable row level security;
alter table public.uploads             enable row level security;
alter table public.extraction_jobs     enable row level security;

create policy "own profile: read"   on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "own profile: update" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['classrooms','students','schedule_periods','attendance_sessions','attendance_records','uploads'] loop
    execute format('create policy "owner: all" on public.%I for all to authenticated
                    using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Extraction jobs are created/updated by the server (service role) after running
-- the AI provider. Teachers may read their jobs and reject one that is awaiting
-- review; approval only happens through the approve_* functions (next migration),
-- which save the reviewed data and flip the status in one transaction.
create policy "owner: read"   on public.extraction_jobs for select to authenticated using (teacher_id = (select auth.uid()));
create policy "owner: reject" on public.extraction_jobs for update to authenticated
  using (teacher_id = (select auth.uid()) and status = 'needs_review')
  with check (teacher_id = (select auth.uid()) and status = 'rejected');

-- Teachers may not forge AI results: only the status column is client-writable.
revoke update on public.extraction_jobs from authenticated;
grant update (status) on public.extraction_jobs to authenticated;
revoke insert, delete on public.extraction_jobs from authenticated, anon;

-- anon gets nothing on app tables
revoke all on public.profiles, public.classrooms, public.students, public.schedule_periods,
  public.attendance_sessions, public.attendance_records, public.uploads, public.extraction_jobs from anon;
