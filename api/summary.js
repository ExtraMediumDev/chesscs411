const { query } = require("../lib/db");

module.exports = async (req, res) => {
  try {
    const [p] = await query("SELECT COUNT(*) AS c FROM Players");
    const [r] = await query("SELECT COUNT(*) AS c FROM Ratings");
    const [t] = await query("SELECT COUNT(*) AS c FROM Tournaments");
    const [tr] = await query("SELECT COUNT(*) AS c FROM TournamentResults");

    res.json({ players: p.c, ratings: r.c, tournaments: t.c, results: tr.c });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
