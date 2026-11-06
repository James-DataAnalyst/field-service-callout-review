-- Apply once in a fresh Supabase sandbox.
begin;

create table public.organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null check (btrim(name) <> '')
);

create table public.sites (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations (id),
    name text not null check (btrim(name) <> ''),
    unique (organization_id, id)
);

create table public.organization_admins (
    user_id uuid not null references auth.users (id) on delete cascade,
    organization_id uuid not null references public.organizations (id),
    primary key (user_id, organization_id)
);

create table public.site_managers (
    user_id uuid not null references auth.users (id) on delete cascade,
    site_id uuid not null references public.sites (id),
    primary key (user_id, site_id)
);

create table public.callouts (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null,
    site_id uuid not null,
    dispatch_reference text not null check (btrim(dispatch_reference) <> ''),
    occurred_at timestamptz not null,
    foreign key (organization_id, site_id) references public.sites (organization_id, id),
    unique (organization_id, dispatch_reference)
);

create index callouts_site_date_idx on public.callouts (site_id, occurred_at desc);

alter table public.organizations enable row level security;
alter table public.sites enable row level security;
alter table public.organization_admins enable row level security;
alter table public.site_managers enable row level security;
alter table public.callouts enable row level security;

-- Start with read access only. The policies below narrow which rows are visible.
revoke all on public.organizations, public.sites, public.organization_admins,
    public.site_managers, public.callouts from public, anon, authenticated;
grant select on public.organizations, public.sites, public.organization_admins,
    public.site_managers, public.callouts to authenticated;

create policy "Admins read their own assignments"
on public.organization_admins for select to authenticated
using (user_id = (select auth.uid()));

create policy "Managers read their own assignments"
on public.site_managers for select to authenticated
using (user_id = (select auth.uid()));

create policy "Admins and managers read their permitted sites"
on public.sites for select to authenticated
using (
    organization_id in (
        select organization_id
        from public.organization_admins
        where user_id = (select auth.uid())
    )
    or id in (
        select site_id
        from public.site_managers
        where user_id = (select auth.uid())
    )
);

create policy "Users read companies they administer or manage a site for"
on public.organizations for select to authenticated
using (
    id in (
        select organization_id
        from public.organization_admins
        where user_id = (select auth.uid())
    )
    or id in (select organization_id from public.sites)
);

-- The sites policy is applied to this subquery for the requesting user.
create policy "Users read callouts from their permitted sites"
on public.callouts for select to authenticated
using (site_id in (select id from public.sites));

commit;
