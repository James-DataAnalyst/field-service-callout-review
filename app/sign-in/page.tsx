import { redirect } from "next/navigation";
import { getServerSupabase } from "../../lib/supabase";
import { signIn } from "../auth-actions";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const supabase = await getServerSupabase();

  if (supabase) {
    const { data, error } = await supabase.auth.getClaims();
    if (!error && data?.claims.sub) {
      redirect("/");
    }
  }

  const { error } = await searchParams;

  return (
    <main className="sign-in-shell">
      <div className="sign-in-frame">
        <div className="sign-in-intro">
          <p className="eyebrow">Field service</p>
          <p className="product-title">Callout Review</p>
          <p className="intro-copy">From dispatch and shift records to approved allowances.</p>
          <span className="environment">Demo workspace</span>
        </div>

        <section className="sign-in-panel" aria-labelledby="sign-in-title">
          <h1 id="sign-in-title">Sign in</h1>
          <p className="muted">Use your assigned demo account.</p>
          {supabase ? (
            <>
              {error === "credentials" && (
                <p className="notice notice-error" role="alert">
                  Sign-in failed. Check the email, password and account confirmation, then try again.
                </p>
              )}
              {error === "wait" && (
                <p className="notice notice-error" role="alert">
                  Too many attempts. Wait a moment, then try again.
                </p>
              )}
              <form action={signIn} className="sign-in-form">
                <label>
                  Email
                  <input type="email" name="email" autoComplete="username" maxLength={254} required />
                </label>
                <label>
                  Password
                  <input type="password" name="password" autoComplete="current-password" maxLength={1024} required />
                </label>
                <button type="submit">Sign in</button>
              </form>
            </>
          ) : (
            <p className="notice notice-error" role="status">
              Add your project URL and publishable key to <code>.env.local</code>, then restart the dev server.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
