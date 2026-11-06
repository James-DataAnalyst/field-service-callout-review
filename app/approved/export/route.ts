import { recordIdPattern } from "../../../lib/record-id";
import { getServerSupabase } from "../../../lib/supabase";
import { authorizedReview } from "../../../lib/review-session";
import { inReview, reviewReady } from "../../../lib/review-workspace";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

function message(body: string, status: number) {
  return new Response(body, { status, headers });
}

function csvCell(value: string) {
  // Keep formula-like text inert when opened in a spreadsheet.
  const text = /^[\s\uFEFF]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(value) ? `\t${value}` : value;
  return `"${text.replaceAll('"', '""')}"`;
}

function utc(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toISOString();
}

export async function GET(request: Request) {
  const supabase = await getServerSupabase();
  const auth = await supabase?.auth.getClaims();
  if (!supabase || auth?.error || !auth?.data?.claims.sub) {
    return message("Sign in to download approvals.", 401);
  }
  const company = new URL(request.url).searchParams.get("company");
  if (!company || !recordIdPattern.test(company)) {
    return message("Choose a company to export.", 400);
  }
  const workspace = await authorizedReview(supabase, auth.data.claims.sub);
  if (!reviewReady(workspace) || workspace.organizationId !== company) {
    return message("Load both source files for this company before exporting its review.", 409);
  }
  const { data, error } = await supabase.rpc("get_approved_callout_export", { p_organization_id: company });
  if (error?.code === "42501") {
    return message("Only a company administrator can export approvals for this company.", 403);
  }
  if (error?.code === "P0EX1") {
    return message("This company exceeds the 5,000-row export limit.", 422);
  }
  if (error || !data) {
    return message("Could not export approvals. Try again.", 500);
  }
  const rows = data.filter(row => inReview(workspace, row.organization_id, row.occurred_at));

  const header = [
    "company", "site", "dispatch_reference", "technician_code", "callout_utc",
    "shift_reference", "shift_start_utc", "shift_end_utc", "allowance", "currency",
    "approved_by", "approved_utc", "callout_id",
  ];
  const lines = [
    header,
    ...rows.map((row) => [
      row.organization_name, row.site_name, row.dispatch_reference, row.technician_code, utc(row.occurred_at),
      row.shift_reference, utc(row.shift_starts_at), utc(row.shift_ends_at), (row.amount_minor / 100).toFixed(2),
      row.currency, row.approver_label, utc(row.approved_at), row.callout_id,
    ]),
  ].map((row) => row.map(csvCell).join(","));
  const companySlug = (rows[0]?.organization_name ?? "company").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "company";
  const date = new Date().toISOString().slice(0, 10);

  return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, {
    headers: {
      ...headers,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${companySlug}-approved-callouts-${date}.csv"`,
    },
  });
}
