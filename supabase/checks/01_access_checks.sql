-- Run as one script in the sandbox SQL Editor after applying the migration.
-- Fictional rows and accounts are rolled back at the end.
begin;

insert into auth.users (id, email) values
    ('00000000-0000-4000-8000-000000000101', 'north-admin@example.test'),
    ('00000000-0000-4000-8000-000000000102', 'north-manager@example.test'),
    ('00000000-0000-4000-8000-000000000103', 'bridge-manager@example.test'),
    ('00000000-0000-4000-8000-000000000104', 'unassigned@example.test');

insert into public.organizations (id, name) values
    ('00000000-0000-4000-8000-000000000201', 'Northline Facilities'),
    ('00000000-0000-4000-8000-000000000202', 'Bridgewater Maintenance');

insert into public.sites (id, organization_id, name) values
    ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 'Central'),
    ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000201', 'Depot'),
    ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000202', 'West');

insert into public.organization_admins (user_id, organization_id) values
    ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000201');

insert into public.site_managers (user_id, site_id) values
    ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000301'),
    ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000303');

-- The same dispatch reference can exist in different organizations.
insert into public.callouts (id, organization_id, site_id, dispatch_reference, occurred_at) values
    ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000201',
        '00000000-0000-4000-8000-000000000301', 'CALL-104', '2026-10-27 09:30:00+00'),
    ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000201',
        '00000000-0000-4000-8000-000000000302', 'CALL-105', '2026-10-27 10:30:00+00'),
    ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000202',
        '00000000-0000-4000-8000-000000000303', 'CALL-104', '2026-10-27 11:30:00+00');

do $checks$
begin
    -- 1. Even a privileged writer cannot attach a callout to another company's site.
    begin
        insert into public.callouts (organization_id, site_id, dispatch_reference, occurred_at)
        values ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000303',
                'FORGED-SITE', now());
        raise exception 'Check 1 failed: a mismatched organization and site were accepted';
    exception when foreign_key_violation then
        null;
    end;

    -- 2. A dispatch reference cannot be recorded twice within a company.
    begin
        insert into public.callouts (organization_id, site_id, dispatch_reference, occurred_at)
        values ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000302',
                'CALL-104', now());
        raise exception 'Check 2 failed: a duplicate dispatch reference was accepted';
    exception when unique_violation then
        null;
    end;
end;
$checks$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000102';

do $checks$
begin
    -- 3. A site manager can read one callout and cannot see the other two by ID.
    if (select array_agg(id order by id) from public.callouts)
        is distinct from array['00000000-0000-4000-8000-000000000401']::uuid[]
        or exists (
            select 1 from public.callouts
            where id in (
                '00000000-0000-4000-8000-000000000402',
                '00000000-0000-4000-8000-000000000403'
            )
        ) then
        raise exception 'Check 3 failed: the Central manager did not see exactly the Central callout';
    end if;

    -- 4. Direct writes are denied, even against a row the manager can see.
    begin
        update public.callouts set dispatch_reference = 'ALTERED'
        where id = '00000000-0000-4000-8000-000000000401';
        raise exception 'Check 4 failed: the manager could issue a direct update';
    exception when insufficient_privilege then
        null;
    end;

    -- 5. A manager cannot grant themselves a company administrator role.
    begin
        insert into public.organization_admins (user_id, organization_id)
        values ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000201');
        raise exception 'Check 5 failed: the manager could write an administrator assignment';
    exception when insufficient_privilege then
        null;
    end;
end;
$checks$;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000101';

do $checks$
begin
    -- 6. The Northline administrator sees both Northline sites, excluding Bridgewater.
    if (select array_agg(id order by id) from public.callouts) is distinct from
        array['00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000402']::uuid[] then
        raise exception 'Check 6 failed: the administrator did not see exactly the two Northline callouts';
    end if;
end;
$checks$;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000103';

do $checks$
begin
    -- 7. The second company's manager sees only their company's assigned site.
    if (select array_agg(id order by id) from public.callouts)
        is distinct from array['00000000-0000-4000-8000-000000000403']::uuid[] then
        raise exception 'Check 7 failed: the West manager did not see exactly the West callout';
    end if;
end;
$checks$;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000104';

do $checks$
begin
    -- 8. Signing in alone does not grant data access.
    if exists (select 1 from public.callouts) then
        raise exception 'Check 8 failed: an unassigned user could read a callout';
    end if;
end;
$checks$;

set local request.jwt.claim.sub = '';
set local role anon;

do $checks$
begin
    -- 9. An unsigned request has no table access.
    begin
        perform id from public.callouts limit 1;
        raise exception 'Check 9 failed: an anonymous user could query the callouts table';
    exception when insufficient_privilege then
        null;
    end;
end;
$checks$;

select 'PASS: 9 access and integrity checks' as result;

rollback;
