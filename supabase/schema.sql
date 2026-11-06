-- Herd: full database setup for a NEW Supabase project.
-- Paste this whole file into Supabase > SQL Editor and click Run, once.
--
-- Already running Herd? Don't run this file. Run only the newest file in
-- supabase/migrations that you haven't run yet.
--
-- Generated from supabase/migrations by "npm run build:schema". Edit those files, not this one.

-- ===========================================================================
-- 001_initial.sql
-- ===========================================================================

-- Herd migration 001: the original tables, invites, security rules and
-- live updates.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Someone' check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  color text not null default '#3A6EA5' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

create table public.pets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  species text not null default 'other'
    check (species in ('dog', 'cat', 'bird', 'fish', 'reptile', 'small_mammal', 'horse', 'other')),
  emoji text not null default '🐾' check (char_length(emoji) <= 16),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  unique (id, household_id)
);
create index pets_household_idx on public.pets (household_id);

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  pet_id uuid not null,
  title text not null check (char_length(title) between 1 and 60),
  kind text not null check (kind in ('daily', 'weekly', 'interval')),
  times text[] not null default '{}',
  weekdays smallint[] not null default '{}',
  interval_days integer check (interval_days is null or interval_days between 1 and 365),
  start_date date not null default current_date,
  assignee uuid references public.profiles (id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  -- A routine's pet must belong to the same household as the routine.
  foreign key (pet_id, household_id) references public.pets (id, household_id) on delete cascade,
  check (kind <> 'interval' or interval_days is not null),
  check (cardinality(times) <= 12)
);
create index routines_household_idx on public.routines (household_id);

create table public.task_logs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  pet_id uuid not null,
  routine_id uuid references public.routines (id) on delete set null,
  occurrence_date date not null,
  slot text not null check (slot ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or slot in ('any', 'adhoc')),
  title text not null check (char_length(title) between 1 and 60),
  note text check (note is null or char_length(note) <= 500),
  done_by uuid not null references public.profiles (id) on delete cascade,
  done_at timestamptz not null default now(),
  foreign key (pet_id, household_id) references public.pets (id, household_id) on delete cascade
);
-- The heart of the app: each routine can only be checked off once per slot,
-- so two people can't both feed the dog breakfast.
create unique index task_logs_once_per_slot
  on public.task_logs (routine_id, occurrence_date, slot)
  where routine_id is not null;
create index task_logs_household_date_idx on public.task_logs (household_id, occurrence_date);

-- ---------------------------------------------------------------------------
-- Helpers (security definer so policies can check membership without
-- recursing through household_members' own policies)
-- ---------------------------------------------------------------------------

create or replace function public.is_household_member(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members where household_id = hid and user_id = auth.uid()
  );
$$;

create or replace function public.is_household_owner(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid() and role = 'owner'
  );
$$;

create or replace function public.shares_household(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.household_members a
    join public.household_members b on a.household_id = b.household_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- 8 characters from an alphabet without look-alikes (no 0/O, 1/I).
-- Uses gen_random_uuid() as a strong random source; 256 is divisible by 32,
-- so the modulo introduces no bias.
create or replace function public.generate_invite_code()
returns text language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := uuid_send(gen_random_uuid());
  byte_positions constant int[] := array[0, 1, 2, 3, 4, 5, 10, 11];
  code text := '';
  pos int;
begin
  foreach pos in array byte_positions loop
    code := code || substr(alphabet, 1 + (get_byte(bytes, pos) % 32), 1);
  end loop;
  return code;
end;
$$;

-- Stamp colors handed out to members in order. Same list as src/lib/people.ts.
create or replace function public.next_member_color(hid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c from unnest(array['#3A6EA5', '#E4572E', '#1F8A70', '#8E4A9E', '#C98A12', '#D1477A']) with ordinality as t(c, n)
     where c not in (select color from public.household_members where household_id = hid)
     order by n limit 1),
    '#3A6EA5'
  );
$$;

-- ---------------------------------------------------------------------------
-- Profiles are created automatically when someone signs up
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Someone'), 40)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Household actions the app calls directly
-- ---------------------------------------------------------------------------

create or replace function public.create_household(p_name text)
returns public.households language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  h public.households;
begin
  if me is null then raise exception 'Sign in to create a household.'; end if;
  if char_length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Give your household a name.'; end if;
  insert into public.profiles (id) values (me) on conflict (id) do nothing;
  insert into public.households (name, invite_code, created_by)
  values (left(trim(p_name), 60), public.generate_invite_code(), me)
  returning * into h;
  insert into public.household_members (household_id, user_id, role, color)
  values (h.id, me, 'owner', '#3A6EA5');
  return h;
end;
$$;

create or replace function public.join_household(p_code text)
returns public.households language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  h public.households;
begin
  if me is null then raise exception 'Sign in to join a household.'; end if;
  select * into h from public.households
  where invite_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if not found then raise exception 'That invite code doesn''t match a household. Check it and try again.'; end if;
  insert into public.profiles (id) values (me) on conflict (id) do nothing;
  insert into public.household_members (household_id, user_id, role, color)
  values (h.id, me, 'member', public.next_member_color(h.id))
  on conflict (household_id, user_id) do nothing;
  return h;
end;
$$;

create or replace function public.regenerate_invite(p_household uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  code text := public.generate_invite_code();
begin
  if not public.is_household_owner(p_household) then
    raise exception 'Only the household owner can make a new invite code.';
  end if;
  update public.households set invite_code = code where id = p_household;
  return code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security: you only ever see your own household's data
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.pets enable row level security;
alter table public.routines enable row level security;
alter table public.task_logs enable row level security;

create policy "See yourself and your household" on public.profiles
  for select to authenticated using (id = auth.uid() or public.shares_household(id));
create policy "Edit your own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "Members see their household" on public.households
  for select to authenticated using (public.is_household_member(id));
create policy "Owner renames household" on public.households
  for update to authenticated using (public.is_household_owner(id)) with check (public.is_household_owner(id));
create policy "Owner deletes household" on public.households
  for delete to authenticated using (public.is_household_owner(id));

create policy "Members see each other" on public.household_members
  for select to authenticated using (public.is_household_member(household_id));
create policy "Members change their own color" on public.household_members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Leave, or owner removes others" on public.household_members
  for delete to authenticated using (
    (user_id = auth.uid() and role <> 'owner')
    or (public.is_household_owner(household_id) and user_id <> auth.uid())
  );

create policy "Members manage pets" on public.pets
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "Members manage routines" on public.routines
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (
    public.is_household_member(household_id)
    and (assignee is null or exists (
      select 1 from public.household_members m where m.household_id = routines.household_id and m.user_id = assignee
    ))
  );

create policy "Members see the log" on public.task_logs
  for select to authenticated using (public.is_household_member(household_id));
create policy "Check things off as yourself" on public.task_logs
  for insert to authenticated
  with check (public.is_household_member(household_id) and done_by = auth.uid());
create policy "Members can undo" on public.task_logs
  for delete to authenticated using (public.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- Privileges. Signed-out visitors get nothing; signed-in users get only what
-- the policies above allow. Members may change only their stamp color, not
-- their role.
-- ---------------------------------------------------------------------------

revoke all on public.profiles, public.households, public.household_members,
  public.pets, public.routines, public.task_logs from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, delete on public.households to authenticated;
grant update (name) on public.households to authenticated;
grant select, delete on public.household_members to authenticated;
grant update (color) on public.household_members to authenticated;
grant select, insert, update, delete on public.pets, public.routines to authenticated;
grant select, insert, delete on public.task_logs to authenticated;

revoke execute on function public.create_household(text), public.join_household(text),
  public.regenerate_invite(uuid), public.generate_invite_code(), public.next_member_color(uuid),
  public.is_household_member(uuid), public.is_household_owner(uuid), public.shares_household(uuid),
  public.handle_new_user()
  from public, anon, authenticated;
grant execute on function public.create_household(text), public.join_household(text),
  public.regenerate_invite(uuid), public.is_household_member(uuid), public.is_household_owner(uuid),
  public.shares_household(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Live updates: when anyone checks something off, everyone sees it instantly
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.task_logs, public.pets, public.routines, public.household_members, public.households;

-- ===========================================================================
-- 002_health_sitters_reminders.sql
-- ===========================================================================

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

-- ===========================================================================
-- 003_profiles_supplies_places.sql
-- ===========================================================================

-- Herd upgrade 003: detailed pet profiles (breed, birthday, allergies, likes
-- and dislikes, feeding instructions, primary vet), food and supply
-- reordering, and walk places (routes, parks, poop bag spots).
--
-- Already set up Herd before this? Paste ONLY this file into
-- Supabase > SQL Editor and click Run. Fresh projects run schema.sql instead,
-- which already includes it. Running it twice is safe.

-- ---------------------------------------------------------------------------
-- Pet profiles
-- ---------------------------------------------------------------------------

alter table public.pets
  -- What kind of pet, in the owner's words, when species is 'other' (e.g. "Hedgehog").
  add column if not exists species_label text check (species_label is null or char_length(species_label) <= 30),
  add column if not exists breed text check (breed is null or char_length(breed) <= 60),
  add column if not exists birthday date,
  add column if not exists sex text check (sex is null or sex in ('female', 'male')),
  add column if not exists fixed boolean,
  add column if not exists microchip text check (microchip is null or char_length(microchip) <= 40),
  add column if not exists allergies text[] not null default '{}'
    check (cardinality(allergies) <= 20 and char_length(array_to_string(allergies, '')) <= 600),
  add column if not exists likes text[] not null default '{}'
    check (cardinality(likes) <= 20 and char_length(array_to_string(likes, '')) <= 600),
  add column if not exists dislikes text[] not null default '{}'
    check (cardinality(dislikes) <= 20 and char_length(array_to_string(dislikes, '')) <= 600),
  -- Feeding: what they eat, how much per meal, and anything else to know.
  add column if not exists food text check (food is null or char_length(food) <= 80),
  add column if not exists food_amount text check (food_amount is null or char_length(food_amount) <= 80),
  add column if not exists feeding_notes text check (feeding_notes is null or char_length(feeding_notes) <= 1000),
  -- Primary vet.
  add column if not exists vet_clinic text check (vet_clinic is null or char_length(vet_clinic) <= 80),
  add column if not exists vet_name text check (vet_name is null or char_length(vet_name) <= 60),
  add column if not exists vet_phone text check (vet_phone is null or char_length(vet_phone) <= 30),
  add column if not exists vet_address text check (vet_address is null or char_length(vet_address) <= 200);

-- ---------------------------------------------------------------------------
-- Members: a reminder when it's time to order more food or supplies
-- ---------------------------------------------------------------------------

alter table public.household_members
  add column if not exists notify_supplies boolean not null default true;

-- ---------------------------------------------------------------------------
-- Supplies: food, litter, meds and the like, with when to order more.
-- A bag opened on opened_on lasts about lasts_days; order lead_days before
-- it runs out. restocks keeps past opened_on dates so the app can learn how
-- long a bag really lasts.
-- ---------------------------------------------------------------------------

create table if not exists public.supplies (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  kind text not null default 'food' check (kind in ('food', 'treats', 'litter', 'medication', 'other')),
  -- Empty means it's shared by every pet.
  pet_ids uuid[] not null default '{}',
  opened_on date not null default current_date,
  lasts_days integer not null check (lasts_days between 1 and 365),
  lead_days integer not null default 5 check (lead_days between 0 and 60),
  -- Set when someone ordered more; cleared when a new one is opened.
  ordered_on date,
  restocks date[] not null default '{}' check (cardinality(restocks) <= 50),
  order_url text check (order_url is null or (order_url ~* '^https?://' and char_length(order_url) <= 500)),
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists supplies_household_idx on public.supplies (household_id);

-- ---------------------------------------------------------------------------
-- Walk places: saved routes, parks, poop bag spots, anything else on a map.
-- points is a list of [latitude, longitude] pairs (one pair for a spot).
-- ---------------------------------------------------------------------------

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null check (kind in ('route', 'park', 'bag_spot', 'other')),
  name text not null check (char_length(name) between 1 and 60),
  notes text check (notes is null or char_length(notes) <= 500),
  points jsonb not null check (
    jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 1 and 500
  ),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists places_household_idx on public.places (household_id);

-- ---------------------------------------------------------------------------
-- Sitters now see each pet's full profile (feeding, allergies, likes and
-- dislikes, vet) and the household's walk places.
-- ---------------------------------------------------------------------------

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
      select jsonb_agg(to_jsonb(p) order by p.created_at)
      from public.pets p where p.id = any (allowed)), '[]'::jsonb),
    'routines', coalesce((
      select jsonb_agg(to_jsonb(r) - 'assignee' order by r.created_at)
      from public.routines r where r.pet_id = any (allowed) and r.active), '[]'::jsonb),
    'logs', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.done_at desc)
      from public.task_logs t
      where t.pet_id = any (allowed) and t.routine_id is not null
        and (t.occurrence_date between today - 1 and today + 1 or t.snoozed_to between today - 1 and today + 1)), '[]'::jsonb),
    'places', coalesce((
      select jsonb_agg(jsonb_build_object('id', pl.id, 'kind', pl.kind, 'name', pl.name, 'notes', pl.notes, 'points', pl.points)
        order by pl.created_at)
      from public.places pl where pl.household_id = l.household_id), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.supplies enable row level security;
alter table public.places enable row level security;

drop policy if exists "Members manage supplies" on public.supplies;
create policy "Members manage supplies" on public.supplies
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists "Members manage places" on public.places;
create policy "Members manage places" on public.places
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

grant update (notify_supplies) on public.household_members to authenticated;

revoke all on public.supplies, public.places from anon, authenticated;
grant select, insert, delete on public.supplies, public.places to authenticated;
grant update (name, kind, pet_ids, opened_on, lasts_days, lead_days, ordered_on, restocks, order_url, notes)
  on public.supplies to authenticated;
grant update (kind, name, notes, points) on public.places to authenticated;

-- ---------------------------------------------------------------------------
-- Live updates
-- ---------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.supplies;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.places;
exception when duplicate_object then null;
end $$;

-- ===========================================================================
-- 004_schedules_accounts.sql
-- ===========================================================================

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
