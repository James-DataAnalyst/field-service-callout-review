import Link from "next/link";
import { redirect } from "next/navigation";
import { formatAllowance } from "../../lib/approvals";
import type { Database } from "../../lib/database";
import { getServerSupabase } from "../../lib/supabase";
import { WorkspaceHeader } from "../workspace-header";
import { ApproveForm } from "./approve-form";
import { authorizedReview } from "../../lib/review-session";
import { reviewReady } from "../../lib/review-workspace";
import { ReviewContext } from "../review-context";

export const dynamic = "force-dynamic";

type ReviewRow = Database["public"]["Views"]["callout_shift_review"]["Row"];
type MatchStatus = ReviewRow["match_status"];
type Filter = "all" | MatchStatus;

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "matched", label: "Matched" },
  { value: "no_shift", label: "No shift" },
  { value: "overlap", label: "Overlap" },
  { value: "missing_technician", label: "Missing technician" },
];

const statusLabels: Record<MatchStatus, string> = {
  matched: "Matched",
  no_shift: "No shift",
  overlap: "Overlap",
  missing_technician: "Missing technician",
};

const pageSize = 20;
const lastAllowedPage = 10000;
const utcTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : utcTime.format(date);
}

function reviewHref(status: Filter, page = 1) {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/shift-review?${query}` : "/shift-review";
}

function RosterDetails({ row }: { row: ReviewRow }) {
  if (row.match_status === "matched" && row.matched_shift_reference && row.shift_starts_at && row.shift_ends_at) {
    return (
      <>
        <span className="shift-reference">{row.matched_shift_reference}</span>
        <span className="review-detail">
          <time dateTime={row.shift_starts_at}>{formatTime(row.shift_starts_at)}</time>
          {" to "}
          <time dateTime={row.shift_ends_at}>{formatTime(row.shift_ends_at)}</time>
        </span>
      </>
    );
  }
  if (row.match_status === "overlap") return `${row.candidate_count} shifts cover this time`;
  if (row.match_status === "no_shift") return "No scheduled shift covers this time";
  if (row.match_status === "missing_technician") return "Dispatch record needs a technician code";
  return "Shift details unavailable";
}

export default async function ShiftReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; page?: string | string[] }>;
}) {
  const supabase = await getServerSupabase();
  if (!supabase) {
    redirect("/sign-in");
  }
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims.sub) {
    redirect("/sign-in");
  }

  const workspace = await authorizedReview(supabase, auth.claims.sub);
  const period = workspace.uploads.callouts;
  const ready = reviewReady(workspace);
  const params = await searchParams;
  const status = filters.find((filter) => filter.value === params.status)?.value ?? "all";
  const requestedPage = typeof params.page === "string" && /^[1-9][0-9]{0,4}$/.test(params.page)
    ? Number(params.page)
    : 1;
  const page = Math.min(requestedPage, lastAllowedPage);
  const offset = (page - 1) * pageSize;
  let query = supabase
    .from("callout_shift_review")
    .select("*")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + pageSize);
  if (status !== "all") {
    query = query.eq("match_status", status);
  }
  if (period && workspace.organizationId) {
    query = query.eq("organization_id", workspace.organizationId).gte("occurred_at", period.from).lt("occurred_at", period.to);
  }

  const [review, assignments, managerSites] = await Promise.all([
    ready ? query : { data: [], error: null },
    supabase.from("organization_admins").select("organization_id").eq("user_id", auth.claims.sub).limit(1),
    supabase.from("site_managers").select("site_id").eq("user_id", auth.claims.sub),
  ]);
  const email = typeof auth.claims.email === "string" ? auth.claims.email : "Signed in";
  const rows = review.data?.slice(0, pageSize) ?? [];
  const hasNext = (review.data?.length ?? 0) > pageSize && page < lastAllowedPage;
  const approvals = rows.length > 0
    ? await supabase
        .from("callout_approvals")
        .select("callout_id, approved_at, amount_minor, currency")
        .in("callout_id", rows.map((row) => row.id))
    : null;
  const approvalsByCallout = new Map(approvals?.data?.map((approval) => [approval.callout_id, approval]));
  const managedSites = new Set(managerSites.data?.map((assignment) => assignment.site_id));
  const canLoadApprovals = !approvals?.error && !managerSites.error;

  return (
    <>
      <WorkspaceHeader email={email} canImport={Boolean(assignments.data?.length)} current="review" />
      <main className="workspace">
        <header className="page-heading">
          <p className="eyebrow">Field service</p>
          <h1>Shift review</h1>
          <p className="muted">See which callouts match the roster and which need a closer look.</p>
          <ReviewContext review={workspace} canImport={Boolean(assignments.data?.length)} />
        </header>

        <section className="panel" aria-labelledby="matches-title">
          <div className="review-toolbar">
            <h2 id="matches-title">Callout matches</h2>
            <nav className="review-filters" aria-label="Match status">
              {filters.map((filter) => (
                <Link
                  key={filter.value}
                  href={reviewHref(filter.value)}
                  aria-current={filter.value === status ? "true" : undefined}
                >
                  {filter.label}
                </Link>
              ))}
            </nav>
          </div>
          {!canLoadApprovals && (
            <p className="panel-message" role="alert">Could not load approval details. Refresh to try again.</p>
          )}
          {review.error ? (
            <p className="panel-message" role="alert">Could not load shift matches. Refresh to try again.</p>
          ) : rows.length === 0 ? (
            <p className="panel-message">{ready ? "No callouts for this filter." : period && workspace.uploads.shifts
              ? "The roster and dispatch dates do not overlap. Load files for the same review period."
              : "Both the shift roster and dispatch file are needed before reviewing matches."}</p>
          ) : (
            <div className="table-wrap" role="region" aria-label="Callout matches" tabIndex={0}>
              <table className="review-table">
                <thead>
                  <tr>
                    <th scope="col">Dispatch</th>
                    <th scope="col">Site and technician</th>
                    <th scope="col">Callout (UTC)</th>
                    <th scope="col">Status</th>
                    <th scope="col">Roster (UTC)</th>
                    <th scope="col">Approval</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const approval = approvalsByCallout.get(row.id);
                    const canApprove = canLoadApprovals && row.match_status === "matched" && managedSites.has(row.site_id);
                    return (
                    <tr key={row.id}>
                      <th scope="row">
                        {row.dispatch_reference}
                        <span className="review-detail">{row.organization_name}</span>
                      </th>
                      <td>{row.site_name}<span className="review-detail">{row.technician_code ?? "Code missing"}</span></td>
                      <td><time dateTime={row.occurred_at}>{formatTime(row.occurred_at)}</time></td>
                      <td><span className={`review-status status-${row.match_status}`}>{statusLabels[row.match_status]}</span></td>
                      <td className="roster-cell"><RosterDetails row={row} /></td>
                      <td className="approval-cell">
                        {approval ? (
                          <>
                            <span className="review-status status-matched">Approved</span>
                            <span className="review-detail">{formatAllowance(approval.amount_minor, approval.currency)}</span>
                          </>
                        ) : canApprove && row.matched_shift_id ? (
                          <ApproveForm calloutId={row.id} shiftId={row.matched_shift_id} dispatch={row.dispatch_reference} />
                        ) : row.match_status === "matched" && canLoadApprovals ? (
                          <span className="review-detail">Awaiting site manager</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!review.error && (page > 1 || hasNext) && (
            <nav className="review-pagination" aria-label="Shift review pages">
              {page > 1 && <Link href={reviewHref(status, page - 1)}>Previous</Link>}
              <span>Page {page}</span>
              {hasNext && <Link href={reviewHref(status, page + 1)}>Next</Link>}
            </nav>
          )}
        </section>
      </main>
    </>
  );
}
