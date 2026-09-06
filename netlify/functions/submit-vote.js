const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: "method_not_allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: "invalid_body" }) };
  }

  const matric = String(body.matric || "").trim().toUpperCase();
  const selections = body.selections;

  if (!matric || !selections || typeof selections !== "object") {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: "missing_fields" }) };
  }

  const entries = Object.entries(selections);
  if (entries.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: "empty_ballot" }) };
  }

  try {
    // Require a valid, unexpired ticket issued by verify-otp. Without
    // this, a student who never completed OTP verification (or whose
    // ticket already expired) cannot submit a vote no matter what the
    // browser sends.
    const { data: authRow, error: authErr } = await supabase
      .from("vote_authorizations")
      .select("expires_at")
      .eq("matric", matric)
      .maybeSingle();
    if (authErr) throw authErr;

    if (!authRow) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: "not_verified" }) };
    }
    if (new Date(authRow.expires_at) < new Date()) {
      await supabase.from("vote_authorizations").delete().eq("matric", matric);
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: "verification_expired" }) };
    }

    // Validate every selection against real position/candidate pairs,
    // so a tampered request can't stuff votes for fake IDs.
    const { data: candidates, error: candErr } = await supabase
      .from("candidates")
      .select("id, position_id");

    if (candErr) throw candErr;

    const validPairs = new Set((candidates || []).map((c) => `${c.position_id}:${c.id}`));
    for (const [positionId, candidateId] of entries) {
      if (!validPairs.has(`${positionId}:${candidateId}`)) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: "invalid_selection" }) };
      }
    }

    // Atomically claim this matric number as having voted.
    // voted_log.matric has a unique constraint, so a second attempt
    // (double click, retry, or repeat submission) fails safely here
    // before any vote rows are written.
    const { error: claimErr } = await supabase
      .from("voted_log")
      .insert({ matric });

    if (claimErr) {
      if (claimErr.code === "23505") {
        return { statusCode: 200, body: JSON.stringify({ ok: false, error: "already_voted" }) };
      }
      throw claimErr;
    }

    // Record anonymous vote rows — no matric or voter id attached,
    // so an individual ballot can never be traced back to a student.
    const rows = entries.map(([positionId, candidateId]) => ({
      position_id: positionId,
      candidate_id: candidateId,
    }));

    const { error: voteErr } = await supabase.from("votes").insert(rows);
    if (voteErr) throw voteErr;

    // One-time ticket — remove it now that it's been used.
    await supabase.from("vote_authorizations").delete().eq("matric", matric);

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: "server_error" }) };
  }
};
