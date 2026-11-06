-- Run in the personal demo project after creating and confirming both users.
-- These fictional rows stay in the database so the signed-in app can read them.
begin;

do $seed$
declare
    central_manager uuid;
    west_manager uuid;
begin
    select id into central_manager
    from auth.users
    where email = 'north.central@example.com' and email_confirmed_at is not null;

    select id into west_manager
    from auth.users
    where email = 'bridge.west@example.com' and email_confirmed_at is not null;

    if central_manager is null or west_manager is null then
        raise exception 'Create and confirm north.central@example.com and bridge.west@example.com in Authentication > Users, then run this file again.';
    end if;

    insert into public.organizations (id, name) values
        ('00000000-0000-4000-9000-000000000201', 'Northline Facilities'),
        ('00000000-0000-4000-9000-000000000202', 'Bridgewater Maintenance')
    on conflict (id) do nothing;

    insert into public.sites (id, organization_id, name) values
        ('00000000-0000-4000-9000-000000000301', '00000000-0000-4000-9000-000000000201', 'Central'),
        ('00000000-0000-4000-9000-000000000302', '00000000-0000-4000-9000-000000000201', 'Depot'),
        ('00000000-0000-4000-9000-000000000303', '00000000-0000-4000-9000-000000000202', 'West')
    on conflict (id) do nothing;

    insert into public.callouts (id, organization_id, site_id, dispatch_reference, occurred_at) values
        ('00000000-0000-4000-9000-000000000401', '00000000-0000-4000-9000-000000000201',
         '00000000-0000-4000-9000-000000000301', 'CL-26041', '2026-11-04 08:10:00+00'),
        ('00000000-0000-4000-9000-000000000402', '00000000-0000-4000-9000-000000000201',
         '00000000-0000-4000-9000-000000000302', 'CL-26042', '2026-11-04 10:25:00+00'),
        ('00000000-0000-4000-9000-000000000403', '00000000-0000-4000-9000-000000000202',
         '00000000-0000-4000-9000-000000000303', 'BW-26018', '2026-11-04 16:45:00+00')
    on conflict (id) do nothing;

    insert into public.site_managers (user_id, site_id) values
        (central_manager, '00000000-0000-4000-9000-000000000301'),
        (west_manager, '00000000-0000-4000-9000-000000000303')
    on conflict (user_id, site_id) do nothing;
end;
$seed$;

commit;
