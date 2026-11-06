"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { importCsv } from "./actions";
import { importFormats, maxCsvKilobytes, maxImportRows, type ImportState } from "../../lib/imports";
import { reviewReady, type ReviewWorkspace } from "../../lib/review-workspace";

const initialState: ImportState = { status: "idle", message: "" };
const sources = [
  { kind: "callouts", label: "Dispatch callouts", href: "/samples/Northline%20Dispatch%202025-10.csv" },
  { kind: "shifts", label: "Shift roster", href: "/samples/Northline%20Shift%20Roster%202025-10.csv" },
] as const;

export function ImportForm({ companies, initialWorkspace }: {
  companies: { id: string; name: string }[];
  initialWorkspace: ReviewWorkspace;
}) {
  const [state, action, pending] = useActionState(importCsv, initialState);
  const [companyId, setCompanyId] = useState(
    companies.find(company => company.id === initialWorkspace.organizationId)?.id ?? companies[0].id,
  );
  const workspace = state.workspace ?? initialWorkspace;
  const activeCompany = workspace.organizationId === companyId;
  const uploads = activeCompany ? workspace.uploads : {};

  return (
    <>
      <div className="import-work-area">
        <h2 id="upload-title">Upload a file</h2>
        <p className="muted import-description">Upload the shift roster and dispatch records to prepare your review.</p>
        <form action={action} className="import-form" aria-busy={pending}>
          <div className="import-options">
            <label>
              Company
              <select name="organization" required value={companyId} onChange={event => setCompanyId(event.target.value)}>
                {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            </label>
            <label>
              File type
              <select name="kind" defaultValue="shifts" required>
                <option value="callouts">Dispatch callouts</option>
                <option value="shifts">Shift roster</option>
              </select>
            </label>
          </div>
          <label>
            CSV file
            <input type="file" name="csv" accept=".csv,text/csv" required aria-describedby="csv-limits" />
          </label>
          <p id="csv-limits" className="muted form-hint">UTF-8 CSV · Up to {maxCsvKilobytes} KB and {maxImportRows} data rows</p>
          <button type="submit" disabled={pending}>{pending ? "Checking file…" : "Validate and import"}</button>
        </form>

        {state.status !== "idle" && (
          <div className={state.status === "completed" ? "notice import-result" : "notice notice-error import-result"} role="status">
            <p className="result-title">{state.message}</p>
            {state.report && (
              <>
                {state.status === "completed" && (
                  <p className="result-detail">{state.report.inserted} new records saved · {state.report.duplicates} already present</p>
                )}
                {state.report.issues.length > 0 && (
                  <ul className="import-issues">
                    {state.report.issues.map(issue => (
                      <li key={issue.line}><strong>Line {issue.line}</strong> · {issue.message}</li>
                    ))}
                  </ul>
                )}
                {state.report.issue_count > state.report.issues.length && (
                  <p>Showing the first {state.report.issues.length} of {state.report.issue_count} issues.</p>
                )}
                <p className="run-id">Run ID <code>{state.report.run_id}</code></p>
              </>
            )}
          </div>
        )}
      </div>

      <aside className="import-sources" aria-labelledby="sources-title">
        <h2 id="sources-title">Source files</h2>
        <p className="review-detail">Northline Facilities · October 2025</p>
        <ul className="source-downloads">
          {sources.map(source => {
            const upload = uploads[source.kind];
            return (
              <li key={source.kind}>
                <a href={source.href} download>{source.label}</a>
                {upload ? (
                  <>
                    <p className="source-row-count">{upload.received} <span>rows uploaded</span></p>
                    <p className="source-file-name">{upload.filename}</p>
                    <p className="review-detail">{upload.inserted} new · {upload.duplicates} already saved</p>
                  </>
                ) : (
                  <p className="source-pending">Not uploaded for this review</p>
                )}
              </li>
            );
          })}
        </ul>
        {activeCompany && reviewReady(workspace) && (
          <Link href="/shift-review" className="download-link review-next">Continue to shift review</Link>
        )}
        {activeCompany && uploads.callouts && uploads.shifts && !reviewReady(workspace) && (
          <p className="notice notice-error">The roster and dispatch dates do not overlap. Upload files for the same review period.</p>
        )}
        <details className="csv-help">
          <summary>CSV format and quick checks</summary>
          <ul>
            <li><a href="/samples/callouts-valid.csv" download>Dispatch template</a><code>{importFormats.callouts.join(", ")}</code></li>
            <li><a href="/samples/shifts-valid.csv" download>Shift roster template</a><code>{importFormats.shifts.join(", ")}</code></li>
            <li><a href="/samples/callouts-rejected.csv" download>Rejection example</a></li>
          </ul>
          <p className="muted form-hint">Use uppercase codes and UTC timestamps such as <code>2025-10-05T08:15:00Z</code>.</p>
        </details>
      </aside>
    </>
  );
}
