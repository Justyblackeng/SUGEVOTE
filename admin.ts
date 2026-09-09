// Shared admin auth for admin-overview / admin-ballot / admin-settings.
//
// This is a single shared-secret key (sent as the x-admin-key header),
// not Supabase's own JWT auth — that's why every admin function also
// has verify_jwt = false in supabase/config.toml. Set the real secret
// with:
//   supabase secrets set ADMIN_KEY=some-long-random-string

import { corsHeaders } from "./cors.ts";

export function checkAdminKey(req: Request): Response | null {
  const provided = req.headers.get("x-admin-key") || "";
  const expected = Deno.env.get("ADMIN_KEY") || "";

  // If ADMIN_KEY was never set, fail closed rather than accepting any
  // key (or none) as valid.
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
  return null;
}
