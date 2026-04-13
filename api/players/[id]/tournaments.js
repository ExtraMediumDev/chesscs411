const { query } = require("../../../lib/db");

module.exports = async (req, res) => {
  try {
    const { id } = req.query;
    const rows = await query(
      `SELECT t.Tournament_ID, t.Tournament_Name, t.Location, t.Start_Date,
         tr.GamesWon, tr.GamesPlayed, tr.RatingChange
       FROM TournamentResults tr
       JOIN Tournaments t ON tr.Tournament_ID = t.Tournament_ID
       WHERE tr.player_ID = ?
       ORDER BY t.Start_Date DESC
       LIMIT 20`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
