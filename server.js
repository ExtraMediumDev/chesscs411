const http = require("http");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

const DB_CONFIG = {
  host: process.env.DB_HOST || "34.44.121.67",
  user: process.env.DB_USER || "appuser",
  password: process.env.DB_PASSWORD || "your_password_here",
  database: process.env.DB_NAME || "chessdb",
  connectTimeout: 10000,
};

const pool = mysql.createPool({
  ...DB_CONFIG,
  waitForConnections: true,
  connectionLimit: 10,
});

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(body);
}

async function serveStatic(reqPath, res) {
  const safePath = reqPath === "/" ? "/index.html" : reqPath;
  const resolvedPath = path.join(PUBLIC_DIR, safePath);

  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const contents = await fs.promises.readFile(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    sendText(res, 200, contents, MIME_TYPES[ext] || "application/octet-stream");
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function getHealth() {
  const rows = await query("SELECT 1 AS ok");
  return rows[0];
}

async function getSummary() {
  const [playerCount] = await query("SELECT COUNT(*) AS count FROM Players");
  const [ratingCount] = await query("SELECT COUNT(*) AS count FROM Ratings");
  const [tournamentCount] = await query("SELECT COUNT(*) AS count FROM Tournaments");
  const [resultCount] = await query("SELECT COUNT(*) AS count FROM TournamentResults");

  return {
    players: playerCount.count,
    ratings: ratingCount.count,
    tournaments: tournamentCount.count,
    results: resultCount.count,
  };
}

async function searchPlayers(searchTerm) {
  const likeValue = `%${searchTerm || ""}%`;
  return query(
    `
      SELECT
        p.player_ID,
        p.Name,
        p.Country,
        p.Gender,
        MAX(CASE WHEN r.Rating_Type = 'standard' AND r.RatingDate = '2026-04-01' THEN r.Rating END) AS standard_rating
      FROM Players p
      LEFT JOIN Ratings r
        ON p.player_ID = r.player_ID
      WHERE p.Name LIKE ?
      GROUP BY p.player_ID, p.Name, p.Country, p.Gender
      ORDER BY standard_rating DESC, p.Name ASC
      LIMIT 25
    `,
    [likeValue]
  );
}

async function getPlayer(playerId) {
  const rows = await query(
    `
      SELECT
        p.player_ID,
        p.Name,
        p.Country,
        p.Gender,
        p.Birthday,
        MAX(CASE WHEN r.Rating_Type = 'standard' AND r.RatingDate = '2026-04-01' THEN r.Rating END) AS standard_rating,
        MAX(CASE WHEN r.Rating_Type = 'rapid' AND r.RatingDate = '2026-04-01' THEN r.Rating END) AS rapid_rating,
        MAX(CASE WHEN r.Rating_Type = 'blitz' AND r.RatingDate = '2026-04-01' THEN r.Rating END) AS blitz_rating
      FROM Players p
      LEFT JOIN Ratings r
        ON p.player_ID = r.player_ID
      WHERE p.player_ID = ?
      GROUP BY p.player_ID, p.Name, p.Country, p.Gender, p.Birthday
    `,
    [playerId]
  );

  return rows[0] || null;
}

async function getPlayerRatings(playerId, ratingType) {
  return query(
    `
      SELECT RatingDate, Rating
      FROM Ratings
      WHERE player_ID = ?
        AND Rating_Type = ?
      ORDER BY RatingDate
    `,
    [playerId, ratingType || "standard"]
  );
}

async function getPlayerTournaments(playerId) {
  return query(
    `
      SELECT
        t.Tournament_ID,
        t.Tournament_Name,
        t.Location,
        t.Start_Date,
        tr.GamesWon,
        tr.GamesPlayed,
        tr.RatingChange
      FROM TournamentResults tr
      JOIN Tournaments t
        ON tr.Tournament_ID = t.Tournament_ID
      WHERE tr.player_ID = ?
      ORDER BY t.Start_Date DESC
      LIMIT 20
    `,
    [playerId]
  );
}

async function getTournaments() {
  return query(
    `
      SELECT
        t.Tournament_ID,
        t.Tournament_Name,
        t.Location,
        t.Start_Date,
        COUNT(tr.player_ID) AS participants
      FROM Tournaments t
      LEFT JOIN TournamentResults tr
        ON t.Tournament_ID = tr.Tournament_ID
      GROUP BY t.Tournament_ID, t.Tournament_Name, t.Location, t.Start_Date
      ORDER BY t.Start_Date DESC
      LIMIT 30
    `
  );
}

async function getCountryWinRates() {
  return query(
    `
      SELECT
        p.Country,
        COUNT(*) AS total_participations,
        SUM(tr.GamesWon) AS total_wins,
        SUM(tr.GamesPlayed) AS total_games,
        ROUND(SUM(tr.GamesWon) / SUM(tr.GamesPlayed), 4) AS win_rate
      FROM Players p
      JOIN TournamentResults tr
        ON p.player_ID = tr.player_ID
      WHERE tr.GamesPlayed > 1
      GROUP BY p.Country
      ORDER BY win_rate DESC
      LIMIT 15
    `
  );
}

async function getTopWinners() {
  return query(
    `
      SELECT
        p.player_ID,
        p.Name,
        COUNT(*) AS tournaments_played,
        SUM(tr.GamesWon) AS total_wins,
        SUM(tr.GamesPlayed) AS total_games
      FROM Players p
      JOIN TournamentResults tr
        ON p.player_ID = tr.player_ID
      GROUP BY p.player_ID, p.Name
      HAVING SUM(tr.GamesPlayed) > 0
      ORDER BY total_wins DESC
      LIMIT 15
    `
  );
}

async function getRatingGrowth() {
  return query(
    `
      SELECT
        p.player_ID,
        p.Name,
        r.Rating_Type,
        MAX(r.Rating) - MIN(r.Rating) AS rating_growth
      FROM Players p
      JOIN Ratings r
        ON p.player_ID = r.player_ID
      WHERE r.Rating_Type = 'standard'
        AND r.RatingDate BETWEEN '2020-01-01' AND '2025-12-31'
      GROUP BY p.player_ID, p.Name, r.Rating_Type
      ORDER BY rating_growth DESC
      LIMIT 15
    `
  );
}

async function handleApi(req, res, requestUrl) {
  const { pathname, searchParams } = requestUrl;

  try {
    if (pathname === "/api/health") {
      const health = await getHealth();
      sendJson(res, 200, { ok: true, database: health.ok === 1 });
      return;
    }

    if (pathname === "/api/summary") {
      const summary = await getSummary();
      sendJson(res, 200, summary);
      return;
    }

    if (pathname === "/api/players") {
      const search = searchParams.get("search") || "";
      const rows = await searchPlayers(search);
      sendJson(res, 200, rows);
      return;
    }

    if (pathname === "/api/tournaments") {
      const rows = await getTournaments();
      sendJson(res, 200, rows);
      return;
    }

    if (pathname === "/api/analytics/win-rates") {
      sendJson(res, 200, await getCountryWinRates());
      return;
    }

    if (pathname === "/api/analytics/top-winners") {
      sendJson(res, 200, await getTopWinners());
      return;
    }

    if (pathname === "/api/analytics/rating-growth") {
      sendJson(res, 200, await getRatingGrowth());
      return;
    }

    const playerMatch = pathname.match(/^\/api\/players\/(\d+)$/);
    if (playerMatch) {
      const player = await getPlayer(Number(playerMatch[1]));
      if (!player) {
        sendJson(res, 404, { error: "Player not found" });
        return;
      }
      sendJson(res, 200, player);
      return;
    }

    const ratingsMatch = pathname.match(/^\/api\/players\/(\d+)\/ratings$/);
    if (ratingsMatch) {
      const rows = await getPlayerRatings(Number(ratingsMatch[1]), searchParams.get("type"));
      sendJson(res, 200, rows);
      return;
    }

    const tournamentsMatch = pathname.match(/^\/api\/players\/(\d+)\/tournaments$/);
    if (tournamentsMatch) {
      const rows = await getPlayerTournaments(Number(tournamentsMatch[1]));
      sendJson(res, 200, rows);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname.startsWith("/api/")) {
    await handleApi(req, res, requestUrl);
    return;
  }

  await serveStatic(requestUrl.pathname, res);
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
