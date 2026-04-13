const { query } = require("../../lib/db");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { Name, Country, Gender, Birthday } = JSON.parse(body);

    if (!Name) return res.status(400).json({ error: "Name is required" });

    const rows = await query("SELECT MAX(player_ID) AS maxId FROM Players");
    const result = rows[0];
    const newId = (result.maxId || 0) + 1;

    await query(
      "INSERT INTO Players (player_ID, Name, Country, Gender, Birthday) VALUES (?, ?, ?, ?, ?)",
      [newId, Name, Country || null, Gender || null, Birthday || null]
    );

    res.json({ success: true, player_ID: newId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
