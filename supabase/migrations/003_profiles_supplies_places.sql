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
