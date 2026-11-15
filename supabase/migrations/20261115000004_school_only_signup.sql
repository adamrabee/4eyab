-- School-only accounts.
-- Teachers register through the app with the school code; the server then
-- creates the account with the admin API and marks it with
-- app_metadata.hissati_member = true. Public sign-ups through the Supabase API
-- (which anyone holding the public anon key could call) cannot set
-- app_metadata, so they are rejected here, inside the database.
--
-- Supabase Auth inserts the user row first and writes app_metadata in a later
-- statement of the same transaction, so the check is a DEFERRED constraint
-- trigger: it runs at commit, sees the final row, and rolls the whole sign-up
-- back if the marker is missing.

create or replace function public.guard_school_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb;
begin
  select u.raw_app_meta_data into meta from auth.users u where u.id = new.id;
  if not found then
    return null; -- row already gone (e.g. deleted in the same transaction)
  end if;
  if coalesce(meta ->> 'hissati_member', '') <> 'true' then
    raise exception 'sign-ups are closed: accounts are created by the HISSATI app with the school code'
      using errcode = '42501';
  end if;
  return null;
end $$;

drop trigger if exists guard_school_signup on auth.users;
create constraint trigger guard_school_signup
  after insert on auth.users
  deferrable initially deferred
  for each row execute function public.guard_school_signup();

revoke execute on function public.guard_school_signup() from public, anon, authenticated;
