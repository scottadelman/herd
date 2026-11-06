-- Herd upgrade 004: "every month" and "every few weeks or months" schedules,
-- a profile photo and phone number, deleting your own account (while keeping
-- the household's history), and fixing the day of something logged by hand.
--
-- Only adds things. No existing rows are removed or rewritten.
--
-- Already set up Herd before this? Paste ONLY this file into
-- Supabase > SQL Editor and click Run. Fresh projects run schema.sql instead,
-- which already includes it. Running it twice is safe.

-- ---------------------------------------------------------------------------
-- Schedules: monthly, and a multiplier for weekly and monthly
-- ("every 2 weeks on Monday", "every 3 months on the 15th")
-- ---------------------------------------------------------------------------

alter table public.routines drop constraint if exists routines_kind_check;
alter table public.routines
  add constraint routines_kind_check check (kind in ('daily', 'weekly', 'interval', 'once', 'monthly'));

alter table public.routines
  add column if not exists repeat_every integer not null default 1 check (repeat_every between 1 and 52);

-- ---------------------------------------------------------------------------
-- Profiles: a photo and a phone number the household can see
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists avatar text
    check (avatar is null or (avatar like 'data:image/%' and char_length(avatar) <= 400000)),
  add column if not exists phone text check (phone is null or char_length(phone) <= 30);

grant update (display_name, avatar, phone) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Check-offs keep the person's name if their account is deleted
-- ---------------------------------------------------------------------------

alter table public.task_logs
  add column if not exists author_name text check (author_name is null or char_length(author_name) <= 40);

alter table public.task_logs drop constraint if exists task_logs_has_author;
alter table public.task_logs
  add constraint task_logs_has_author check (done_by is not null or sitter_name is not null or author_name is not null);

-- People only ever check things off as themselves; author_name is set by
-- delete_my_account() alone.
drop policy if exists "Check things off as yourself" on public.task_logs;
create policy "Check things off as yourself" on public.task_logs
  for insert to authenticated
  with check (
    public.is_household_member(household_id) and done_by = auth.uid()
    and sitter_link_id is null and sitter_name is null and author_name is null
  );

drop policy if exists "Members edit check-offs" on public.task_logs;
create policy "Members edit check-offs" on public.task_logs
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (
    public.is_household_member(household_id)
    and (status = 'snoozed' or done_by = auth.uid())
    and sitter_link_id is null and sitter_name is null and author_name is null
  );

-- ---------------------------------------------------------------------------
-- Things logged by hand (a bath, a vet visit) can move to another day and be
-- renamed. Routine check-offs stay on the day they belong to.
-- ---------------------------------------------------------------------------

grant update (occurrence_date, title) on public.task_logs to authenticated;

create or replace function public.task_logs_keep_routine_day()
returns trigger language plpgsql as $$
begin
  if old.routine_id is not null and (new.occurrence_date <> old.occurrence_date or new.title <> old.title) then
    raise exception 'A routine check-off stays on its own day. Change the time it was done instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists task_logs_keep_routine_day on public.task_logs;
create trigger task_logs_keep_routine_day
  before update on public.task_logs
  for each row execute function public.task_logs_keep_routine_day();

-- ---------------------------------------------------------------------------
-- Delete your own account. Your check-offs stay in each household's history
-- under your name, households you own pass to the next person who joined,
-- and a household with nobody else in it goes with you.
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  my_name text;
  owned record;
  heir uuid;
begin
  if me is null then raise exception 'Sign in to delete your account.'; end if;
  select left(coalesce(display_name, 'Someone'), 40) into my_name from public.profiles where id = me;

  update public.task_logs set author_name = coalesce(my_name, 'Someone'), done_by = null where done_by = me;

  for owned in select id from public.households where created_by = me loop
    select user_id into heir from public.household_members
    where household_id = owned.id and user_id <> me
    order by joined_at limit 1;
    if heir is null then
      delete from public.households where id = owned.id;
    else
      update public.household_members set role = 'owner' where household_id = owned.id and user_id = heir;
      update public.households set created_by = heir where id = owned.id;
    end if;
  end loop;

  delete from auth.users where id = me;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;
