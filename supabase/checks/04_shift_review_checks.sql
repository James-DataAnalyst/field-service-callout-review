-- Run after the shift review migration. The test data is rolled back.
begin;

insert into auth.users (id, email) values
    ('00000000-0000-4000-b000-000000000101', 'match-test-admin@example.com'),
    ('00000000-0000-4000-b000-000000000102', 'match-test-manager@example.com'),
    ('00000000-0000-4000-b000-000000000103', 'match-test-unassigned@example.com');

insert into public.organizations (id, name) values
    ('00000000-0000-4000-b000-000000000201', 'Matching test company'),
    ('00000000-0000-4000-b000-000000000202', 'Matching test other company');

insert into public.sites (id, organization_id, name, site_code) values
    ('00000000-0000-4000-b000-000000000301', '00000000-0000-4000-b000-000000000201', 'Main', 'MATCH_MAIN'),
    ('00000000-0000-4000-b000-000000000302', '00000000-0000-4000-b000-000000000201', 'Second', 'MATCH_SECOND'),
    ('00000000-0000-4000-b000-000000000303', '00000000-0000-4000-b000-000000000202', 'Foreign', 'MATCH_FOREIGN');

insert into public.organization_admins (user_id, organization_id) values
    ('00000000-0000-4000-b000-000000000101', '00000000-0000-4000-b000-000000000201');

insert into public.site_managers (user_id, site_id) values
    ('00000000-0000-4000-b000-000000000102', '00000000-0000-4000-b000-000000000301');

insert into public.import_runs (
    id, organization_id, kind, status, received_count, inserted_count, duplicate_count, issue_count, issues
) values
    ('00000000-0000-4000-b000-000000000501', '00000000-0000-4000-b000-000000000201', 'shifts', 'completed', 6, 6, 0, 0, '[]'),
    ('00000000-0000-4000-b000-000000000502', '00000000-0000-4000-b000-000000000202', 'shifts', 'completed', 1, 1, 0, 0, '[]');

insert into public.shift_roster (
    organization_id, site_id, shift_reference, technician_code, starts_at, ends_at, import_run_id
)
select s.organization_id, s.id, f.reference, f.technician, f.starts::timestamptz, f.ends::timestamptz,
    case when f.site = 'MATCH_FOREIGN'
        then '00000000-0000-4000-b000-000000000502'::uuid
        else '00000000-0000-4000-b000-000000000501'::uuid
    end
from (values
    ('MATCH_MAIN', 'QA-SH-DAY', 'TECH-1', '2026-11-05T07:00:00Z', '2026-11-05T15:00:00Z'),
    ('MATCH_MAIN', 'QA-SH-OVERLAP', 'TECH-1', '2026-11-05T11:00:00Z', '2026-11-05T13:00:00Z'),
    ('MATCH_MAIN', 'QA-SH-EVENING', 'TECH-1', '2026-11-05T15:00:00Z', '2026-11-05T19:00:00Z'),
    ('MATCH_MAIN', 'QA-SH-NIGHT', 'TECH-2', '2026-11-05T18:00:00Z', '2026-11-06T06:00:00Z'),
    ('MATCH_SECOND', 'QA-SH-SECOND', 'TECH-1', '2026-11-05T04:00:00Z', '2026-11-05T06:00:00Z'),
    ('MATCH_MAIN', 'QA-SH-OTHER-TECH', 'TECH-9', '2026-11-05T20:00:00Z', '2026-11-05T22:00:00Z'),
    ('MATCH_FOREIGN', 'QA-SH-FOREIGN', 'TECH-1', '2026-11-05T03:00:00Z', '2026-11-05T04:00:00Z')
) as f(site, reference, technician, starts, ends)
join public.sites s on s.site_code = f.site
    and s.organization_id in ('00000000-0000-4000-b000-000000000201', '00000000-0000-4000-b000-000000000202');

insert into public.callouts (organization_id, site_id, dispatch_reference, technician_code, occurred_at)
select s.organization_id, s.id, f.reference, f.technician, f.occurred::timestamptz
from (values
    ('MATCH_MAIN', 'QA-SINGLE', 'TECH-1', '2026-11-05T08:15:00Z'),
    ('MATCH_MAIN', 'QA-START', 'TECH-1', '2026-11-05T07:00:00Z'),
    ('MATCH_MAIN', 'QA-BOUNDARY', 'TECH-1', '2026-11-05T15:00:00Z'),
    ('MATCH_MAIN', 'QA-NIGHT', 'TECH-2', '2026-11-06T01:05:00Z'),
    ('MATCH_MAIN', 'QA-OVERLAP', 'TECH-1', '2026-11-05T12:20:00Z'),
    ('MATCH_MAIN', 'QA-WRONG-SITE', 'TECH-1', '2026-11-05T05:15:00Z'),
    ('MATCH_MAIN', 'QA-WRONG-COMPANY', 'TECH-1', '2026-11-05T03:30:00Z'),
    ('MATCH_MAIN', 'QA-WRONG-TECH', 'TECH-1', '2026-11-05T21:15:00Z'),
    ('MATCH_MAIN', 'QA-END', 'TECH-1', '2026-11-05T19:00:00Z'),
    ('MATCH_MAIN', 'QA-LEGACY', null, '2026-11-05T08:15:00Z'),
    ('MATCH_SECOND', 'QA-SECOND-SITE', 'TECH-1', '2026-11-05T05:15:00Z'),
    ('MATCH_FOREIGN', 'QA-FOREIGN', 'TECH-1', '2026-11-05T03:30:00Z')
) as f(site, reference, technician, occurred)
join public.sites s on s.site_code = f.site
    and s.organization_id in ('00000000-0000-4000-b000-000000000201', '00000000-0000-4000-b000-000000000202');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-000000000101';

do $checks$
begin
    if not exists (
        select 1 from public.callout_shift_review
        where dispatch_reference = 'QA-SINGLE' and match_status = 'matched'
            and candidate_count = 1 and matched_shift_id is not null and matched_shift_reference = 'QA-SH-DAY'
            and shift_starts_at = '2026-11-05T07:00:00Z'::timestamptz
            and shift_ends_at = '2026-11-05T15:00:00Z'::timestamptz
    ) then
        raise exception 'Check 1 failed: the single eligible shift was not returned.';
    end if;
    if not exists (
        select 1 from public.callout_shift_review where dispatch_reference = 'QA-START' and matched_shift_reference = 'QA-SH-DAY'
    ) then
        raise exception 'Check 2 failed: an event at shift start did not match.';
    end if;
    if not exists (
        select 1 from public.callout_shift_review where dispatch_reference = 'QA-BOUNDARY'
            and match_status = 'matched' and candidate_count = 1 and matched_shift_reference = 'QA-SH-EVENING'
    ) then
        raise exception 'Check 3 failed: the ending shift competed with the next shift.';
    end if;
    if not exists (
        select 1 from public.callout_shift_review where dispatch_reference = 'QA-NIGHT' and matched_shift_reference = 'QA-SH-NIGHT'
    ) then
        raise exception 'Check 4 failed: a shift spanning midnight did not match.';
    end if;
    if not exists (
        select 1 from public.callout_shift_review where dispatch_reference = 'QA-OVERLAP'
            and match_status = 'overlap' and candidate_count = 2 and matched_shift_id is null
            and matched_shift_reference is null and shift_starts_at is null and shift_ends_at is null
    ) then
        raise exception 'Check 5 failed: an overlapping shift was chosen automatically.';
    end if;
    if (select count(*) from public.callout_shift_review
        where dispatch_reference in ('QA-END', 'QA-WRONG-SITE', 'QA-WRONG-COMPANY', 'QA-WRONG-TECH')
            and match_status = 'no_shift' and candidate_count = 0 and matched_shift_id is null) <> 4 then
        raise exception 'Check 6 failed: an ineligible shift counted as a candidate.';
    end if;
    if not exists (
        select 1 from public.callout_shift_review where dispatch_reference = 'QA-LEGACY'
            and match_status = 'missing_technician' and candidate_count = 0
    ) then
        raise exception 'Check 7 failed: a legacy callout did not retain its missing-code status.';
    end if;
    if not exists (select 1 from public.callout_shift_review where dispatch_reference = 'QA-SECOND-SITE')
        or exists (select 1 from public.callout_shift_review where dispatch_reference = 'QA-FOREIGN') then
        raise exception 'Check 8 failed: company administrator visibility is incorrect.';
    end if;
end;
$checks$;

set local request.jwt.claim.sub = '00000000-0000-4000-b000-000000000102';
do $checks$
begin
    if not exists (select 1 from public.callout_shift_review where dispatch_reference = 'QA-SINGLE')
        or exists (select 1 from public.callout_shift_review where site_name <> 'Main') then
        raise exception 'Check 9 failed: the site manager did not see only their site.';
    end if;
end;
$checks$;

set local request.jwt.claim.sub = '00000000-0000-4000-b000-000000000103';
do $checks$
begin
    if exists (select 1 from public.callout_shift_review) then
        raise exception 'Check 10 failed: a signed-in user without assignments could see matches.';
    end if;
end;
$checks$;

set local request.jwt.claim.sub = '';
set local role anon;
do $checks$
begin
    begin
        perform 1 from public.callout_shift_review limit 1;
        raise exception 'Check 11 failed: an anonymous caller could read shift review.';
    exception when insufficient_privilege then
        null;
    end;
end;
$checks$;

-- The view reads the current roster. A newly imported shift can resolve an exception.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-000000000101';
do $checks$
begin
    perform public.import_field_csv('00000000-0000-4000-b000-000000000201', 'shifts', '[{
        "shift_reference":"QA-SH-LATER", "site_code":"MATCH_MAIN", "technician_code":"TECH-1",
        "starts_at":"2026-11-05T19:00:00Z", "ends_at":"2026-11-05T20:00:00Z"
    }]');
    if not exists (
        select 1 from public.callout_shift_review where dispatch_reference = 'QA-END'
            and match_status = 'matched' and matched_shift_reference = 'QA-SH-LATER'
    ) then
        raise exception 'Check 12 failed: the view did not reflect the new roster import.';
    end if;
end;
$checks$;

reset role;
set constraints all immediate;
select 'PASS: 12 shift matching checks' as result;
rollback;
