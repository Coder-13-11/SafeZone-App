-- Run this entire file once in Supabase → SQL Editor.
-- Makes real QR pairing + patient location tracking work without Edge Functions.

create extension if not exists pgcrypto with schema extensions;

drop policy if exists "pairing_insert_member" on public.pairing_sessions;
create policy "pairing_insert_member" on public.pairing_sessions
for insert with check (
  public.is_household_member(household_id)
  and created_by = auth.uid()
);

create or replace function public.sha256_hex(value text)
returns text
language sql
immutable
as $$
  select encode(extensions.digest(convert_to(value, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function public.random_url_token()
returns text
language plpgsql
as $$
declare
  raw text;
begin
  raw := encode(extensions.gen_random_bytes(32), 'base64');
  raw := replace(replace(raw, '+', '-'), '/', '_');
  raw := rtrim(raw, '=');
  return raw;
end;
$$;

create or replace function public.claim_pairing_token(
  p_household_id uuid,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  pairing public.pairing_sessions%rowtype;
  device_token text;
  device_id uuid;
  claimed_ts timestamptz := now();
  household_row public.households%rowtype;
  caregiver_label text;
begin
  if p_household_id is null or coalesce(p_token, '') = '' then
    raise exception 'householdId and token are required.';
  end if;

  select *
  into pairing
  from public.pairing_sessions ps
  where ps.household_id = p_household_id
    and ps.token_hash = public.sha256_hex(p_token)
    and ps.claimed_at is null
    and ps.expires_at > now()
  order by ps.created_at desc
  limit 1;

  if pairing.id is null then
    raise exception 'This pairing link is invalid or has expired.';
  end if;

  update public.patient_devices
  set replaced_at = claimed_ts
  where household_id = p_household_id
    and replaced_at is null;

  device_token := public.random_url_token();

  insert into public.patient_devices (household_id, token_hash)
  values (p_household_id, public.sha256_hex(device_token))
  returning id into device_id;

  update public.pairing_sessions
  set claimed_at = claimed_ts
  where id = pairing.id;

  update public.households
  set paired_at = claimed_ts
  where id = p_household_id
  returning * into household_row;

  select hm.caregiver_label
  into caregiver_label
  from public.household_members hm
  where hm.household_id = p_household_id
  order by hm.created_at asc
  limit 1;

  return jsonb_build_object(
    'deviceToken', device_token,
    'deviceId', device_id,
    'household', jsonb_build_object(
      'id', household_row.id,
      'patientName', household_row.patient_name,
      'caregiverName', coalesce(caregiver_label, ''),
      'pairedAt', household_row.paired_at,
      'relationship', household_row.patient_relationship,
      'geofenceState', household_row.geofence_state
    )
  );
end;
$$;

-- Claim a pairing session with only the short 6-digit code (no household id needed).
-- Used by the "type a code instead of scanning" fallback on the patient phone.
create or replace function public.claim_pairing_code(
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_household uuid;
begin
  if coalesce(p_code, '') = '' then
    raise exception 'A pairing code is required.';
  end if;

  select ps.household_id
  into target_household
  from public.pairing_sessions ps
  where ps.token_hash = public.sha256_hex(p_code)
    and ps.claimed_at is null
    and ps.expires_at > now()
  order by ps.created_at desc
  limit 1;

  if target_household is null then
    raise exception 'This pairing code is invalid or has expired. Ask the caregiver for a fresh code.';
  end if;

  return public.claim_pairing_token(target_household, p_code);
end;
$$;

create or replace function public.get_patient_tracking_context(
  p_household_id uuid,
  p_device_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  device public.patient_devices%rowtype;
  household_row public.households%rowtype;
  zones jsonb;
begin
  select *
  into device
  from public.patient_devices
  where household_id = p_household_id
    and replaced_at is null
    and token_hash = public.sha256_hex(p_device_token)
  limit 1;

  if device.id is null then
    raise exception 'This patient phone is not paired with the household.';
  end if;

  select * into household_row from public.households where id = p_household_id;
  if household_row.id is null then
    raise exception 'Household not found.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', z.id,
        'householdId', z.household_id,
        'name', z.name,
        'color', z.color,
        'points', z.points,
        'isActive', z.is_active
      )
    ),
    '[]'::jsonb
  )
  into zones
  from public.safe_zones z
  where z.household_id = p_household_id
    and z.is_active = true;

  return jsonb_build_object(
    'deviceId', device.id,
    'patientName', household_row.patient_name,
    'geofenceState', household_row.geofence_state,
    'graceStartedAt', household_row.grace_started_at,
    'alertSentForExit', household_row.alert_sent_for_exit,
    'zones', zones
  );
end;
$$;

create or replace function public.ingest_patient_location(
  p_household_id uuid,
  p_device_token text,
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision,
  p_battery integer,
  p_state text,
  p_zone_id uuid,
  p_distance_to_boundary_m double precision,
  p_grace_ends_at timestamptz,
  p_grace_started_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  device public.patient_devices%rowtype;
  previous_state text;
  ping_id uuid;
  ping_created timestamptz;
begin
  if p_household_id is null or coalesce(p_device_token, '') = '' then
    raise exception 'householdId and device token are required.';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'lat and lng are required.';
  end if;
  if p_state is null or p_state not in ('unknown', 'safe', 'caution', 'grace', 'alert') then
    raise exception 'Invalid geofence state.';
  end if;

  select *
  into device
  from public.patient_devices
  where household_id = p_household_id
    and replaced_at is null
    and token_hash = public.sha256_hex(p_device_token)
  limit 1;

  if device.id is null then
    raise exception 'This patient phone is not paired with the household.';
  end if;

  select geofence_state into previous_state from public.households where id = p_household_id;

  -- Free-plan safeguard: keep only the last 48 hours of pings per household so
  -- the database never grows past a few MB. Uses the
  -- location_pings_household_recent_idx index, so this is a cheap no-op when
  -- there is nothing to delete.
  delete from public.location_pings
  where household_id = p_household_id
    and created_at < now() - interval '48 hours';

  insert into public.location_pings (
    household_id,
    patient_device_id,
    lat,
    lng,
    accuracy,
    battery,
    state_at_time,
    zone_id,
    distance_to_boundary_m,
    grace_ends_at
  )
  values (
    p_household_id,
    device.id,
    p_lat,
    p_lng,
    p_accuracy,
    p_battery,
    p_state::public.geofence_state,
    p_zone_id,
    p_distance_to_boundary_m,
    p_grace_ends_at
  )
  returning id, created_at into ping_id, ping_created;

  update public.patient_devices
  set last_seen_at = ping_created
  where id = device.id;

  update public.households
  set
    geofence_state = p_state::public.geofence_state,
    grace_started_at = p_grace_started_at,
    alert_sent_for_exit = (p_state = 'alert')
  where id = p_household_id;

  return jsonb_build_object(
    'id', ping_id,
    'timestamp', ping_created,
    'state', p_state,
    'previousState', coalesce(previous_state, 'unknown'),
    'graceEndsAt', p_grace_ends_at
  );
end;
$$;

revoke all on function public.claim_pairing_token(uuid, text) from public;
revoke all on function public.claim_pairing_code(text) from public;
revoke all on function public.get_patient_tracking_context(uuid, text) from public;
revoke all on function public.ingest_patient_location(uuid, text, double precision, double precision, double precision, integer, text, uuid, double precision, timestamptz, timestamptz) from public;

grant execute on function public.claim_pairing_token(uuid, text) to anon, authenticated;
grant execute on function public.claim_pairing_code(text) to anon, authenticated;
grant execute on function public.get_patient_tracking_context(uuid, text) to anon, authenticated;
grant execute on function public.ingest_patient_location(uuid, text, double precision, double precision, double precision, integer, text, uuid, double precision, timestamptz, timestamptz) to anon, authenticated;
