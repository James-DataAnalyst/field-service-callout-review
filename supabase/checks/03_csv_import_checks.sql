-- Run the whole script in the SQL Editor after the CSV import migration.
-- All test companies, accounts, rows, and run history are rolled back.
begin;

insert into auth.users (id, email) values
    ('00000000-0000-4000-a000-000000000101', 'import-test-admin@example.com'),
    ('00000000-0000-4000-a000-000000000102', 'import-test-manager@example.com'),
    ('00000000-0000-4000-a000-000000000103', 'import-test-foreign@example.com');

insert into public.organizations (id, name) values
    ('00000000-0000-4000-a000-000000000201', 'Import test company'),
    ('00000000-0000-4000-a000-000000000202', 'Import test other company');

insert into public.sites (id, organization_id, name, site_code) values
    ('00000000-0000-4000-a000-000000000301', '00000000-0000-4000-a000-000000000201', 'Main', 'MAIN'),
    ('00000000-0000-4000-a000-000000000302', '00000000-0000-4000-a000-000000000202', 'Foreign', 'FOREIGN');

insert into public.organization_admins (user_id, organization_id) values
    ('00000000-0000-4000-a000-000000000101', '00000000-0000-4000-a000-000000000201'),
    ('00000000-0000-4000-a000-000000000103', '00000000-0000-4000-a000-000000000202');

insert into public.site_managers (user_id, site_id) values
    ('00000000-0000-4000-a000-000000000102', '00000000-0000-4000-a000-000000000301');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-000000000101';

do $checks$
declare
    company constant uuid := '00000000-0000-4000-a000-000000000201';
    other_company constant uuid := '00000000-0000-4000-a000-000000000202';
    callout constant jsonb := '{
      "dispatch_reference": "QA-1", "site_code": "MAIN", "technician_code": "TECH-1",
      "occurred_at": "2026-11-05T20:10:00Z"
    }';
    shift constant jsonb := '{
      "shift_reference": "QA-SH-1", "site_code": "MAIN", "technician_code": "TECH-1",
      "starts_at": "2026-11-05T18:00:00Z", "ends_at": "2026-11-06T06:00:00Z"
    }';
    report jsonb;
begin
    -- 1. A valid upload saves rows and ties them to the correct run and uploader.
    report := public.import_field_csv(company, 'callouts', jsonb_build_array(callout));
    if report ->> 'status' is distinct from 'completed'
        or (report ->> 'inserted')::integer is distinct from 1
        or not exists (
            select 1 from public.callouts c
            join public.import_runs r on r.id = c.import_run_id and r.organization_id = c.organization_id
            where c.dispatch_reference = 'QA-1' and r.id = (report ->> 'run_id')::uuid
                and r.imported_by = auth.uid()
        ) then
        raise exception 'Check 1 failed: a valid callout was not saved with its import run.';
    end if;

    -- 2. A retry skips the exact same record.
    report := public.import_field_csv(company, 'callouts', jsonb_build_array(callout));
    if (report ->> 'inserted')::integer is distinct from 0
        or (report ->> 'duplicates')::integer is distinct from 1
        or (select count(*) from public.callouts where dispatch_reference = 'QA-1') <> 1 then
        raise exception 'Check 2 failed: an exact retry added a duplicate.';
    end if;

    -- 3. An exact repeat inside a file is counted only once.
    report := public.import_field_csv(company, 'callouts', jsonb_build_array(
        callout || '{"dispatch_reference":"QA-2"}', callout || '{"dispatch_reference":"QA-2"}'
    ));
    if (report ->> 'inserted')::integer is distinct from 1
        or (report ->> 'duplicates')::integer is distinct from 1 then
        raise exception 'Check 3 failed: repeated rows within one file were not handled.';
    end if;

    -- 4. A site from another company rejects the full file and logs the failed run.
    report := public.import_field_csv(company, 'callouts', jsonb_build_array(
        callout || '{"dispatch_reference":"QA-ROLLBACK"}',
        callout || '{"dispatch_reference":"QA-FOREIGN","site_code":"FOREIGN"}'
    ));
    if report ->> 'status' is distinct from 'rejected'
        or (report #>> '{issues,0,row}')::integer is distinct from 2
        or exists (select 1 from public.callouts where dispatch_reference = 'QA-ROLLBACK')
        or not exists (
            select 1 from public.import_runs
            where id = (report ->> 'run_id')::uuid and status = 'rejected' and inserted_count = 0
        ) then
        raise exception 'Check 4 failed: the foreign site did not cause a logged rollback.';
    end if;

    -- 5. A reused reference with different details cannot overwrite the original.
    report := public.import_field_csv(company, 'callouts', jsonb_build_array(
        callout || '{"dispatch_reference":"QA-ROLLBACK"}',
        callout || '{"occurred_at":"2026-11-05T20:11:00Z"}'
    ));
    if report ->> 'status' is distinct from 'rejected'
        or exists (select 1 from public.callouts where dispatch_reference = 'QA-ROLLBACK')
        or (select occurred_at from public.callouts where dispatch_reference = 'QA-1')
            is distinct from '2026-11-05T20:10:00Z'::timestamptz then
        raise exception 'Check 5 failed: the changed duplicate did not preserve the original record.';
    end if;

    -- 6. A timestamp can match the format and still have an impossible date.
    report := public.import_field_csv(company, 'callouts', jsonb_build_array(
        callout || '{"dispatch_reference":"QA-BAD-DATE","occurred_at":"2026-02-30T20:10:00Z"}'
    ));
    if report ->> 'status' is distinct from 'rejected'
        or report #>> '{issues,0,message}' is distinct from 'The timestamp does not contain a valid calendar date.' then
        raise exception 'Check 6 failed: an impossible date was not explained.';
    end if;

    -- 7. An overnight shift is valid and a retry does not add a second one.
    report := public.import_field_csv(company, 'shifts', jsonb_build_array(shift));
    if (report ->> 'inserted')::integer is distinct from 1 then
        raise exception 'Check 7 failed: a valid overnight shift was not saved.';
    end if;
    report := public.import_field_csv(company, 'shifts', jsonb_build_array(shift));
    if (report ->> 'duplicates')::integer is distinct from 1
        or (select count(*) from public.shift_roster where shift_reference = 'QA-SH-1') <> 1 then
        raise exception 'Check 7 failed: a repeated overnight shift was inserted again.';
    end if;

    -- 8. A shift ending before it starts rejects the whole file.
    report := public.import_field_csv(company, 'shifts', jsonb_build_array(
        shift || '{"shift_reference":"QA-SH-ROLLBACK"}',
        shift || '{"shift_reference":"QA-SH-BAD","ends_at":"2026-11-05T17:00:00Z"}'
    ));
    if report ->> 'status' is distinct from 'rejected'
        or exists (select 1 from public.shift_roster where shift_reference = 'QA-SH-ROLLBACK') then
        raise exception 'Check 8 failed: an invalid shift did not roll back the file.';
    end if;

    -- 9. Being an admin in one company does not allow importing in another.
    begin
        perform public.import_field_csv(other_company, 'callouts', jsonb_build_array(callout));
        raise exception 'Check 9 failed: an admin could import into another company.';
    exception when insufficient_privilege then
        null;
    end;
end;
$checks$;

set local request.jwt.claim.sub = '00000000-0000-4000-a000-000000000102';

do $checks$
begin
    -- 10. A site manager can read their roster but cannot use the import function or see run history.
    if not exists (select 1 from public.shift_roster where shift_reference = 'QA-SH-1')
        or exists (select 1 from public.import_runs) then
        raise exception 'Check 10 failed: the manager has the wrong roster or run-history access.';
    end if;
    begin
        perform public.import_field_csv('00000000-0000-4000-a000-000000000201', 'callouts', '[]');
        raise exception 'Check 10 failed: a site manager could invoke the write function.';
    exception when insufficient_privilege then
        null;
    end;
end;
$checks$;

set local request.jwt.claim.sub = '00000000-0000-4000-a000-000000000103';

do $checks$
begin
    -- 11. Another company's administrator cannot read these runs or shifts.
    if exists (select 1 from public.import_runs) or exists (select 1 from public.shift_roster) then
        raise exception 'Check 11 failed: another company could see run history or shifts.';
    end if;
end;
$checks$;

set local request.jwt.claim.sub = '';
set local role anon;

do $checks$
begin
    -- 12. The public-facing function requires a signed-in caller.
    begin
        perform public.import_field_csv('00000000-0000-4000-a000-000000000201', 'callouts', '[]');
        raise exception 'Check 12 failed: an anonymous caller could execute the import function.';
    exception when insufficient_privilege then
        null;
    end;
end;
$checks$;

reset role;
set constraints all immediate;
select 'PASS: 12 CSV import checks' as result;
rollback;
