const { query } = require("../../../lib/db");

module.exports = async (req, res) => {
  if (req.method !== "PUT" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { id } = req.query;
    let body = "";
    for await (const chunk of req) body += chunk;
    const { Name, Country, Gender, Birthday } = JSON.parse(body);

    if (!Name) return res.status(400).json({ error: "Name is required" });

    const result = await query(
      "UPDATE Players SET Name = ?, Country = ?, Gender = ?, Birthday = ? WHERE player_ID = ?",
      [Name, Country || null, Gender || null, Birthday || null, id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ error: "Player not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
