"use server";

import { revalidatePath } from "next/cache";
import type { ImportState } from "../../lib/imports";
import { readImportCsv } from "../../lib/read-import-csv";
import { recordIdPattern } from "../../lib/record-id";
import { getServerSupabase } from "../../lib/supabase";
import { readReview, saveReview } from "../../lib/review-session";
import { loadSource, sourceUpload } from "../../lib/review-workspace";

function failure(message: string): ImportState {
  return { status: "error", message };
}

export async function importCsv(_previous: ImportState, formData: FormData): Promise<ImportState> {
  const supabase = await getServerSupabase(true);
  if (!supabase) {
    return failure("Connect the app to Supabase, then sign in again.");
  }
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims.sub) {
    return failure("Sign in again before uploading a file.");
  }

  const organization = formData.get("organization");
  const kind = formData.get("kind");
  if (typeof organization !== "string" || !recordIdPattern.test(organization)) {
    return failure("Choose the company that owns this file.");
  }
  if (kind !== "callouts" && kind !== "shifts") {
    return failure("Choose dispatch callouts or shift roster.");
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from("organization_admins")
    .select("organization_id")
    .eq("user_id", auth.claims.sub)
    .eq("organization_id", organization)
    .maybeSingle();
  if (assignmentError) {
    return failure("Could not verify your upload access. Try again.");
  }
  if (!assignment) {
    return failure("Only a company administrator can upload for this company.");
  }

  const csv = await readImportCsv(formData.get("csv"), kind);
  if ("error" in csv) {
    return failure(csv.error);
  }

  const { data: report, error } = await supabase.rpc("import_field_csv", {
    p_organization_id: organization,
    p_kind: kind,
    p_rows: csv.rows,
  });
  if (error?.code === "42501") {
    return failure("Only a company administrator can upload for this company.");
  }
  if (error || !report) {
    return failure("Could not confirm the import. You can retry the same file safely.");
  }

  let workspace;
  if (report.status === "completed") {
    const file = formData.get("csv") as File;
    workspace = loadSource(await readReview(), auth.claims.sub, organization, sourceUpload(kind, file.name, csv.rows, report));
    await saveReview(workspace);
    revalidatePath("/", "layout");
  }
  revalidatePath("/imports");
  if (report.status === "completed" && kind === "callouts") {
    revalidatePath("/");
  }
  if (report.inserted > 0) {
    revalidatePath("/shift-review");
  }

  return {
    status: report.status,
    message: report.status === "completed"
      ? `${report.received} rows uploaded successfully`
      : "Upload rejected. No rows from this file were saved.",
    report: {
      ...report,
      issues: report.issues.map(({ row, message }) => ({ line: csv.lines[row - 1] ?? row + 1, message })),
    },
    workspace,
  };
}
