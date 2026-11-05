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
