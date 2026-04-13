const { query } = require("../../lib/db");

async function getBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body);
}

module.exports = async (req, res) => {
  try {
    if (req.method === "POST") {
      const { Name, Country, Gender, Birthday } = await getBody(req);
      if (!Name) return res.status(400).json({ error: "Name is required" });

      const rows = await query("SELECT MAX(player_ID) AS maxId FROM Players");
      const newId = (rows[0].maxId || 0) + 1;

      await query(
        "INSERT INTO Players (player_ID, Name, Country, Gender, Birthday) VALUES (?, ?, ?, ?, ?)",
        [newId, Name, Country || null, Gender || null, Birthday || null]
      );

      return res.json({ success: true, player_ID: newId });
    }

    const search = req.query.search || "";
    const rows = await query(
      `SELECT p.player_ID, p.Name, p.Country, p.Gender,
         MAX(CASE WHEN r.Rating_Type = 'standard' AND r.RatingDate = '2026-04-01' THEN r.Rating END) AS standard_rating
       FROM Players p
       LEFT JOIN Ratings r ON p.player_ID = r.player_ID
       WHERE p.Name LIKE ?
       GROUP BY p.player_ID, p.Name, p.Country, p.Gender
       ORDER BY standard_rating DESC, p.Name ASC
       LIMIT 25`,
      [`%${search}%`]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
