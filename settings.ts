// deno-lint-ignore-file no-explicit-any
// Shared helpers for reading election_settings (results_public,
// poll_open_at, poll_close_at) — used by get-results, request-otp,
// submit-vote, verify-otp, admin-overview, and admin-settings so the
// poll-window rules stay identical everywhere they're enforced.

export interface PollSettings {
  resultsPublic: boolean;
  pollOpenAt: string | null;
  pollCloseAt: string | null;
}

export async function getPollSettings(supabase: any): Promise<PollSettings> {
  const { data, error } = await supabase
    .from("election_settings")
    .select("key, value")
    .in("key", ["results_public", "poll_open_at", "poll_close_at"]);
  if (error) throw error;

  const map: Record<string, string | null> = {};
  (data || []).forEach((row: any) => {
    map[row.key] = row.value;
  });

  return {
    // Missing row defaults to visible, same as the original behavior.
    resultsPublic: map.results_public === undefined
      ? true
      : map.results_public === "true",
    pollOpenAt: map.poll_open_at || null,
    pollCloseAt: map.poll_close_at || null,
  };
}

export function pollWindowError(settings: PollSettings): "poll_not_open" | "poll_closed" | null {
  const now = new Date();
  if (settings.pollCloseAt && now >= new Date(settings.pollCloseAt)) {
    return "poll_closed";
  }
  if (settings.pollOpenAt && now < new Date(settings.pollOpenAt)) {
    return "poll_not_open";
  }
  return null;
}

export function isPollClosed(settings: PollSettings): boolean {
  return !!settings.pollCloseAt && new Date() >= new Date(settings.pollCloseAt);
}
