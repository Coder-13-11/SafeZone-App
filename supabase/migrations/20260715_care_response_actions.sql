-- Extend care response statuses for I’m going / I can’t / Take over.
alter type public.care_response_status add value if not exists 'declined';
alter type public.care_response_status add value if not exists 'takeover';
