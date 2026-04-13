const { query } = require("../lib/db");

module.exports = async (req, res) => {
  try {
    const rows = await query(
      `SELECT t.Tournament_ID, t.Tournament_Name, t.Location, t.Start_Date,
         COUNT(tr.player_ID) AS participants
       FROM Tournaments t
       LEFT JOIN TournamentResults tr ON t.Tournament_ID = tr.Tournament_ID
       GROUP BY t.Tournament_ID, t.Tournament_Name, t.Location, t.Start_Date
       ORDER BY t.Start_Date DESC
       LIMIT 30`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
