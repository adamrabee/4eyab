-- Allow Google Gemini as an AI extraction provider (AI_PROVIDER=gemini).
alter table public.extraction_jobs drop constraint if exists extraction_jobs_provider_check;
alter table public.extraction_jobs add constraint extraction_jobs_provider_check
  check (provider in ('anthropic', 'gemini', 'mock'));
