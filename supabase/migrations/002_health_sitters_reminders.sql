-- Herd upgrade 002: skip and snooze, editable check-offs, one-time tasks,
-- medications/vaccines/vet visits, pet photos, weight log, sitter links,
-- push reminders, and household time zones.
--
-- Already set up Herd before this? Paste ONLY this file into
-- Supabase > SQL Editor and click Run. Fresh projects run schema.sql instead,
-- which already includes it.

-- ---------------------------------------------------------------------------
-- Households: time zone (so reminders fire at the right local time)
-- ---------------------------------------------------------------------------

alter table public.households
  add column if not exists timezone text check (timezone is null or char_length(timezone) <= 64);

-- ---------------------------------------------------------------------------
-- Members: reminder preferences, per person per household
-- ---------------------------------------------------------------------------

alter table public.household_members
  add column if not exists notify_late boolean not null default true,
  add column if not exists notify_daily text
    check (notify_daily is null or notify_daily ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- ---------------------------------------------------------------------------
-- Pets: a photo, stored as a small resized JPEG data URL
-- ---------------------------------------------------------------------------

alter table public.pets
  add column if not exists photo text
    check (photo is null or (photo like 'data:image/%' and char_length(photo) <= 400000));

-- ---------------------------------------------------------------------------
-- Routines: one-time tasks, a category, and a dose for medications
-- ---------------------------------------------------------------------------

alter table public.routines drop constraint if exists routines_kind_check;
alter table public.routines
  add constraint routines_kind_check check (kind in ('daily', 'weekly', 'interval', 'once'));

alter table public.routines
  add column if not exists category text not null default 'care'
    check (category in ('care', 'medication', 'vaccine', 'vet')),
  add column if not exists dose text check (dose is null or char_length(dose) <= 80);

-- ---------------------------------------------------------------------------
-- Sitter links: a no-account link for a walker or sitter, limited to today's
-- tasks for chosen pets, that stops working on a set date
-- ---------------------------------------------------------------------------

create table if not exists public.sitter_links (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  token text not null unique default encode(uuid_send(gen_random_uuid()), 'hex'),
  label text not null check (char_length(label) between 1 and 40),
  -- Empty means every pet in the household.
  pet_ids uuid[] not null default '{}',
  expires_at timestamptz not null,
  revoked boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sitter_links_household_idx on public.sitter_links (household_id);

-- ---------------------------------------------------------------------------
-- Task log: skipped and snoozed entries, edits, and sitter check-offs
-- ---------------------------------------------------------------------------

alter table public.task_logs
  add column if not exists status text not null default 'done'
    check (status in ('done', 'skipped', 'snoozed')),
  -- When set, this occurrence was moved and shows up on this date instead.
  add column if not exists snoozed_to date,
  add column if not exists sitter_link_id uuid references public.sitter_links (id) on delete set null,
  add column if not exists sitter_name text check (sitter_name is null or char_length(sitter_name) <= 40);

alter table public.task_logs alter column done_by drop not null;
alter table public.task_logs drop constraint if exists task_logs_snooze_has_date;
alter table public.task_logs
  add constraint task_logs_snooze_has_date check (status <> 'snoozed' or snoozed_to is not null);
alter table public.task_logs drop constraint if exists task_logs_has_author;
alter table public.task_logs
  add constraint task_logs_has_author check (done_by is not null or sitter_name is not null);
create index if not exists task_logs_household_snoozed_idx on public.task_logs (household_id, snoozed_to)
  where snoozed_to is not null;

-- ---------------------------------------------------------------------------
-- Weight log
-- ---------------------------------------------------------------------------

create table if not exists public.pet_weights (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  pet_id uuid not null,
  weighed_on date not null default current_date,
  weight numeric(7, 2) not null check (weight > 0 and weight < 5000),
  unit text not null default 'lb' check (unit in ('lb', 'kg')),
  note text check (note is null or char_length(note) <= 200),
  recorded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (pet_id, household_id) references public.pets (id, household_id) on delete cascade
);
create index if not exists pet_weights_pet_idx on public.pet_weights (pet_id, weighed_on);

-- ---------------------------------------------------------------------------
-- Reminders: push subscriptions (one per phone), a record of what was sent so
-- nothing is sent twice, and server-only settings the reminder job uses
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table if not exists public.notifications_sent (
  key text primary key,
  sent_at timestamptz not null default now()
);

create table if not exists public.app_secrets (
  key text primary key,
  value text not null
);
-- A random password the scheduled job uses to call the reminder function.
insert into public.app_secrets (key, value)
values ('cron_secret', encode(uuid_send(gen_random_uuid()), 'hex') || encode(uuid_send(gen_random_uuid()), 'hex'))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Household creation now records the creator's time zone
-- ---------------------------------------------------------------------------

drop function if exists public.create_household(text);
create or replace function public.create_household(p_name text, p_timezone text default null)
returns public.households language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  h public.households;
begin
  if me is null then raise exception 'Sign in to create a household.'; end if;
  if char_length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Give your household a name.'; end if;
  insert into public.profiles (id) values (me) on conflict (id) do nothing;
  insert into public.households (name, invite_code, created_by, timezone)
  values (left(trim(p_name), 60), public.generate_invite_code(), me, left(nullif(trim(coalesce(p_timezone, '')), ''), 64))
  returning * into h;
  insert into public.household_members (household_id, user_id, role, color)
  values (h.id, me, 'owner', '#3A6EA5');
  return h;
end;
$$;

-- ---------------------------------------------------------------------------
-- Push subscription helpers (each person only ever touches their own)
-- ---------------------------------------------------------------------------

create or replace function public.get_push_public_key()
returns text language sql stable security definer set search_path = public as $$
  select value from public.app_secrets where key = 'vapid_public';
$$;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in to turn on reminders.'; end if;
  insert into public.profiles (id) values (auth.uid()) on conflict (id) do nothing;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Sitter access. Sitters have no account: everything goes through these
-- functions, which check the link and only ever expose today's tasks for the
-- pets the link covers.
-- ---------------------------------------------------------------------------

create or replace function public.sitter_link_for(p_token text)
returns public.sitter_links language plpgsql stable security definer set search_path = public as $$
declare
  l public.sitter_links;
begin
  select * into l from public.sitter_links where token = p_token;
  if not found or l.revoked or l.expires_at <= now() then
    raise exception 'This sitter link has expired or was turned off. Ask the owner for a new one.';
  end if;
  return l;
end;
$$;

create or replace function public.sitter_today(p_household uuid)
returns date language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select timezone from public.households where id = p_household), 'UTC'))::date;
$$;

create or replace function public.sitter_view(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  l public.sitter_links := public.sitter_link_for(p_token);
  today date := public.sitter_today(l.household_id);
  allowed uuid[];
begin
  select coalesce(array_agg(id), '{}') into allowed from public.pets
  where household_id = l.household_id and (cardinality(l.pet_ids) = 0 or id = any (l.pet_ids));

  return jsonb_build_object(
    'link', jsonb_build_object('id', l.id, 'label', l.label, 'expires_at', l.expires_at),
    'today', today,
    'household', (select jsonb_build_object('id', h.id, 'name', h.name) from public.households h where h.id = l.household_id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', p.display_name, 'color', m.color))
      from public.household_members m join public.profiles p on p.id = m.user_id
      where m.household_id = l.household_id), '[]'::jsonb),
    'pets', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'species', species, 'emoji', emoji, 'notes', notes, 'photo', photo) order by created_at)
      from public.pets where id = any (allowed)), '[]'::jsonb),
    'routines', coalesce((
      select jsonb_agg(to_jsonb(r) - 'assignee' order by r.created_at)
      from public.routines r where r.pet_id = any (allowed) and r.active), '[]'::jsonb),
    'logs', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.done_at desc)
      from public.task_logs t
      where t.pet_id = any (allowed) and t.routine_id is not null
        and (t.occurrence_date between today - 1 and today + 1 or t.snoozed_to between today - 1 and today + 1)), '[]'::jsonb)
  );
end;
$$;

create or replace function public.sitter_complete(p_token text, p_routine uuid, p_date date, p_slot text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.sitter_links := public.sitter_link_for(p_token);
  today date := public.sitter_today(l.household_id);
  r public.routines;
  existing public.task_logs;
  result public.task_logs;
begin
  select * into r from public.routines
  where id = p_routine and household_id = l.household_id and active
    and (cardinality(l.pet_ids) = 0 or pet_id = any (l.pet_ids));
  if not found then raise exception 'That task isn''t part of this sitter link.'; end if;

  select * into existing from public.task_logs
  where routine_id = p_routine and occurrence_date = p_date and slot = p_slot;

  if found then
    -- A task someone moved to today can be checked off by the sitter.
    if existing.status = 'snoozed' and existing.snoozed_to between today - 1 and today then
      update public.task_logs
      set status = 'done', done_by = null, sitter_link_id = l.id, sitter_name = l.label,
          done_at = now(), note = left(nullif(trim(coalesce(p_note, '')), ''), 500)
      where id = existing.id and status = 'snoozed'
      returning * into result;
      if found then return jsonb_build_object('ok', true, 'log', to_jsonb(result)); end if;
      select * into existing from public.task_logs where id = existing.id;
    end if;
    return jsonb_build_object('ok', false, 'log', to_jsonb(existing));
  end if;

  if p_date not between today - 1 and today then
    raise exception 'Sitter links can only check off today''s tasks.';
  end if;

  begin
    insert into public.task_logs (household_id, pet_id, routine_id, occurrence_date, slot, title, note, status, done_by, sitter_link_id, sitter_name)
    values (l.household_id, r.pet_id, r.id, p_date, p_slot, r.title, left(nullif(trim(coalesce(p_note, '')), ''), 500), 'done', null, l.id, l.label)
    returning * into result;
  exception when unique_violation then
    select * into existing from public.task_logs where routine_id = p_routine and occurrence_date = p_date and slot = p_slot;
    return jsonb_build_object('ok', false, 'log', to_jsonb(existing));
  end;
  return jsonb_build_object('ok', true, 'log', to_jsonb(result));
end;
$$;

create or replace function public.sitter_undo(p_token text, p_log uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.sitter_links := public.sitter_link_for(p_token);
  t public.task_logs;
begin
  select * into t from public.task_logs where id = p_log and sitter_link_id = l.id and done_at > now() - interval '1 day';
  if not found then raise exception 'Only your own check-offs from today can be undone.'; end if;
  if t.snoozed_to is not null then
    update public.task_logs set status = 'snoozed', note = null where id = t.id;
  else
    delete from public.task_logs where id = t.id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security for the new tables and columns
-- ---------------------------------------------------------------------------

alter table public.sitter_links enable row level security;
alter table public.pet_weights enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notifications_sent enable row level security;
alter table public.app_secrets enable row level security;
-- push_subscriptions, notifications_sent and app_secrets get no policies:
-- only the reminder job (service role) and the functions above use them.

drop policy if exists "Members manage sitter links" on public.sitter_links;
create policy "Members manage sitter links" on public.sitter_links
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists "Members manage weights" on public.pet_weights;
create policy "Members manage weights" on public.pet_weights
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- Members check things off as themselves. Sitter check-offs only come
-- through sitter_complete().
drop policy if exists "Check things off as yourself" on public.task_logs;
create policy "Check things off as yourself" on public.task_logs
  for insert to authenticated
  with check (
    public.is_household_member(household_id) and done_by = auth.uid()
    and sitter_link_id is null and sitter_name is null
  );

-- Edit your own check-offs (time, note), finish a moved task, or put a
-- finished moved task back.
drop policy if exists "Members edit check-offs" on public.task_logs;
create policy "Members edit check-offs" on public.task_logs
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (
    public.is_household_member(household_id)
    and (status = 'snoozed' or done_by = auth.uid())
    and sitter_link_id is null and sitter_name is null
  );

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.sitter_links, public.pet_weights, public.push_subscriptions,
  public.notifications_sent, public.app_secrets from anon, authenticated;

grant update (name, timezone) on public.households to authenticated;
grant update (color, notify_late, notify_daily) on public.household_members to authenticated;
-- Sitter columns can only be cleared (the policy above requires null).
grant update (status, snoozed_to, done_by, done_at, note, sitter_link_id, sitter_name) on public.task_logs to authenticated;
grant select, insert, delete on public.sitter_links to authenticated;
grant update (label, pet_ids, expires_at, revoked) on public.sitter_links to authenticated;
grant select, insert, update, delete on public.pet_weights to authenticated;

revoke execute on function
  public.create_household(text, text), public.get_push_public_key(), public.save_push_subscription(text, text, text),
  public.delete_push_subscription(text), public.sitter_link_for(text), public.sitter_today(uuid),
  public.sitter_view(text), public.sitter_complete(text, uuid, date, text, text), public.sitter_undo(text, uuid)
  from public, anon, authenticated;
grant execute on function
  public.create_household(text, text), public.get_push_public_key(), public.save_push_subscription(text, text, text),
  public.delete_push_subscription(text)
  to authenticated;
grant execute on function
  public.sitter_view(text), public.sitter_complete(text, uuid, date, text, text), public.sitter_undo(text, uuid)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Live updates for the new tables
-- ---------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.pet_weights;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.sitter_links;
exception when duplicate_object then null;
end $$;
