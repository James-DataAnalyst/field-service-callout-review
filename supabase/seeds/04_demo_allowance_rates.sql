-- Sample company policy for the fictional Northline and Bridgewater accounts.
begin;

insert into callout_private.company_allowance_rates (organization_id, amount_minor, currency)
select id, 2500, 'GBP'
from public.organizations
where id in ('00000000-0000-4000-9000-000000000201', '00000000-0000-4000-9000-000000000202')
on conflict (organization_id) do nothing;

commit;
