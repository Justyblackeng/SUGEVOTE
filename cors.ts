// Shared CORS handling for all SUMAS E-VOTE edge functions.
//
// Netlify (the static site) and Supabase (the functions) are now on
// different domains, so — unlike the old same-origin Netlify Functions
// setup — every request from the browser is now cross-origin and needs
// CORS headers, including a response to the preflight OPTIONS request
// the browser sends before every POST.
//
// Set ALLOWED_ORIGIN as a function secret to your Netlify site's exact
// origin (e.g. "https://sumas-evote.netlify.app") to lock this down.
// Left unset, it defaults to "*" so the app works out of the box.

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Call at the top of every handler. Returns a Response for OPTIONS
// preflight requests, or null if the request should proceed normally.
export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
