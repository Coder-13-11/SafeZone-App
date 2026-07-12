create extension if not exists pgcrypto;

do $$ begin
  create type public.household_role as enum ('owner', 'caregiver');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.geofence_state as enum ('unknown', 'safe', 'caution', 'grace', 'alert');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.care_response_status as enum ('responding', 'help_requested');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  patient_name text not null check (char_length(patient_name) between 1 and 80),
  patient_relationship text not null default 'Family member',
  geofence_state public.geofence_state not null default 'unknown',
  grace_started_at timestamptz,
  alert_sent_for_exit boolean not null default false,
  paired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.household_role not null default 'caregiver',
  caregiver_label text not null check (char_length(caregiver_label) between 1 and 80),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.patient_devices (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  token_hash text not null,
  label text not null default 'Patient phone',
  last_seen_at timestamptz,
  replaced_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists patient_devices_active_household_idx
  on public.patient_devices(household_id)
  where replaced_at is null;

create table if not exists public.pairing_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pairing_sessions_household_active_idx
  on public.pairing_sessions(household_id, expires_at)
  where claimed_at is null;

create table if not exists public.safe_zones (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null default 'Home Zone',
  color text not null default '#8fd5ae',
  points jsonb not null check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) >= 3),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.location_pings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  patient_device_id uuid references public.patient_devices(id) on delete set null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy double precision,
  battery integer check (battery between 0 and 100),
  state_at_time public.geofence_state not null default 'unknown',
  zone_id uuid references public.safe_zones(id) on delete set null,
  distance_to_boundary_m double precision,
  grace_ends_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists location_pings_household_recent_idx
  on public.location_pings(household_id, created_at desc);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  caregiver_label text not null,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.care_responses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  caregiver_label text not null,
  status public.care_response_status not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists care_responses_active_idx
  on public.care_responses(household_id, created_at desc)
  where resolved_at is null;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists households_touch_updated_at on public.households;
create trigger households_touch_updated_at
before update on public.households
for each row execute function public.touch_updated_at();

drop trigger if exists safe_zones_touch_updated_at on public.safe_zones;
create trigger safe_zones_touch_updated_at
before update on public.safe_zones
for each row execute function public.touch_updated_at();

drop trigger if exists push_subscriptions_touch_updated_at on public.push_subscriptions;
create trigger push_subscriptions_touch_updated_at
before update on public.push_subscriptions
for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.safe_zones enable row level security;
alter table public.location_pings enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.care_responses enable row level security;
alter table public.patient_devices enable row level security;
alter table public.pairing_sessions enable row level security;

create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = auth.uid()
  );
$$;

drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self" on public.profiles
for select using (id = auth.uid());

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
for insert with check (id = auth.uid());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "households_select_member" on public.households;
create policy "households_select_member" on public.households
for select using (owner_id = auth.uid() or public.is_household_member(id));

drop policy if exists "households_insert_owner" on public.households;
create policy "households_insert_owner" on public.households
for insert with check (owner_id = auth.uid());

drop policy if exists "households_update_member" on public.households;
create policy "households_update_member" on public.households
for update using (public.is_household_member(id)) with check (public.is_household_member(id));

drop policy if exists "members_select_member" on public.household_members;
create policy "members_select_member" on public.household_members
for select using (public.is_household_member(household_id));

drop policy if exists "members_insert_self" on public.household_members;
create policy "members_insert_self" on public.household_members
for insert with check (user_id = auth.uid());

drop policy if exists "members_update_self" on public.household_members;
create policy "members_update_self" on public.household_members
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "zones_member_all" on public.safe_zones;
create policy "zones_member_all" on public.safe_zones
for all using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

drop policy if exists "pings_select_member" on public.location_pings;
create policy "pings_select_member" on public.location_pings
for select using (public.is_household_member(household_id));

drop policy if exists "push_member_all" on public.push_subscriptions;
create policy "push_member_all" on public.push_subscriptions
for all using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

drop policy if exists "responses_member_all" on public.care_responses;
create policy "responses_member_all" on public.care_responses
for all using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

drop policy if exists "devices_select_member" on public.patient_devices;
create policy "devices_select_member" on public.patient_devices
for select using (public.is_household_member(household_id));

drop policy if exists "pairing_select_member" on public.pairing_sessions;
create policy "pairing_select_member" on public.pairing_sessions
for select using (public.is_household_member(household_id));

do $$ begin
  alter publication supabase_realtime add table public.households;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.household_members;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.safe_zones;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.location_pings;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.care_responses;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.patient_devices;
exception when duplicate_object then null;
end $$;
