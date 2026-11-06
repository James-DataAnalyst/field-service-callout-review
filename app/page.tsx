import Link from "next/link";
import { redirect } from "next/navigation";
import { recordIdPattern } from "../lib/record-id";
import { getServerSupabase } from "../lib/supabase";
import { WorkspaceHeader } from "./workspace-header";
import { authorizedReview } from "../lib/review-session";
import { ReviewContext } from "./review-context";

export const dynamic = "force-dynamic";

const calloutFields = "id, dispatch_reference, occurred_at, sites(name, organizations(name))";
const pageSize = 20;
const lastAllowedPage = 10000;
const formatTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function registerHref(reference: string, page: number) {
  const query = new URLSearchParams();
  if (reference) query.set("reference", reference);
  if (page > 1) query.set("page", String(page));
  return query.size ? `/?${query}` : "/";
}

export default async function CalloutRegister({
  searchParams,
}: {
  searchParams: Promise<{ callout?: string | string[]; reference?: string | string[]; page?: string | string[]; error?: string | string[] }>;
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
  const params = await searchParams;
  const requestedId = typeof params.callout === "string" ? params.callout.trim() : "";
  const validId = recordIdPattern.test(requestedId);
  const reference = typeof params.reference === "string" ? params.reference.trim() : "";
  const validReference = reference === "" || /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(reference);
  const requestedPage = typeof params.page === "string" && /^[1-9][0-9]{0,4}$/.test(params.page)
    ? Number(params.page)
    : 1;
  const page = Math.min(requestedPage, lastAllowedPage);
  const offset = (page - 1) * pageSize;

  let registerQuery = supabase
    .from("callouts")
    .select(calloutFields)
    .order("occurred_at", { ascending: false })
    .order("id")
    .range(offset, offset + pageSize);
  if (reference && validReference) {
    registerQuery = registerQuery.ilike("dispatch_reference", `${reference.replaceAll("_", "\\_")}%`);
  }
  if (period && workspace.organizationId) {
    registerQuery = registerQuery.eq("organization_id", workspace.organizationId)
      .gte("occurred_at", period.from).lt("occurred_at", period.to);
  }

  const [register, lookup, assignments] = await Promise.all([
    period ? registerQuery : { data: [], error: null },
    validId && period && workspace.organizationId
      ? supabase.from("callouts").select(calloutFields).eq("id", requestedId)
        .eq("organization_id", workspace.organizationId).gte("occurred_at", period.from).lt("occurred_at", period.to).maybeSingle()
      : null,
    supabase.from("organization_admins").select("organization_id").eq("user_id", auth.claims.sub).limit(1),
  ]);

  const email = typeof auth.claims.email === "string" ? auth.claims.email : "Signed in";
  const rows = register.data?.slice(0, pageSize) ?? [];
  const hasNext = (register.data?.length ?? 0) > pageSize && page < lastAllowedPage;

  return (
    <>
      <WorkspaceHeader email={email} canImport={Boolean(assignments.data?.length)} current="register" />

      <main className="workspace">
        <header className="page-heading">
          <p className="eyebrow">Field service</p>
          <h1>Callout register</h1>
          <p className="muted">Browse dispatch records across your assigned sites.</p>
          <ReviewContext review={workspace} canImport={Boolean(assignments.data?.length)} />
        </header>

        {params.error === "sign-out" && (
          <p className="notice notice-error" role="alert">Sign-out could not be confirmed. Try again.</p>
        )}

        <section className="panel" aria-labelledby="register-title">
          <div className="register-toolbar">
            <div className="register-heading">
              <h2 id="register-title">Dispatch records</h2>
              {!register.error && <span className="count">{rows.length} shown</span>}
            </div>
            <form method="get" action="/" className="register-search">
              <label htmlFor="dispatch-search" className="sr-only">Dispatch reference</label>
              <input id="dispatch-search" name="reference" defaultValue={reference.slice(0, 40)}
                maxLength={40} placeholder="Search dispatch reference" autoComplete="off" spellCheck={false} />
              <button type="submit" className="button-secondary">Search</button>
              {reference && <Link href="/" className="clear-filter">Clear</Link>}
            </form>
          </div>
          {!validReference ? (
            <p className="panel-message" role="alert">Use a dispatch reference with up to 40 letters, numbers, dashes or underscores.</p>
          ) : register.error ? (
            <p className="panel-message" role="alert">Could not load callouts. Refresh to try again.</p>
          ) : rows.length === 0 ? (
            <p className="panel-message">{!period ? "No dispatch file has been uploaded for this review." : reference ? "No dispatch records match this search." : "There are no callouts for your assigned sites on this page."}</p>
          ) : (
            <div className="table-wrap" role="region" aria-label="Dispatch records" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Dispatch</th>
                    <th scope="col">Company</th>
                    <th scope="col">Site</th>
                    <th scope="col">Dispatched (UTC)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">
                        {row.dispatch_reference}
                        <code className="record-id">{row.id}</code>
                      </th>
                      <td>{row.sites?.organizations?.name ?? "—"}</td>
                      <td>{row.sites?.name ?? "—"}</td>
                      <td><time dateTime={row.occurred_at}>{formatTime.format(new Date(row.occurred_at))}</time></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!register.error && validReference && (page > 1 || hasNext) && (
            <nav className="review-pagination" aria-label="Register pages">
              {page > 1 && <Link href={registerHref(reference, page - 1)}>Previous</Link>}
              <span>Page {page}</span>
              {hasNext && <Link href={registerHref(reference, page + 1)}>Next</Link>}
            </nav>
          )}
        </section>

        <section className="panel lookup-panel" aria-labelledby="lookup-title">
          <h2 id="lookup-title">Find a callout by ID</h2>
          <p className="muted">Look up a specific dispatch record using its full record ID.</p>
          <form method="get" action="/" className="lookup-form">
            <label>
              Record ID
              <input name="callout" defaultValue={requestedId.slice(0, 36)} maxLength={36} required spellCheck={false} />
            </label>
            <button type="submit">Find callout</button>
          </form>
          {params.callout !== undefined && (
            <p className={lookup?.error ? "notice notice-error" : "notice"} role="status">
              {!validId
                ? "Enter a valid callout ID."
                : lookup?.error
                  ? "Could not look up the callout. Try again."
                  : lookup?.data
                    ? `${lookup.data.dispatch_reference} found at ${lookup.data.sites?.name ?? "your assigned site"}.`
                    : "No callout found for that ID."}
            </p>
          )}
        </section>
      </main>
    </>
  );
}
