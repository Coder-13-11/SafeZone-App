-- Run this once in Supabase → SQL Editor so pairing QR codes work
-- even if Edge Functions are not deployed yet.

drop policy if exists "pairing_insert_member" on public.pairing_sessions;
create policy "pairing_insert_member" on public.pairing_sessions
for insert with check (
  public.is_household_member(household_id)
  and created_by = auth.uid()
);
