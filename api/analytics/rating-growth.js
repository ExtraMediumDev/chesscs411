const { query } = require("../../lib/db");

module.exports = async (req, res) => {
  try {
    const rows = await query(
      `SELECT p.player_ID, p.Name, r.Rating_Type,
         MAX(r.Rating) - MIN(r.Rating) AS rating_growth
       FROM Players p
       JOIN Ratings r ON p.player_ID = r.player_ID
       WHERE r.Rating_Type = 'standard'
         AND r.RatingDate BETWEEN '2020-01-01' AND '2025-12-31'
       GROUP BY p.player_ID, p.Name, r.Rating_Type
       ORDER BY rating_growth DESC
       LIMIT 15`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
