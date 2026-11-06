"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "../lib/supabase";
import { readReview, saveReview } from "../lib/review-session";
import { emptyReview, reviewForLogin } from "../lib/review-workspace";

export async function signIn(formData: FormData) {
  const emailInput = formData.get("email");
  const password = formData.get("password");
  const email = typeof emailInput === "string" ? emailInput.trim().toLowerCase() : "";

  if (
    !email.includes("@") ||
    email.length > 254 ||
    typeof password !== "string" ||
    !password ||
    password.length > 1024
  ) {
    redirect("/sign-in?error=credentials");
  }

  const supabase = await getServerSupabase(true);
  if (!supabase) {
    redirect("/sign-in");
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(error.status === 429 ? "/sign-in?error=wait" : "/sign-in?error=credentials");
  }

  const review = await readReview();
  await saveReview(reviewForLogin(review, data.user.id));
  const { data: assignments } = await supabase.from("organization_admins").select("organization_id").eq("user_id", data.user.id).limit(1);
  revalidatePath("/", "layout");
  redirect(assignments?.length ? "/imports" : "/shift-review");
}

export async function signOut() {
  const supabase = await getServerSupabase(true);
  if (supabase) {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      redirect("/?error=sign-out");
    }
  }
  revalidatePath("/", "layout");
  redirect("/sign-in");
}

export async function newReview() {
  const supabase = await getServerSupabase(true);
  const auth = await supabase?.auth.getClaims();
  if (!supabase || auth?.error || !auth?.data?.claims.sub) redirect("/sign-in");
  const { data } = await supabase.from("organization_admins").select("organization_id").eq("user_id", auth.data.claims.sub).limit(1);
  if (!data?.length) redirect("/imports");
  await saveReview(emptyReview(auth.data.claims.sub));
  revalidatePath("/", "layout");
  redirect("/imports");
}
