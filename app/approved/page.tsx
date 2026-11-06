import Link from "next/link";
import { redirect } from "next/navigation";
import { formatAllowance } from "../../lib/approvals";
import { getServerSupabase } from "../../lib/supabase";
import { WorkspaceHeader } from "../workspace-header";
import { authorizedReview, reviewApprovalTotals } from "../../lib/review-session";
import { reviewReady } from "../../lib/review-workspace";
import { ReviewContext } from "../review-context";

export const dynamic = "force-dynamic";

const pageSize = 20;
const utcTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

function pageHref(companyId: string | undefined, page: number) {
  const query = new URLSearchParams();
  if (companyId) query.set("company", companyId);
  if (page > 1) query.set("page", String(page));
  return query.size ? `/approved?${query}` : "/approved";
}

export default async function ApprovedPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string | string[]; page?: string | string[] }>;
}) {
  const supabase = await getServerSupabase();
  if (!supabase) redirect("/sign-in");
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims.sub) redirect("/sign-in");

  const workspace = await authorizedReview(supabase, auth.claims.sub);
  const period = workspace.uploads.callouts;
  const ready = reviewReady(workspace);
  const params = await searchParams;
  const { data: assignments } = await supabase
    .from("organization_admins")
    .select("organization_id, organizations(name)")
    .eq("user_id", auth.claims.sub);
  const companies = (assignments ?? []).flatMap((assignment) => assignment.organizations
    ? [{ id: assignment.organization_id, name: assignment.organizations.name }]
    : []).filter(company => !workspace.organizationId || company.id === workspace.organizationId);
  companies.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const company = companies.find((option) => option.id === params.company) ?? companies[0];
  const page = typeof params.page === "string" && /^[1-9][0-9]{0,3}$/.test(params.page) ? Number(params.page) : 1;
  const offset = (page - 1) * pageSize;

  let approvals = supabase
    .from("callout_approvals")
    .select("callout_id, dispatch_reference, site_name, technician_code, shift_reference, amount_minor, currency, approver_label, approved_at")
    .order("approved_at", { ascending: false })
    .order("callout_id")
    .range(offset, offset + pageSize);
  if (company) {
    approvals = approvals.eq("organization_id", company.id);
  }
  if (period && workspace.organizationId) {
    approvals = approvals.eq("organization_id", workspace.organizationId)
      .gte("occurred_at", period.from).lt("occurred_at", period.to);
  }
  const [result, summary] = await Promise.all([
    ready ? approvals : { data: [], error: null },
    ready ? reviewApprovalTotals(supabase, workspace) : { data: [], error: null },
  ]);
  const rows = result.data?.slice(0, pageSize) ?? [];
  const hasNext = (result.data?.length ?? 0) > pageSize && page < 9999;
  const totalsByCurrency = new Map<string, number>();
  let count = 0;
  for (const item of summary.data ?? []) {
    count += item.approved_count;
    totalsByCurrency.set(item.currency, (totalsByCurrency.get(item.currency) ?? 0) + item.total_minor);
  }
  const email = typeof auth.claims.email === "string" ? auth.claims.email : "Signed in";

  return (
    <>
      <WorkspaceHeader email={email} canImport={companies.length > 0} current="approved" />
      <main className="workspace">
        <header className="page-heading">
          <p className="eyebrow">Field service</p>
          <h1>Approved callouts</h1>
          <p className="muted">Review signed-off allowances and their approval history.</p>
          <ReviewContext review={workspace} canImport={companies.length > 0} />
        </header>

        <section className="panel" aria-labelledby="ledger-title">
          <div className="review-toolbar">
            <div className="approval-ledger-heading">
              <div>
                <h2 id="ledger-title">{company?.name ?? "Your assigned sites"}</h2>
                {!summary.error && (
                  <p className="review-detail">
                    {count} approved{[...totalsByCurrency].map(([currency, amount]) => (
                      <span key={currency}> · {formatAllowance(amount, currency)}</span>
                    ))}
                  </p>
                )}
              </div>
              {company && count > 0 && count <= 5000 && !summary.error && (
                <a className="download-link" href={`/approved/export?company=${company.id}`}>Download CSV</a>
              )}
            </div>
            {companies.length > 1 && (
              <form method="get" action="/approved" className="approval-company-picker">
                <label>Company
                  <select name="company" defaultValue={company?.id}>
                    {companies.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>
                </label>
                <button type="submit" className="button-secondary">Apply</button>
              </form>
            )}
            {company && count > 5000 && <p className="review-detail">The CSV export supports up to 5,000 approvals per company.</p>}
          </div>
          {result.error || summary.error ? (
            <p className="panel-message" role="alert">Could not load approvals. Refresh to try again.</p>
          ) : rows.length === 0 ? (
            <p className="panel-message">{ready ? "Approvals will appear here after a site manager signs off a matched callout." : "Load both source files to open the approval ledger for this review."}</p>
          ) : (
            <div className="table-wrap" role="region" aria-label="Approved callouts" tabIndex={0}>
              <table className="review-table">
                <thead>
                  <tr>
                    <th scope="col">Dispatch</th>
                    <th scope="col">Site and technician</th>
                    <th scope="col">Shift</th>
                    <th scope="col">Allowance</th>
                    <th scope="col">Approved by</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.callout_id}>
                      <th scope="row">{row.dispatch_reference}</th>
                      <td>{row.site_name}<span className="review-detail">{row.technician_code}</span></td>
                      <td>{row.shift_reference}</td>
                      <td>{formatAllowance(row.amount_minor, row.currency)}</td>
                      <td>
                        {row.approver_label}
                        <time className="review-detail" dateTime={row.approved_at}>{utcTime.format(new Date(row.approved_at))} UTC</time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!result.error && (page > 1 || hasNext) && (
            <nav className="review-pagination" aria-label="Approval pages">
              {page > 1 && <Link href={pageHref(company?.id, page - 1)}>Previous</Link>}
              <span>Page {page}</span>
              {hasNext && <Link href={pageHref(company?.id, page + 1)}>Next</Link>}
            </nav>
          )}
        </section>
      </main>
    </>
  );
}
