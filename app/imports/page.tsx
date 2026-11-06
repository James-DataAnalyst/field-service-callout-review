import Link from "next/link";
import { redirect } from "next/navigation";
import { importLabels } from "../../lib/imports";
import { authorizedReview } from "../../lib/review-session";
import { newReview } from "../auth-actions";
import { ReviewContext } from "../review-context";
import { getServerSupabase } from "../../lib/supabase";
import { WorkspaceHeader } from "../workspace-header";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";

const formatTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export default async function ImportPage() {
  const supabase = await getServerSupabase();
  if (!supabase) {
    redirect("/sign-in");
  }
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims.sub) {
    redirect("/sign-in");
  }

  const { data: assignments, error: assignmentError } = await supabase
    .from("organization_admins")
    .select("organization_id, organizations(name)")
    .eq("user_id", auth.claims.sub);
  const email = typeof auth.claims.email === "string" ? auth.claims.email : "Signed in";
  const companies = (assignments ?? []).flatMap((assignment) => assignment.organizations
    ? [{ id: assignment.organization_id, name: assignment.organizations.name }]
    : []);

  if (assignmentError || companies.length === 0) {
    return (
      <>
        <WorkspaceHeader email={email} canImport={false} current="imports" />
        <main className="workspace">
          <header className="page-heading">
            <p className="eyebrow">Field service</p>
            <h1>Import access</h1>
          </header>
          <section className="panel lookup-panel">
            <p>{assignmentError ? "Could not verify your upload access. Refresh to try again." : "Only company administrators can upload files."}</p>
            <Link href="/" className="back-link">Back to callout register</Link>
          </section>
        </main>
      </>
    );
  }

  const workspace = await authorizedReview(supabase, auth.claims.sub);
  const { data: history, error: historyError } = await supabase
    .from("import_runs")
    .select("id, kind, status, received_count, inserted_count, duplicate_count, issue_count, created_at, organizations(name)")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(10);

  return (
    <>
      <WorkspaceHeader email={email} canImport current="imports" />
      <main className="workspace">
        <header className="page-heading import-heading">
          <div>
            <p className="eyebrow">Operations</p>
            <h1>CSV imports</h1>
            <p className="muted">Bring dispatch callouts and technician shifts into the workspace.</p>
            <ReviewContext review={workspace} canImport />
          </div>
          <form action={newReview}>
            <button type="submit" className="button-secondary" disabled={!workspace.organizationId}
              title="Start with no files loaded. Saved imports and approvals are kept.">New review</button>
          </form>
        </header>

        <section className="panel import-panel" aria-labelledby="upload-title">
          <ImportForm key={workspace.id} companies={companies} initialWorkspace={workspace} />
        </section>

        <section className="panel" aria-labelledby="history-title">
          <div className="panel-heading">
            <h2 id="history-title">Recent import runs</h2>
            {Boolean(history?.length) && <span className="count">Latest {history?.length}</span>}
          </div>
          {historyError ? (
            <p className="panel-message" role="alert">Could not load import history. Refresh to try again.</p>
          ) : !history?.length ? (
            <p className="panel-message">Database validation results will appear here after your first upload.</p>
          ) : (
            <div className="table-wrap" role="region" aria-label="Recent import runs" tabIndex={0}>
              <table className="import-history">
                <thead>
                  <tr>
                    <th scope="col">File type and run ID</th>
                    <th scope="col">Company</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Rows</th>
                    <th scope="col">Time (UTC)</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((run) => (
                    <tr key={run.id}>
                      <th scope="row">{importLabels[run.kind]}<code className="record-id">{run.id}</code></th>
                      <td>{run.organizations?.name ?? "—"}</td>
                      <td><span className={run.status === "completed" ? "count" : "count count-error"}>{run.status === "completed" ? "Completed" : "Rejected"}</span></td>
                      <td>{run.status === "completed" ? `${run.received_count} processed · ${run.inserted_count} new · ${run.duplicate_count} already saved` : `${run.issue_count} with issues · 0 added`}</td>
                      <td><time dateTime={run.created_at}>{formatTime.format(new Date(run.created_at))}</time></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
