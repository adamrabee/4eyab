# حصتي | HISSATI

AI-powered school attendance platform for teachers (Arabic, RTL, mobile-first).

**Photograph → AI extraction → review → approval → automatic setup → attendance.**

## Features

- Teacher accounts (Supabase Auth); each teacher's data is fully isolated.
- **Smart scan**: photograph or upload (image/PDF) a student roster or weekly timetable. Claude extracts it, the teacher reviews and corrects it, then approves.
- Classrooms and students: add, edit, reorder, archive. Removing a student keeps their history.
- Weekly timetable: grid and per-day editor, plus "today's periods" on the dashboard.
- **Attendance** (modelled on the original single-file sheet): week → day → period navigation. Every student starts as present. One tap sets absent, late (with minutes) or excused, and each change autosaves.
  Tools: copy the previous period's absences, copy names, clear the period, record "everyone present".
- **Official absence sheet** (كشف الطلاب الغائبين): Hijri (Umm al-Qura) and Gregorian dates, period, subject,
  numbered absentees, late and excused sections, teacher name and signature line. A4 print or direct PDF download (canvas-rendered so Arabic letters stay joined).
- **Reports**: per-student totals and attendance rate for any date range, session history, per-student history,
  an **Excel** export (RTL, summary and detail sheets) and a print/PDF version.

## Stack

- Next.js 16 (App Router, TypeScript) + Tailwind CSS 4
- Supabase: PostgreSQL, Auth, Storage, with Row Level Security on every table
- Anthropic Claude Vision for reading student rosters and timetables (images and PDFs)

## Local development

Requires Node 22+ and Docker.

```bash
npm install
npm run db:up     # local Supabase stack, applies migrations, writes .env.local
npm run dev       # http://localhost:3000
```

`npm run db:up` generates random **local-only** secrets in `supabase/.env` and `.env.local`.
Both files are gitignored. Other commands: `npm run db:down`, `npm run db:reset` (deletes local data).

### AI provider

`.env.local` defaults to `AI_PROVIDER=mock`. The mock **does not read the uploaded file**.
It returns clearly-labelled sample data so the upload → review → approve flow can be tested.
The UI shows a warning banner whenever mock data is used.

To use real extraction, add to `.env.local` (server-only, never commit):

```
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
```

The default model is `claude-opus-5-5`; override it with `ANTHROPIC_MODEL`.

## Tests

```bash
npm test                    # unit + database security tests (needs `npm run db:up`)
npm run build && npm start  # then, in another shell:
node e2e/smoke.mjs          # browser end-to-end flow (mock AI)
```

## Production (Supabase cloud). Not done yet; needs owner approval

1. Create a Supabase project and run `supabase/migrations/*.sql` in order (SQL editor or Supabase CLI).
2. Set the env vars from `.env.example` in the hosting platform. Keep `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` server-only.
3. In Supabase Auth, set the Site URL and keep email confirmation **on**.

## Security model

- Each table has a `teacher_id` column. RLS limits every teacher to their own rows.
- Composite foreign keys `(id, teacher_id)` stop any cross-teacher link, even when the service role is used.
- Teachers cannot write AI results. Extraction jobs are written server-side. Approval goes through
  `approve_*_extraction` functions, which save the reviewed data and mark the job approved in one transaction.
- Uploads go to a private bucket under `<teacher-id>/…`. The server checks each file's real type from its magic bytes and enforces a 20 MB limit and a per-teacher hourly scan limit.

## Backups

`npm run backup` writes a git bundle and a source snapshot to `backups/` (gitignored). It does not contact any remote.
