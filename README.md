# حصتي | HISSATI

AI-powered school attendance platform for teachers (Arabic, RTL, mobile-first).

**Photograph → AI extraction → review → approval → automatic setup → attendance.**

## Features

- **Simple accounts**: teachers register themselves with name, username and password, then log in with username + password. There's no email and no confirmation. An optional `SCHOOL_CODE` restricts sign-up to people who know the code. Each teacher's data is fully isolated.
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
- AI vision for reading student rosters and timetables (images and PDFs): **Google Gemini** (`gemini-2.5-flash`, the default in production) or Anthropic Claude, selected with `AI_PROVIDER`

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

## Production

### Supabase project: done
Project **`hissati`** (ref `aljxcqxxhzxluppdeemc`, region `ap-south-1` Mumbai, free plan).
All migrations in `supabase/migrations/` are applied, and the Supabase security advisor shows
only the two intentional `SECURITY DEFINER` approval functions (documented in migration 3).

### Accounts (no email)
Usernames map internally to `<username>@hissati.invalid` (a reserved domain that can never receive mail).
The server creates accounts with the admin API and marks them `app_metadata.hissati_member = true`.
Migration 4 rejects any other sign-up at commit time, which blocks direct sign-ups using the public key, so every account goes through the app's username rules.
A forgotten password can be reset in Supabase → Authentication → Users.

### Hosting environment variables (e.g. Vercel → Project → Settings → Environment Variables)
| Name | Value | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://aljxcqxxhzxluppdeemc.supabase.co` | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the project's **publishable** key (`sb_publishable_…`, Project Settings → API Keys) | no (public by design) |
| `SUPABASE_SERVICE_ROLE_KEY` | the **secret** key (`sb_secret_…` or legacy `service_role`) | **YES, server only** |
| `SCHOOL_CODE` | *optional*: leave unset for open sign-up, or set a code teachers must enter | **YES, server only** |
| `SCHOOL_NAME` | your school's name (shown on login) | no |
| `AI_PROVIDER` | `gemini` (or `anthropic`, or `mock` for labelled sample data) | no |
| `GEMINI_API_KEY` | Google AI Studio key (when `AI_PROVIDER=gemini`) | **YES, server only** |
| `GEMINI_MODEL` | optional, default `gemini-2.5-flash` | no |
| `ANTHROPIC_API_KEY` | from console.anthropic.com | **YES, server only** |

Never commit real values. `.env*` files are gitignored, except `.env.example`.

## Security model

- Each table has a `teacher_id` column. RLS limits every teacher to their own rows.
- Composite foreign keys `(id, teacher_id)` stop any cross-teacher link, even when the service role is used.
- Teachers cannot write AI results. Extraction jobs are written server-side. Approval goes through
  `approve_*_extraction` functions, which save the reviewed data and mark the job approved in one transaction.
- The browser uploads files straight to a private bucket under `<teacher-id>/…` (storage RLS), so large photos never pass through the hosting platform's request-size limit. The API then receives only the path and verifies its owner. The server checks each file's real type from its magic bytes and enforces a 20 MB limit and a per-teacher hourly scan limit.

## Backups

`npm run backup` writes a git bundle and a source snapshot to `backups/` (gitignored). It does not contact any remote.
