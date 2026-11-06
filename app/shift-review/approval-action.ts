"use server";

import { revalidatePath } from "next/cache";
import { formatAllowance, type ApprovalState } from "../../lib/approvals";
import { recordIdPattern } from "../../lib/record-id";
import { getServerSupabase } from "../../lib/supabase";
import { authorizedReview } from "../../lib/review-session";
import { reviewReady } from "../../lib/review-workspace";

export async function approveCallout(_previous: ApprovalState, formData: FormData): Promise<ApprovalState> {
  const calloutId = formData.get("callout_id");
  const shiftId = formData.get("shift_id");
  if (typeof calloutId !== "string" || !recordIdPattern.test(calloutId) ||
      typeof shiftId !== "string" || !recordIdPattern.test(shiftId)) {
    return { status: "error", message: "Refresh the page and select a matched callout." };
  }

  const supabase = await getServerSupabase(true);
  const auth = await supabase?.auth.getClaims();
  if (!supabase || auth?.error || !auth?.data?.claims.sub) {
    return { status: "error", message: "Sign in again before approving a callout." };
  }

  const workspace = await authorizedReview(supabase, auth.data.claims.sub);
  const period = workspace.uploads.callouts;
  if (!reviewReady(workspace) || !period || !workspace.organizationId) {
    return { status: "error", message: "Operations needs to load both source files before approval." };
  }
  const { data: visible, error: visibilityError } = await supabase.from("callouts").select("id")
    .eq("id", calloutId).eq("organization_id", workspace.organizationId)
    .gte("occurred_at", period.from).lt("occurred_at", period.to).maybeSingle();
  if (visibilityError || !visible) {
    return { status: "error", message: "This callout is outside your active review or assigned site." };
  }

  const { data, error } = await supabase.rpc("approve_callout", {
    p_callout_id: calloutId,
    p_shift_id: shiftId,
  });
  if (error?.code === "42501") {
    return { status: "error", message: "Only an assigned site manager can approve this callout." };
  }
  if (error?.code === "P0AP1") {
    return { status: "error", message: "The roster match needs another review. Refresh the page and check the shift." };
  }
  if (error?.code === "P0AP2") {
    return { status: "error", message: "This company needs an allowance rate before approval." };
  }
  if (error || !data) {
    return { status: "error", message: "Could not confirm the approval. Try again." };
  }

  revalidatePath("/shift-review");
  revalidatePath("/approved");
  const amount = formatAllowance(data.amount_minor, data.currency);
  return { status: "success", message: data.created ? `Approved · ${amount}` : `Already approved · ${amount}` };
}
