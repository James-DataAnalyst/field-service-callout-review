import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database";
import { emptyReview, parseReview, type ReviewWorkspace } from "./review-workspace";

const cookieName = "callout-review";

export async function readReview() {
  const value = (await cookies()).get(cookieName)?.value;
  if (!value || value.length > 4000) return parseReview(undefined);
  // Base64url keeps filenames with spaces or non-ASCII characters within cookie limits.
  return parseReview(value.startsWith("{") ? value : Buffer.from(value, "base64url").toString("utf8"));
}

export async function saveReview(review: ReviewWorkspace) {
  (await cookies()).set(cookieName, Buffer.from(JSON.stringify(review), "utf8").toString("base64url"), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}

export async function authorizedReview(supabase: SupabaseClient<Database>, userId: string) {
  const review = await readReview();
  if (!review.organizationId) return { ...review, lastUserId: userId };
  const { data, error } = await supabase.from("organizations").select("id").eq("id", review.organizationId).maybeSingle();
  return !error && data ? review : emptyReview(userId);
}

export async function reviewApprovalTotals(supabase: SupabaseClient<Database>, review: ReviewWorkspace) {
  const period = review.uploads.callouts;
  const totals = new Map<string, { currency: string; approved_count: number; total_minor: number }>();
  if (!period || !review.organizationId) return { data: [], error: null };
  for (let offset = 0; ;) {
    const { data, error, count } = await supabase.from("callout_approvals").select("amount_minor, currency", { count: "exact" })
      .eq("organization_id", review.organizationId).gte("occurred_at", period.from).lt("occurred_at", period.to)
      .order("callout_id").range(offset, offset + 999);
    if (error) return { data: [], error };
    for (const row of data ?? []) {
      const total = totals.get(row.currency) ?? { currency: row.currency, approved_count: 0, total_minor: 0 };
      total.approved_count++;
      total.total_minor += row.amount_minor;
      totals.set(row.currency, total);
    }
    offset += data?.length ?? 0;
    if (!data?.length || (count !== null && offset >= count)) return { data: [...totals.values()], error: null };
  }
}
