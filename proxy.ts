import { NextResponse, type NextRequest } from "next/server";
import { createSessionClient } from "./lib/supabase";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createSessionClient({
    getAll: () => request.cookies.getAll(),
    setAll: (updated, headers) => {
      for (const { name, value } of updated) {
        request.cookies.set(name, value);
      }
      response = NextResponse.next({ request });
      for (const { name, value, options } of updated) {
        response.cookies.set(name, value, options);
      }
      for (const [name, value] of Object.entries(headers ?? {})) {
        response.headers.set(name, value);
      }
    },
  });

  if (supabase) {
    await supabase.auth.getClaims();
  }

  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/", "/sign-in", "/imports", "/shift-review", "/approved", "/approved/export"],
};
