-- Apply after the access foundation. Existing callouts keep their original data.
begin;

alter table public.sites
    add column site_code text check (site_code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
    add constraint sites_company_code_key unique (organization_id, site_code);

create table public.import_runs (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations (id),
    imported_by uuid references auth.users (id) on delete set null,
    kind text not null check (kind in ('callouts', 'shifts')),
    status text not null check (status in ('completed', 'rejected')),
    received_count integer not null check (received_count between 1 and 250),
    inserted_count integer not null check (inserted_count >= 0),
    duplicate_count integer not null check (duplicate_count >= 0),
    issue_count integer not null check (issue_count between 0 and received_count),
    issues jsonb not null check (jsonb_typeof(issues) = 'array'),
    created_at timestamptz not null default now(),
    unique (organization_id, id),
    check (
        (status = 'completed' and issue_count = 0 and received_count = inserted_count + duplicate_count)
        or (status = 'rejected' and issue_count > 0 and inserted_count = 0 and duplicate_count = 0)
    )
);

alter table public.callouts
    add column technician_code text check (technician_code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
    add column import_run_id uuid,
    add constraint callouts_import_run_fkey
        foreign key (organization_id, import_run_id)
        references public.import_runs (organization_id, id)
        deferrable initially deferred;

create table public.shift_roster (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null,
    site_id uuid not null,
    shift_reference text not null check (shift_reference ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
    technician_code text not null check (technician_code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
    starts_at timestamptz not null check (isfinite(starts_at)),
    ends_at timestamptz not null check (isfinite(ends_at)),
    import_run_id uuid not null,
    check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours'),
    unique (organization_id, shift_reference),
    foreign key (organization_id, site_id) references public.sites (organization_id, id),
    foreign key (organization_id, import_run_id) references public.import_runs (organization_id, id)
        deferrable initially deferred
);

create index import_runs_company_date_idx on public.import_runs (organization_id, created_at desc);
create index shift_roster_site_tech_start_idx on public.shift_roster (site_id, technician_code, starts_at);

alter table public.import_runs enable row level security;
alter table public.shift_roster enable row level security;
revoke all on public.import_runs, public.shift_roster from public, anon, authenticated;
grant select on public.import_runs, public.shift_roster to authenticated;

create policy "Admins read import runs for their companies"
on public.import_runs for select to authenticated
using (organization_id in (select organization_id from public.organization_admins));

create policy "Users read shifts from their permitted sites"
on public.shift_roster for select to authenticated
using (site_id in (select id from public.sites));

-- Keep the write implementation outside the Data API's public schema.
create schema callout_private;
revoke all on schema callout_private from public, anon, authenticated;
grant usage on schema callout_private to authenticated;

create function callout_private.import_field_csv(
    p_organization_id uuid,
    p_kind text,
    p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $import$
declare
    v_user_id uuid := auth.uid();
    v_run_id uuid := gen_random_uuid();
    v_code_pattern constant text := '^[A-Z0-9][A-Z0-9_-]{0,39}$';
    v_utc_pattern constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$';
    v_received integer;
    v_inserted integer := 0;
    v_duplicates integer := 0;
    v_issue_count integer := 0;
    v_issues jsonb := '[]'::jsonb;
    v_status text := 'completed';
    v_row jsonb;
    v_row_number integer;
    v_issue text;
    v_reference text;
    v_site_code text;
    v_technician text;
    v_start_text text;
    v_end_text text;
    v_site_id uuid;
    v_starts_at timestamptz;
    v_ends_at timestamptz;
    v_was_inserted boolean;
    v_is_repeat boolean;
begin
    -- The caller's session supplies the user ID. A request cannot nominate an uploader.
    perform 1
    from public.organization_admins a
    where a.organization_id = p_organization_id and a.user_id = v_user_id
    for key share;
    if not found then
        raise exception 'Only a company administrator can import for this company.' using errcode = '42501';
    end if;

    if p_kind is null or p_kind not in ('callouts', 'shifts')
        or jsonb_typeof(p_rows) is distinct from 'array' then
        raise exception 'Choose callouts or shifts and provide an array of rows.' using errcode = '22023';
    end if;

    v_received := jsonb_array_length(p_rows);
    if v_received not between 1 and 250 or octet_length(p_rows::text) > 262144 then
        raise exception 'Each import must contain between 1 and 250 small rows.' using errcode = '22023';
    end if;

    -- Serialize writes for this company so simultaneous retries agree on duplicates.
    perform 1 from public.organizations where id = p_organization_id for no key update;

    begin
        for v_row, v_row_number in
            select value, ordinality::integer from jsonb_array_elements(p_rows) with ordinality
        loop
            v_issue := null;
            v_reference := btrim(v_row ->> (case when p_kind = 'callouts' then 'dispatch_reference' else 'shift_reference' end));
            v_site_code := btrim(v_row ->> 'site_code');
            v_technician := btrim(v_row ->> 'technician_code');
            v_start_text := btrim(v_row ->> (case when p_kind = 'callouts' then 'occurred_at' else 'starts_at' end));
            v_end_text := btrim(v_row ->> 'ends_at');

            if coalesce(v_reference, '') !~ v_code_pattern then
                v_issue := 'Use an uppercase dispatch or shift reference, up to 40 characters.';
            elsif coalesce(v_site_code, '') !~ v_code_pattern then
                v_issue := 'Enter a valid uppercase site code.';
            elsif coalesce(v_technician, '') !~ v_code_pattern then
                v_issue := 'Enter a valid uppercase technician code.';
            elsif coalesce(v_start_text, '') !~ v_utc_pattern
                or (p_kind = 'shifts' and coalesce(v_end_text, '') !~ v_utc_pattern) then
                v_issue := 'Use a UTC time such as 2026-11-05T08:15:00Z.';
            end if;

            if v_issue is null then
                select id into v_site_id
                from public.sites
                where organization_id = p_organization_id and site_code = v_site_code;
                if v_site_id is null then
                    v_issue := 'Site code is not in the selected company.';
                end if;
            end if;

            if v_issue is null then
                begin
                    v_starts_at := v_start_text::timestamptz;
                    if p_kind = 'shifts' then
                        v_ends_at := v_end_text::timestamptz;
                        if v_ends_at <= v_starts_at or v_ends_at - v_starts_at > interval '24 hours' then
                            v_issue := 'Shift end must be after its start and within 24 hours.';
                        end if;
                    end if;
                exception when invalid_datetime_format or datetime_field_overflow then
                    v_issue := 'The timestamp does not contain a valid calendar date.';
                end;
            end if;

            if v_issue is null then
                if p_kind = 'callouts' then
                    insert into public.callouts (
                        organization_id, site_id, dispatch_reference, technician_code, occurred_at, import_run_id
                    ) values (
                        p_organization_id, v_site_id, v_reference, v_technician, v_starts_at, v_run_id
                    ) on conflict (organization_id, dispatch_reference) do nothing;
                    v_was_inserted := found;

                    if not v_was_inserted then
                        select exists (
                            select 1 from public.callouts c
                            where c.organization_id = p_organization_id and c.dispatch_reference = v_reference
                              and c.site_id = v_site_id and c.technician_code = v_technician and c.occurred_at = v_starts_at
                        ) into v_is_repeat;
                    end if;
                else
                    insert into public.shift_roster (
                        organization_id, site_id, shift_reference, technician_code, starts_at, ends_at, import_run_id
                    ) values (
                        p_organization_id, v_site_id, v_reference, v_technician, v_starts_at, v_ends_at, v_run_id
                    ) on conflict (organization_id, shift_reference) do nothing;
                    v_was_inserted := found;

                    if not v_was_inserted then
                        select exists (
                            select 1 from public.shift_roster s
                            where s.organization_id = p_organization_id and s.shift_reference = v_reference
                              and s.site_id = v_site_id and s.technician_code = v_technician
                              and s.starts_at = v_starts_at and s.ends_at = v_ends_at
                        ) into v_is_repeat;
                    end if;
                end if;

                if v_was_inserted then
                    v_inserted := v_inserted + 1;
                elsif v_is_repeat then
                    v_duplicates := v_duplicates + 1;
                else
                    v_issue := 'This reference already exists with different details.';
                end if;
            end if;

            if v_issue is not null then
                v_issue_count := v_issue_count + 1;
                if v_issue_count <= 12 then
                    v_issues := v_issues || jsonb_build_array(
                        jsonb_build_object('row', v_row_number, 'message', v_issue)
                    );
                end if;
            end if;
        end loop;

        if v_issue_count > 0 then
            raise sqlstate 'P0CV1' using message = 'Roll back the rejected batch.';
        end if;
    exception when sqlstate 'P0CV1' then
        -- Writes in the inner block are undone. Its issue details can still be logged.
        v_status := 'rejected';
        v_inserted := 0;
        v_duplicates := 0;
    end;

    insert into public.import_runs (
        id, organization_id, imported_by, kind, status,
        received_count, inserted_count, duplicate_count, issue_count, issues
    ) values (
        v_run_id, p_organization_id, v_user_id, p_kind, v_status,
        v_received, v_inserted, v_duplicates, v_issue_count, v_issues
    );

    return jsonb_build_object(
        'run_id', v_run_id,
        'status', v_status,
        'received', v_received,
        'inserted', v_inserted,
        'duplicates', v_duplicates,
        'issue_count', v_issue_count,
        'issues', v_issues
    );
end;
$import$;

create function public.import_field_csv(p_organization_id uuid, p_kind text, p_rows jsonb)
returns jsonb
language sql security invoker set search_path = ''
as $api$
    select callout_private.import_field_csv(p_organization_id, p_kind, p_rows);
$api$;

revoke all on function callout_private.import_field_csv(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.import_field_csv(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function callout_private.import_field_csv(uuid, text, jsonb) to authenticated;
grant execute on function public.import_field_csv(uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
