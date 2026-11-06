import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database";

export function createSessionClient(cookieMethods: CookieMethodsServer) {
  const url = process.env.SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

  if (!URL.canParse(url) || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    return null;
  }

  const project = new URL(url);
  if (
    project.protocol !== "https:" ||
    project.username ||
    project.password ||
    project.pathname !== "/" ||
    project.search ||
    project.hash
  ) {
    return null;
  }

  return createServerClient<Database>(project.origin, key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
    cookies: cookieMethods,
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}

export async function getServerSupabase(canWriteCookies = false) {
  const jar = await cookies();

  return createSessionClient({
    getAll: () => jar.getAll(),
    setAll: (updated) => {
      // The proxy saves refreshed cookies for pages. Auth actions save their own.
      if (canWriteCookies) {
        for (const { name, value, options } of updated) {
          jar.set(name, value, options);
        }
      }
    },
  });
}
