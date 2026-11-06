-- Run after the CSV import migration and after confirming north.ops@example.com.
begin;

do $seed$
declare
    ops_user uuid;
    updated_sites integer;
begin
    select id into ops_user from auth.users
    where email = 'north.ops@example.com' and email_confirmed_at is not null;

    if ops_user is null then
        raise exception 'Create and confirm north.ops@example.com in Authentication > Users, then run this file again.';
    end if;

    update public.sites as s
    set site_code = fixture.code
    from (values
        ('00000000-0000-4000-9000-000000000201'::uuid, '00000000-0000-4000-9000-000000000301'::uuid, 'CENTRAL'),
        ('00000000-0000-4000-9000-000000000201'::uuid, '00000000-0000-4000-9000-000000000302'::uuid, 'DEPOT'),
        ('00000000-0000-4000-9000-000000000202'::uuid, '00000000-0000-4000-9000-000000000303'::uuid, 'WEST')
    ) as fixture(company_id, site_id, code)
    where s.organization_id = fixture.company_id and s.id = fixture.site_id;

    get diagnostics updated_sites = row_count;
    if updated_sites <> 3 then
        raise exception 'The Stage 2 demo sites are missing. Run 02_demo_sign_in.sql, then retry this file.';
    end if;

    insert into public.organization_admins (user_id, organization_id)
    values (ops_user, '00000000-0000-4000-9000-000000000201')
    on conflict (user_id, organization_id) do nothing;
end;
$seed$;

commit;
