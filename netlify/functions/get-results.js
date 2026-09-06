const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async () => {
  try {
    const { data: setting, error: settingErr } = await supabase
      .from("election_settings")
      .select("value")
      .eq("key", "results_public")
      .maybeSingle();

    if (settingErr) throw settingErr;

    // Defaults to visible if the setting row is missing, so the demo
    // works out of the box. Set results_public to 'false' in the
    // election_settings table to hide results until polls close.
    const resultsPublic = setting ? setting.value === "true" : true;

    if (!resultsPublic) {
      return { statusCode: 200, body: JSON.stringify({ visible: false }) };
    }

    const { data: positions, error: posErr } = await supabase
      .from("positions")
      .select("id, title, sort_order")
      .order("sort_order", { ascending: true });
    if (posErr) throw posErr;

    const { data: candidates, error: candErr } = await supabase
      .from("candidates")
      .select("id, position_id, name, tag");
    if (candErr) throw candErr;

    const { data: votes, error: voteErr } = await supabase
      .from("votes")
      .select("position_id, candidate_id");
    if (voteErr) throw voteErr;

    const tally = {};
    (votes || []).forEach((v) => {
      const key = `${v.position_id}:${v.candidate_id}`;
      tally[key] = (tally[key] || 0) + 1;
    });

    const results = (positions || []).map((pos) => ({
      id: pos.id,
      title: pos.title,
      candidates: (candidates || [])
        .filter((c) => c.position_id === pos.id)
        .map((c) => ({
          id: c.id,
          name: c.name,
          tag: c.tag,
          votes: tally[`${pos.id}:${c.id}`] || 0,
        })),
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ visible: true, results }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "server_error" }) };
  }
};
