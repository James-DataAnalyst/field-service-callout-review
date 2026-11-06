-- Temporary fixtures for approvals, exports, and account access.
begin;

insert into auth.users (id, email) values
    ('00000000-0000-4000-c000-000000000101', 'approve-test-manager@example.com'),
    ('00000000-0000-4000-c000-000000000102', 'approve-test-admin@example.com'),
    ('00000000-0000-4000-c000-000000000103', 'approve-test-other@example.com');

insert into public.organizations (id, name) values
    ('00000000-0000-4000-c000-000000000201', 'Approval test company'),
    ('00000000-0000-4000-c000-000000000202', 'Approval test other company');

insert into public.sites (id, organization_id, name, site_code) values
    ('00000000-0000-4000-c000-000000000301', '00000000-0000-4000-c000-000000000201', 'Main', 'AP_MAIN'),
    ('00000000-0000-4000-c000-000000000302', '00000000-0000-4000-c000-000000000201', 'Second', 'AP_SECOND'),
    ('00000000-0000-4000-c000-000000000303', '00000000-0000-4000-c000-000000000202', 'Foreign', 'AP_FOREIGN');

insert into public.site_managers (user_id, site_id) values
    ('00000000-0000-4000-c000-000000000101', '00000000-0000-4000-c000-000000000301'),
    ('00000000-0000-4000-c000-000000000103', '00000000-0000-4000-c000-000000000303');

insert into public.organization_admins (user_id, organization_id) values
    ('00000000-0000-4000-c000-000000000102', '00000000-0000-4000-c000-000000000201'),
    ('00000000-0000-4000-c000-000000000103', '00000000-0000-4000-c000-000000000202');

insert into callout_private.company_allowance_rates (organization_id, amount_minor, currency)
values ('00000000-0000-4000-c000-000000000201', 2500, 'GBP');

insert into public.import_runs (
    id, organization_id, kind, status, received_count, inserted_count, duplicate_count, issue_count, issues
) values
    ('00000000-0000-4000-c000-000000000501', '00000000-0000-4000-c000-000000000201', 'shifts', 'completed', 3, 3, 0, 0, '[]'),
    ('00000000-0000-4000-c000-000000000502', '00000000-0000-4000-c000-000000000202', 'shifts', 'completed', 1, 1, 0, 0, '[]');

insert into public.shift_roster (
    id, organization_id, site_id, shift_reference, technician_code, starts_at, ends_at, import_run_id
)
select f.id::uuid, s.organization_id, s.id, f.reference, 'TECH-1', f.starts::timestamptz, f.ends::timestamptz,
       case when f.site = 'AP_FOREIGN' then '00000000-0000-4000-c000-000000000502'::uuid
            else '00000000-0000-4000-c000-000000000501'::uuid end
from (values
    ('00000000-0000-4000-c000-000000000601', 'AP_MAIN', 'AP-SH-MAIN', '2026-11-05T07:00:00Z', '2026-11-05T15:00:00Z'),
    ('00000000-0000-4000-c000-000000000602', 'AP_MAIN', 'AP-SH-OVERLAP', '2026-11-05T11:00:00Z', '2026-11-05T13:00:00Z'),
    ('00000000-0000-4000-c000-000000000603', 'AP_SECOND', 'AP-SH-SECOND', '2026-11-05T07:00:00Z', '2026-11-05T15:00:00Z'),
    ('00000000-0000-4000-c000-000000000604', 'AP_FOREIGN', 'AP-SH-FOREIGN', '2026-11-05T07:00:00Z', '2026-11-05T15:00:00Z')
) as f(id, site, reference, starts, ends)
join public.sites s on s.site_code = f.site
    and s.organization_id in ('00000000-0000-4000-c000-000000000201', '00000000-0000-4000-c000-000000000202');

insert into public.callouts (id, organization_id, site_id, dispatch_reference, technician_code, occurred_at)
select f.id::uuid, s.organization_id, s.id, f.reference, f.technician, f.occurred::timestamptz
from (values
    ('00000000-0000-4000-c000-000000000401', 'AP_MAIN', 'AP-ELIGIBLE', 'TECH-1', '2026-11-05T08:15:00Z'),
    ('00000000-0000-4000-c000-000000000402', 'AP_MAIN', 'AP-OVERLAP', 'TECH-1', '2026-11-05T12:20:00Z'),
    ('00000000-0000-4000-c000-000000000403', 'AP_MAIN', 'AP-NO-SHIFT', 'TECH-1', '2026-11-05T15:00:00Z'),
    ('00000000-0000-4000-c000-000000000404', 'AP_MAIN', 'AP-LEGACY', null, '2026-11-05T08:15:00Z'),
    ('00000000-0000-4000-c000-000000000405', 'AP_SECOND', 'AP-SECOND', 'TECH-1', '2026-11-05T08:15:00Z'),
    ('00000000-0000-4000-c000-000000000406', 'AP_FOREIGN', 'AP-FOREIGN', 'TECH-1', '2026-11-05T08:15:00Z')
) as f(id, site, reference, technician, occurred)
join public.sites s on s.site_code = f.site
    and s.organization_id in ('00000000-0000-4000-c000-000000000201', '00000000-0000-4000-c000-000000000202');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-c000-000000000101';

do $checks$
declare
    company constant uuid := '00000000-0000-4000-c000-000000000201';
    eligible constant uuid := '00000000-0000-4000-c000-000000000401';
    day_shift constant uuid := '00000000-0000-4000-c000-000000000601';
    target uuid;
    result jsonb;
    first_approval text;
begin
    -- 1. A stale shift shown in the UI cannot be used for approval.
    begin
        perform public.approve_callout(eligible, '00000000-0000-4000-c000-000000000602');
        raise exception 'Check 1 failed: a stale shift was accepted.';
    exception when sqlstate 'P0AP1' then null;
    end;

    -- 2. Overlap, no shift, and missing technician require review.
    foreach target in array array[
        '00000000-0000-4000-c000-000000000402',
        '00000000-0000-4000-c000-000000000403',
        '00000000-0000-4000-c000-000000000404'
    ]::uuid[] loop
        begin
            perform public.approve_callout(target, day_shift);
            raise exception 'Check 2 failed: a callout without a single match was approved.';
        exception when sqlstate 'P0AP1' then null;
        end;
    end loop;

    -- 3. A manager cannot approve another site, even within their company.
    foreach target in array array[
        '00000000-0000-4000-c000-000000000405',
        '00000000-0000-4000-c000-000000000406'
    ]::uuid[] loop
        begin
            perform public.approve_callout(target, day_shift);
            raise exception 'Check 3 failed: approval crossed a site or company boundary.';
        exception when insufficient_privilege then null;
        end;
    end loop;

    -- 4. A valid approval records the shift, actor, rate, and time.
    result := public.approve_callout(eligible, day_shift);
    first_approval := result ->> 'approved_at';
    if (result ->> 'created')::boolean is distinct from true or first_approval is null
        or not exists (select 1 from public.callout_approvals where callout_id = eligible
            and shift_id = day_shift and shift_reference = 'AP-SH-MAIN'
            and approved_by = auth.uid() and approver_label = 'approve-test-manager@example.com'
            and currency = 'GBP' and amount_minor = 2500) then
        raise exception 'Check 4 failed: the approval snapshot is incomplete.';
    end if;

    -- 5. A retry returns the original approval instead of creating another one.
    result := public.approve_callout(eligible, day_shift);
    if (result ->> 'created')::boolean is distinct from false
        or result ->> 'approved_at' is distinct from first_approval
        or (select count(*) from public.callout_approvals where callout_id = eligible) <> 1 then
        raise exception 'Check 5 failed: approval retry was not idempotent.';
    end if;

    -- 6. Approval rows cannot be edited directly by a signed-in manager.
    begin
        update public.callout_approvals set amount_minor = 10000 where callout_id = eligible;
        raise exception 'Check 6 failed: a manager could edit an approval.';
    exception when insufficient_privilege then null;
    end;

    -- 7. Viewing a site approval does not grant permission to export the company.
    begin
        perform public.get_approved_callout_export(company);
        raise exception 'Check 7 failed: a site manager could export the company.';
    exception when insufficient_privilege then null;
    end;
end;
$checks$;

set local request.jwt.claim.sub = '00000000-0000-4000-c000-000000000102';
do $checks$
declare
    company constant uuid := '00000000-0000-4000-c000-000000000201';
    exported jsonb;
begin
    -- 8. Company administrators can export only their approved snapshots.
    exported := public.get_approved_callout_export(company);
    if jsonb_array_length(exported) <> 1
        or exported #>> '{0,dispatch_reference}' is distinct from 'AP-ELIGIBLE'
        or exported #>> '{0,shift_reference}' is distinct from 'AP-SH-MAIN'
        or (exported #>> '{0,amount_minor}')::integer is distinct from 2500
        or not exists (select 1 from public.callout_approval_totals where organization_id = company
            and currency = 'GBP' and approved_count = 1 and total_minor = 2500) then
        raise exception 'Check 8 failed: the export and approval total do not agree.';
    end if;

    -- 9. An administrator still needs the site manager assignment to approve.
    begin
        perform public.approve_callout('00000000-0000-4000-c000-000000000405', '00000000-0000-4000-c000-000000000603');
        raise exception 'Check 9 failed: the operations admin bypassed the site manager.';
    exception when insufficient_privilege then null;
    end;
end;
$checks$;

set local request.jwt.claim.sub = '00000000-0000-4000-c000-000000000103';
do $checks$
begin
    -- 10. A different company sees no approval and cannot export this company.
    if exists (select 1 from public.callout_approvals) then
        raise exception 'Check 10 failed: another company can read this approval.';
    end if;
    begin
        perform public.get_approved_callout_export('00000000-0000-4000-c000-000000000201');
        raise exception 'Check 10 failed: an admin exported another company.';
    exception when insufficient_privilege then null;
    end;

    -- 11. A company must have a rate before its managers can record an allowance.
    begin
        perform public.approve_callout('00000000-0000-4000-c000-000000000406', '00000000-0000-4000-c000-000000000604');
        raise exception 'Check 11 failed: an approval was recorded without a rate.';
    exception when sqlstate 'P0AP2' then null;
    end;
end;
$checks$;

reset role;
update callout_private.company_allowance_rates set amount_minor = 3000
where organization_id = '00000000-0000-4000-c000-000000000201';

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-c000-000000000102';
do $checks$
declare
    company constant uuid := '00000000-0000-4000-c000-000000000201';
    exported jsonb;
begin
    -- 12. A later roster import or rate change cannot rewrite the recorded approval.
    perform public.import_field_csv(company, 'shifts', '[{
        "shift_reference":"AP-SH-LATER", "site_code":"AP_MAIN", "technician_code":"TECH-1",
        "starts_at":"2026-11-05T08:00:00Z", "ends_at":"2026-11-05T09:00:00Z"
    }]');
    exported := public.get_approved_callout_export(company);
    if not exists (select 1 from public.callout_shift_review where dispatch_reference = 'AP-ELIGIBLE' and match_status = 'overlap')
        or exported #>> '{0,shift_reference}' is distinct from 'AP-SH-MAIN'
        or (exported #>> '{0,amount_minor}')::integer is distinct from 2500 then
        raise exception 'Check 12 failed: a later change rewrote a recorded approval.';
    end if;
end;
$checks$;

set local request.jwt.claim.sub = '';
set local role anon;
do $checks$
begin
    -- 13. Signed-out clients cannot call either approval function.
    begin
        perform public.approve_callout(null, null);
        raise exception 'Check 13 failed: an anonymous caller could approve.';
    exception when insufficient_privilege then null;
    end;
    begin
        perform public.get_approved_callout_export(null);
        raise exception 'Check 13 failed: an anonymous caller could export.';
    exception when insufficient_privilege then null;
    end;
end;
$checks$;

reset role;
set constraints all immediate;
select 'PASS: 13 approval and export checks' as result;
rollback;
