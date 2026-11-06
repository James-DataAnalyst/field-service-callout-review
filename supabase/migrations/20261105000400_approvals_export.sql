-- Record one approval per callout and export approved snapshots by company.
begin;

create table callout_private.company_allowance_rates (
    organization_id uuid primary key references public.organizations (id),
    amount_minor integer not null check (amount_minor between 1 and 1000000),
    currency text not null check (currency ~ '^[A-Z]{3}$')
);
alter table callout_private.company_allowance_rates enable row level security;
revoke all on callout_private.company_allowance_rates from public, anon, authenticated;

create table public.callout_approvals (
    callout_id uuid primary key references public.callouts (id),
    organization_id uuid not null,
    site_id uuid not null,
    shift_id uuid not null references public.shift_roster (id),
    organization_name text not null,
    site_name text not null,
    dispatch_reference text not null,
    technician_code text not null,
    occurred_at timestamptz not null,
    shift_reference text not null,
    shift_starts_at timestamptz not null,
    shift_ends_at timestamptz not null,
    amount_minor integer not null check (amount_minor between 1 and 1000000),
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    approved_by uuid references auth.users (id) on delete set null,
    approver_label text not null,
    approved_at timestamptz not null default clock_timestamp(),
    foreign key (organization_id, site_id) references public.sites (organization_id, id)
);
create index callout_approvals_company_date_idx
    on public.callout_approvals (organization_id, approved_at desc, callout_id);
create index callout_approvals_site_idx on public.callout_approvals (site_id);

alter table public.callout_approvals enable row level security;
revoke all on public.callout_approvals from public, anon, authenticated;
grant select on public.callout_approvals to authenticated;

create policy "Users read approvals from their permitted sites"
on public.callout_approvals for select to authenticated
using (site_id in (select id from public.sites));

create view public.callout_approval_totals
with (security_invoker = true)
as
select organization_id, currency, count(*)::integer as approved_count, sum(amount_minor) as total_minor
from public.callout_approvals
group by organization_id, currency;

revoke all on public.callout_approval_totals from public, anon, authenticated;
grant select on public.callout_approval_totals to authenticated;

create function callout_private.approve_callout(p_callout_id uuid, p_shift_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $approve$
declare
    v_user_id uuid := auth.uid();
    v_organization_id uuid;
    v_site_id uuid;
    v_match public.callout_shift_review%rowtype;
    v_rate callout_private.company_allowance_rates%rowtype;
    v_approval public.callout_approvals%rowtype;
    v_created boolean := false;
begin
    -- Authorize the assignment before reading the roster or the approval.
    select c.organization_id, c.site_id into v_organization_id, v_site_id
    from public.callouts c
    join public.site_managers m on m.site_id = c.site_id and m.user_id = v_user_id
    where c.id = p_callout_id
    for key share of m;

    if not found then
        raise exception 'Only an assigned site manager can approve this callout.' using errcode = '42501';
    end if;

    -- Share the company lock with imports so the roster cannot change during approval.
    perform 1 from public.organizations where id = v_organization_id for no key update;

    select * into v_approval
    from public.callout_approvals
    where callout_id = p_callout_id and organization_id = v_organization_id and site_id = v_site_id;

    if not found then
        select * into v_match
        from public.callout_shift_review
        where id = p_callout_id and organization_id = v_organization_id and site_id = v_site_id;

        if v_match.match_status is distinct from 'matched'
            or v_match.matched_shift_id is distinct from p_shift_id then
            raise exception 'The callout needs a current single shift match.' using errcode = 'P0AP1';
        end if;

        select * into v_rate from callout_private.company_allowance_rates
        where organization_id = v_organization_id for share;

        if not found then
            raise exception 'This company needs an allowance rate before approval.' using errcode = 'P0AP2';
        end if;

        insert into public.callout_approvals (
            callout_id, organization_id, site_id, shift_id,
            organization_name, site_name, dispatch_reference, technician_code, occurred_at,
            shift_reference, shift_starts_at, shift_ends_at, amount_minor, currency,
            approved_by, approver_label
        ) values (
            p_callout_id, v_organization_id, v_site_id, v_match.matched_shift_id,
            v_match.organization_name, v_match.site_name, v_match.dispatch_reference, v_match.technician_code,
            v_match.occurred_at, v_match.matched_shift_reference, v_match.shift_starts_at, v_match.shift_ends_at,
            v_rate.amount_minor, v_rate.currency, v_user_id,
            coalesce((select nullif(email, '') from auth.users where id = v_user_id), v_user_id::text)
        ) returning * into v_approval;

        v_created := true;
    end if;

    return jsonb_build_object(
        'created', v_created,
        'approved_at', v_approval.approved_at,
        'amount_minor', v_approval.amount_minor,
        'currency', v_approval.currency
    );
end;
$approve$;

create function public.approve_callout(p_callout_id uuid, p_shift_id uuid)
returns jsonb
language sql security invoker set search_path = ''
as $api$
    select callout_private.approve_callout(p_callout_id, p_shift_id);
$api$;

create function public.get_approved_callout_export(p_organization_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $export$
declare
    v_rows jsonb;
begin
    if not exists (
        select 1 from public.organization_admins
        where organization_id = p_organization_id and user_id = auth.uid()
    ) then
        raise exception 'Only a company administrator can export approvals for this company.' using errcode = '42501';
    end if;

    select coalesce(jsonb_agg(to_jsonb(a) order by a.approved_at desc, a.callout_id), '[]'::jsonb)
    into v_rows
    from (
        select *
        from public.callout_approvals
        where organization_id = p_organization_id
        order by approved_at desc, callout_id
        limit 5001
    ) a;

    if jsonb_array_length(v_rows) > 5000 then
        raise exception 'This company has more than 5,000 approved callouts.' using errcode = 'P0EX1';
    end if;

    return v_rows;
end;
$export$;

revoke all on function callout_private.approve_callout(uuid, uuid) from public, anon, authenticated;
revoke all on function public.approve_callout(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_approved_callout_export(uuid) from public, anon, authenticated;
grant execute on function callout_private.approve_callout(uuid, uuid) to authenticated;
grant execute on function public.approve_callout(uuid, uuid) to authenticated;
grant execute on function public.get_approved_callout_export(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
