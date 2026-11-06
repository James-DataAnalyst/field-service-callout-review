-- Match each visible callout against the current roster.
begin;

create view public.callout_shift_review
with (security_invoker = true)
as
select
    c.id,
    c.organization_id,
    c.site_id,
    o.name as organization_name,
    s.name as site_name,
    c.dispatch_reference,
    c.technician_code,
    c.occurred_at,
    case
        when c.technician_code is null then 'missing_technician'
        when candidates.candidate_count = 0 then 'no_shift'
        when candidates.candidate_count = 1 then 'matched'
        else 'overlap'
    end as match_status,
    candidates.candidate_count,
    case when candidates.candidate_count = 1 then candidates.shift_id end as matched_shift_id,
    case when candidates.candidate_count = 1 then candidates.shift_reference end as matched_shift_reference,
    case when candidates.candidate_count = 1 then candidates.starts_at end as shift_starts_at,
    case when candidates.candidate_count = 1 then candidates.ends_at end as shift_ends_at
from public.callouts c
join public.sites s on s.id = c.site_id and s.organization_id = c.organization_id
join public.organizations o on o.id = c.organization_id
cross join lateral (
    select count(*)::integer as candidate_count,
           min(r.id::text)::uuid as shift_id,
           min(r.shift_reference) as shift_reference,
           min(r.starts_at) as starts_at,
           min(r.ends_at) as ends_at
    from public.shift_roster r
    where r.organization_id = c.organization_id
      and r.site_id = c.site_id
      and r.technician_code = c.technician_code
      -- The roster limits shifts to 24 hours. Bound the index lookup to that window.
      and r.starts_at > c.occurred_at - interval '24 hours'
      and r.starts_at <= c.occurred_at
      and r.ends_at > c.occurred_at
) candidates;

revoke all on public.callout_shift_review from public, anon, authenticated;
grant select on public.callout_shift_review to authenticated;

notify pgrst, 'reload schema';
commit;
