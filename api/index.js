const mysql = require("mysql2/promise");

let pool;
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "34.44.121.67",
      user: process.env.DB_USER || "appuser",
      password: process.env.DB_PASSWORD || "your_password_here",
      database: process.env.DB_NAME || "chessdb",
      connectTimeout: 10000,
      waitForConnections: true,
      connectionLimit: 5,
    });
  }
  return pool;
}

async function sql(query, params = []) {
  const [rows] = await getPool().query(query, params);
  return rows;
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body);
}

function match(pathname, pattern) {
  const regex = new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$");
  const m = pathname.match(regex);
  return m ? m.groups || {} : null;
}

module.exports = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;
  const params = url.searchParams;

  try {
    let m;

    if (path === "/api/summary") {
      const [p] = await sql("SELECT COUNT(*) AS c FROM Players");
      const [r] = await sql("SELECT COUNT(*) AS c FROM Ratings");
      const [t] = await sql("SELECT COUNT(*) AS c FROM Tournaments");
      const [tr] = await sql("SELECT COUNT(*) AS c FROM TournamentResults");
      return res.json({ players: p.c, ratings: r.c, tournaments: t.c, results: tr.c });
    }

    if (path === "/api/tournaments") {
      const rows = await sql(
        `SELECT t.Tournament_ID, t.Tournament_Name, t.Location, t.Start_Date,
           COUNT(tr.player_ID) AS participants
         FROM Tournaments t
         LEFT JOIN TournamentResults tr ON t.Tournament_ID = tr.Tournament_ID
         GROUP BY t.Tournament_ID, t.Tournament_Name, t.Location, t.Start_Date
         ORDER BY t.Start_Date DESC
         LIMIT 30`
      );
      return res.json(rows);
    }

    if (path === "/api/players") {
      if (method === "POST") {
        const { Name, Country, Gender, Birthday } = await readBody(req);
        if (!Name) return res.status(400).json({ error: "Name is required" });
        const rows = await sql("SELECT MAX(player_ID) AS maxId FROM Players");
        const newId = (rows[0].maxId || 0) + 1;
        await sql(
          "INSERT INTO Players (player_ID, Name, Country, Gender, Birthday) VALUES (?, ?, ?, ?, ?)",
          [newId, Name, Country || null, Gender || null, Birthday || null]
        );
        return res.json({ success: true, player_ID: newId });
      }

      const search = params.get("search") || "";
      const rows = await sql(
        `SELECT p.player_ID, p.Name, p.Country, p.Gender, rs.Rating AS standard_rating
         FROM Players p
         LEFT JOIN Ratings rs
           ON rs.player_ID = p.player_ID
           AND rs.Rating_Type = 'standard'
           AND rs.RatingDate = '2026-04-01'
         WHERE p.Name LIKE ?
         ORDER BY rs.Rating DESC, p.Name ASC
         LIMIT 25`,
        [`%${search}%`]
      );
      return res.json(rows);
    }

    if ((m = match(path, "/api/players/:id/ratings"))) {
      const type = params.get("type") || "standard";
      const rows = await sql(
        "SELECT RatingDate, Rating FROM Ratings WHERE player_ID = ? AND Rating_Type = ? ORDER BY RatingDate",
        [m.id, type]
      );
      return res.json(rows);
    }

    if ((m = match(path, "/api/players/:id/tournaments"))) {
      const rows = await sql(
        `SELECT t.Tournament_ID, t.Tournament_Name, t.Location, t.Start_Date,
           tr.GamesWon, tr.GamesPlayed, tr.RatingChange
         FROM TournamentResults tr
         JOIN Tournaments t ON tr.Tournament_ID = t.Tournament_ID
         WHERE tr.player_ID = ?
         ORDER BY t.Start_Date DESC
         LIMIT 20`,
        [m.id]
      );
      return res.json(rows);
    }

    if ((m = match(path, "/api/players/:id"))) {
      if (method === "PUT") {
        const { Name, Country, Gender, Birthday } = await readBody(req);
        if (!Name) return res.status(400).json({ error: "Name is required" });
        const result = await sql(
          "UPDATE Players SET Name = ?, Country = ?, Gender = ?, Birthday = ? WHERE player_ID = ?",
          [Name, Country || null, Gender || null, Birthday || null, m.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: "Player not found" });
        return res.json({ success: true });
      }

      if (method === "DELETE") {
        await sql("DELETE FROM TournamentResults WHERE player_ID = ?", [m.id]);
        await sql("DELETE FROM Ratings WHERE player_ID = ?", [m.id]);
        const result = await sql("DELETE FROM Players WHERE player_ID = ?", [m.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: "Player not found" });
        return res.json({ success: true });
      }

      const rows = await sql(
        `SELECT p.player_ID, p.Name, p.Country, p.Gender, p.Birthday,
           rs.Rating AS standard_rating,
           rr.Rating AS rapid_rating,
           rb.Rating AS blitz_rating
         FROM Players p
         LEFT JOIN Ratings rs
           ON rs.player_ID = p.player_ID
           AND rs.Rating_Type = 'standard'
           AND rs.RatingDate = '2026-04-01'
         LEFT JOIN Ratings rr
           ON rr.player_ID = p.player_ID
           AND rr.Rating_Type = 'rapid'
           AND rr.RatingDate = '2026-04-01'
         LEFT JOIN Ratings rb
           ON rb.player_ID = p.player_ID
           AND rb.Rating_Type = 'blitz'
           AND rb.RatingDate = '2026-04-01'
         WHERE p.player_ID = ?`,
        [m.id]
      );
      if (!rows[0]) return res.status(404).json({ error: "Player not found" });
      return res.json(rows[0]);
    }

    if (path === "/api/analytics/win-rates") {
      const rows = await sql(
        `SELECT p.Country,
           COUNT(*) AS total_participations,
           SUM(tr.GamesWon) AS total_wins,
           SUM(tr.GamesPlayed) AS total_games,
           ROUND(SUM(tr.GamesWon) / SUM(tr.GamesPlayed), 4) AS win_rate
         FROM Players p
         JOIN TournamentResults tr ON p.player_ID = tr.player_ID
         WHERE tr.GamesPlayed > 1
         GROUP BY p.Country
         ORDER BY win_rate DESC
         LIMIT 15`
      );
      return res.json(rows);
    }

    if (path === "/api/analytics/top-winners") {
      const rows = await sql(
        `SELECT p.player_ID, p.Name,
           COUNT(*) AS tournaments_played,
           SUM(tr.GamesWon) AS total_wins,
           SUM(tr.GamesPlayed) AS total_games
         FROM Players p
         JOIN TournamentResults tr ON p.player_ID = tr.player_ID
         GROUP BY p.player_ID, p.Name
         HAVING SUM(tr.GamesPlayed) > 0
         ORDER BY total_wins DESC
         LIMIT 15`
      );
      return res.json(rows);
    }

    if (path === "/api/analytics/rating-growth") {
      const rows = await sql(
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
      return res.json(rows);
    }

    if (path === "/api/reports/country-report") {
      const c = params.get("c") || "";
      const sets = await sql("CALL sp_country_report(?)", [c]);
      return res.json({ summary: sets[0] || [], top: sets[1] || [] });
    }

    if (path === "/api/tx/record-result" && method === "POST") {
      const b = await readBody(req);
      await sql(
        "CALL sp_record_result(?, ?, ?, ?, ?)",
        [b.player_ID, b.Tournament_ID, b.GamesPlayed, b.GamesWon, b.RatingChange]
      );
      return res.json({ success: true });
    }

    res.status(404).json({ error: "Not found" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
