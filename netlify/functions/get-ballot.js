const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async () => {
  try {
    const { data: positions, error: posErr } = await supabase
      .from("positions")
      .select("id, title, sort_order")
      .order("sort_order", { ascending: true });

    if (posErr) throw posErr;

    const { data: candidates, error: candErr } = await supabase
      .from("candidates")
      .select("id, position_id, name, tag");

    if (candErr) throw candErr;

    const ballot = (positions || []).map((pos) => ({
      id: pos.id,
      title: pos.title,
      sub: "Vote for one",
      candidates: (candidates || [])
        .filter((c) => c.position_id === pos.id)
        .map((c) => ({ id: c.id, name: c.name, tag: c.tag })),
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ballot),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Could not load ballot" }),
    };
  }
};
