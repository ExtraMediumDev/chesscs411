const fs = require("fs");
const path = require("path");
const readline = require("readline");

let mysql = null;
try {
  mysql = require("mysql2/promise");
} catch {
  mysql = null;
}

const ROOT = path.resolve(__dirname, "..");
const GENERATED_DIR = path.join(ROOT, "generated");
const INPUT_FILE = process.env.FIDE_INPUT_FILE || path.join(ROOT, "fide_combined", "players_list_foa.txt");
const RATING_DATE = process.env.RATING_DATE || "2026-04-01";
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 5000);
const TOURNAMENT_COUNT = Number(process.env.TOURNAMENT_COUNT || 220);
const RESULTS_PER_TOURNAMENT = Number(process.env.RESULTS_PER_TOURNAMENT || 24);
const USER_COUNT = Number(process.env.USER_COUNT || 25);
const HISTORICAL_RATING_YEARS = [2020, 2021, 2022, 2023, 2024, 2025];

const TOURNAMENT_SERIES = [
  "Grandmasters Cup",
  "International Masters Open",
  "Continental Classic",
  "Rapid Challenge",
  "Spring Invitational",
  "Autumn Championship",
  "Elite Open",
  "Chess Heritage Trophy",
  "Grand Prix",
  "Super Tournament",
  "Candidates Open",
  "Olympiad Qualifier",
  "Blitz Championship",
  "Classical Round-Robin",
  "Memorial Open",
  "Rising Stars Invitational",
  "Champions League",
  "National Cup",
  "Masters Rapid",
  "Winter Classic",
];

const LOCATIONS = [
  "Chennai, IND",
  "Baku, AZE",
  "Saint Louis, USA",
  "Wijk aan Zee, NED",
  "Warsaw, POL",
  "Astana, KAZ",
  "Tashkent, UZB",
  "Budapest, HUN",
  "Berlin, GER",
  "Madrid, ESP",
  "Bucharest, ROU",
  "Tbilisi, GEO",
  "Doha, QAT",
  "Dubai, UAE",
  "Dhaka, BAN",
  "Cairo, EGY",
];

function parseIntSafe(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeBirthday(year) {
  if (!year || year < 1900 || year > new Date().getFullYear()) {
    return null;
  }
  return `${year}-01-01`;
}

function hasAlphabeticName(name) {
  return /[A-Za-z]/.test(name);
}

function parseFideLine(line) {
  return {
    player_ID: parseIntSafe(line.slice(0, 15)),
    Name: line.slice(15, 76).trim().replace(/\s+/g, " "),
    Country: line.slice(76, 80).trim() || null,
    Gender: line.slice(80, 84).trim() || null,
    standard: parseIntSafe(line.slice(113, 119)),
    rapid: parseIntSafe(line.slice(126, 132)),
    blitz: parseIntSafe(line.slice(139, 145)),
    birthYear: parseIntSafe(line.slice(152, 158)),
  };
}

async function loadRealPlayersAndRatings() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`FIDE input file not found: ${INPUT_FILE}`);
  }

  const players = [];
  const ratings = [];
  const seenPlayers = new Set();

  const fileStream = fs.createReadStream(INPUT_FILE, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let isHeader = true;

  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    const parsed = parseFideLine(line);
    const hasAnyRating = parsed.standard > 0 || parsed.rapid > 0 || parsed.blitz > 0;

    if (!parsed.player_ID || !parsed.Name || !hasAlphabeticName(parsed.Name) || !hasAnyRating) {
      continue;
    }

    if (seenPlayers.has(parsed.player_ID)) {
      continue;
    }

    seenPlayers.add(parsed.player_ID);
    players.push({
      player_ID: parsed.player_ID,
      Name: parsed.Name,
      Country: parsed.Country,
      Gender: parsed.Gender,
      Birthday: normalizeBirthday(parsed.birthYear),
      strongestRating: Math.max(parsed.standard, parsed.rapid, parsed.blitz),
    });

    if (parsed.standard > 0) {
      const standardBase = parsed.standard;
      const historicalRng = mulberry32(parsed.player_ID);

      for (const year of HISTORICAL_RATING_YEARS) {
        const yearOffset = year - HISTORICAL_RATING_YEARS[0];
        const variation = Math.floor(historicalRng() * 41) - 20;
        const rating = Math.max(100, standardBase - (6 - yearOffset) * 8 + variation);

        ratings.push({
          player_ID: parsed.player_ID,
          Rating_Type: "standard",
          RatingDate: `${year}-01-01`,
          Rating: rating,
        });
      }

      ratings.push({
        player_ID: parsed.player_ID,
        Rating_Type: "standard",
        RatingDate: RATING_DATE,
        Rating: standardBase,
      });
    }

    if (parsed.rapid > 0) {
      ratings.push({
        player_ID: parsed.player_ID,
        Rating_Type: "rapid",
        RatingDate: RATING_DATE,
        Rating: parsed.rapid,
      });
    }

    if (parsed.blitz > 0) {
      ratings.push({
        player_ID: parsed.player_ID,
        Rating_Type: "blitz",
        RatingDate: RATING_DATE,
        Rating: parsed.blitz,
      });
    }

    if (players.length >= MAX_PLAYERS) {
      break;
    }
  }

  return { players, ratings };
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6D2B79F5;
    let result = Math.imul(t ^ (t >>> 15), t | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function chooseUniquePlayers(sortedPlayers, tournamentIndex, count) {
  const rng = mulberry32(1000 + tournamentIndex);
  const chosen = [];
  const used = new Set();

  while (chosen.length < count && used.size < sortedPlayers.length) {
    const index = Math.floor(rng() * sortedPlayers.length);
    const player = sortedPlayers[index];
    if (used.has(player.player_ID)) {
      continue;
    }
    used.add(player.player_ID);
    chosen.push(player);
  }

  return chosen;
}

function generateHybridTournamentData(players) {
  const playerPool = [...players];
  const tournaments = [];
  const results = [];

  for (let i = 0; i < TOURNAMENT_COUNT; i += 1) {
    const year = 2023 + (i % 4);
    const month = i % 12;
    const day = 1 + (i % 28);
    const location = LOCATIONS[i % LOCATIONS.length];
    const city = location.split(",")[0].trim();
    const series = TOURNAMENT_SERIES[i % TOURNAMENT_SERIES.length];
    const tournament = {
      Tournament_ID: i + 1,
      Tournament_Name: `${city} ${series} ${year}`,
      Location: location,
      Start_Date: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    };
    tournaments.push(tournament);

    const fieldSize = RESULTS_PER_TOURNAMENT + (i % 5);
    const tournamentPlayers = chooseUniquePlayers(playerPool, i, fieldSize);

    tournamentPlayers.forEach((player) => {
      const rng = mulberry32((i + 1) * 100000 + player.player_ID);
      const gamesPlayed = 8 + Math.floor(rng() * 5);
      const gamesWon = Math.min(gamesPlayed, Math.floor(rng() * (gamesPlayed + 1)));
      const ratingChange = Math.floor(rng() * 31) - 15;

      results.push({
        player_ID: player.player_ID,
        Tournament_ID: tournament.Tournament_ID,
        GamesWon: gamesWon,
        GamesPlayed: gamesPlayed,
        RatingChange: ratingChange,
      });
    });
  }

  return { tournaments, results };
}

const USERNAME_PREFIXES = [
  "chess", "knight", "bishop", "rook", "pawn", "queen", "king",
  "gambit", "elo", "blitz", "rapid", "endgame", "castled", "checkmate",
  "grandmaster", "opening", "tactics", "board", "fianchetto", "zugzwang",
  "skewer", "fork", "pin", "tempo", "sicilian",
];

const USERNAME_SUFFIXES = [
  "pro", "fan", "master", "player", "wizard", "guru", "ace",
  "hero", "legend", "star", "shark", "hawk", "wolf", "fox", "lion",
];

function generateUsers() {
  const users = [];
  const rng = mulberry32(42);
  for (let i = 1; i <= USER_COUNT; i += 1) {
    const prefix = USERNAME_PREFIXES[Math.floor(rng() * USERNAME_PREFIXES.length)];
    const suffix = USERNAME_SUFFIXES[Math.floor(rng() * USERNAME_SUFFIXES.length)];
    const num = Math.floor(rng() * 900) + 100;
    users.push({
      user_Id: i,
      Username: `${prefix}_${suffix}${num}`,
      Password: `hashed_${Math.floor(rng() * 1e12).toString(36)}`,
    });
  }
  return users;
}

function sqlValue(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function buildInsert(tableName, columns, rows, batchSize = 500) {
  const statements = [];

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = batch
      .map((row) => `(${columns.map((column) => sqlValue(row[column])).join(", ")})`)
      .join(",\n");
    statements.push(`INSERT INTO ${tableName} (${columns.join(", ")}) VALUES\n${values};`);
  }

  return statements;
}

function buildSql(dataset) {
  const statements = [
    "USE chessdb;",
    "SET FOREIGN_KEY_CHECKS = 0;",
    "TRUNCATE TABLE TournamentResults;",
    "TRUNCATE TABLE Ratings;",
    "TRUNCATE TABLE Tournaments;",
    "TRUNCATE TABLE UserAccount;",
    "TRUNCATE TABLE Players;",
    "SET FOREIGN_KEY_CHECKS = 1;",
    ...buildInsert("Players", ["player_ID", "Name", "Country", "Gender", "Birthday"], dataset.players),
    ...buildInsert("Ratings", ["player_ID", "Rating_Type", "RatingDate", "Rating"], dataset.ratings),
    ...buildInsert("Tournaments", ["Tournament_ID", "Tournament_Name", "Location", "Start_Date"], dataset.tournaments),
    ...buildInsert("TournamentResults", ["player_ID", "Tournament_ID", "GamesWon", "GamesPlayed", "RatingChange"], dataset.results),
    ...buildInsert("UserAccount", ["user_Id", "Username", "Password"], dataset.users),
    "SELECT 'Players' AS table_name, COUNT(*) AS row_count FROM Players;",
    "SELECT 'Ratings' AS table_name, COUNT(*) AS row_count FROM Ratings;",
    "SELECT 'Tournaments' AS table_name, COUNT(*) AS row_count FROM Tournaments;",
    "SELECT 'TournamentResults' AS table_name, COUNT(*) AS row_count FROM TournamentResults;",
    "SELECT 'UserAccount' AS table_name, COUNT(*) AS row_count FROM UserAccount;",
  ];

  return statements.join("\n\n");
}

function buildCountsSql() {
  return [
    "USE chessdb;",
    "SELECT 'Players' AS table_name, COUNT(*) AS row_count FROM Players;",
    "SELECT 'Ratings' AS table_name, COUNT(*) AS row_count FROM Ratings;",
    "SELECT 'Tournaments' AS table_name, COUNT(*) AS row_count FROM Tournaments;",
    "SELECT 'TournamentResults' AS table_name, COUNT(*) AS row_count FROM TournamentResults;",
    "SELECT 'UserAccount' AS table_name, COUNT(*) AS row_count FROM UserAccount;",
  ].join("\n\n");
}

async function maybeLoadDirectly(dataset) {
  if (!process.argv.includes("--load")) {
    return;
  }

  if (!mysql) {
    throw new Error("mysql2 is not installed; cannot use --load.");
  }

  const host = process.env.DB_HOST || "34.44.121.67";
  const user = process.env.DB_USER || "appuser";
  const password = process.env.DB_PASSWORD || "your_password_here";
  const database = process.env.DB_NAME || "chessdb";

  const connection = await mysql.createConnection({
    host,
    user,
    password,
    database,
    connectTimeout: 10000,
    multipleStatements: true,
  });

  try {
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    await connection.query("TRUNCATE TABLE TournamentResults");
    await connection.query("TRUNCATE TABLE Ratings");
    await connection.query("TRUNCATE TABLE Tournaments");
    await connection.query("TRUNCATE TABLE UserAccount");
    await connection.query("TRUNCATE TABLE Players");
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");

    for (const statement of buildInsert("Players", ["player_ID", "Name", "Country", "Gender", "Birthday"], dataset.players)) {
      await connection.query(statement);
    }

    for (const statement of buildInsert("Ratings", ["player_ID", "Rating_Type", "RatingDate", "Rating"], dataset.ratings)) {
      await connection.query(statement);
    }

    for (const statement of buildInsert("Tournaments", ["Tournament_ID", "Tournament_Name", "Location", "Start_Date"], dataset.tournaments)) {
      await connection.query(statement);
    }

    for (const statement of buildInsert("TournamentResults", ["player_ID", "Tournament_ID", "GamesWon", "GamesPlayed", "RatingChange"], dataset.results)) {
      await connection.query(statement);
    }

    for (const statement of buildInsert("UserAccount", ["user_Id", "Username", "Password"], dataset.users)) {
      await connection.query(statement);
    }
  } finally {
    await connection.end();
  }
}

async function main() {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });

  const realData = await loadRealPlayersAndRatings();
  const hybridData = generateHybridTournamentData(realData.players);
  const users = generateUsers();

  const dataset = {
    players: realData.players,
    ratings: realData.ratings,
    tournaments: hybridData.tournaments,
    results: hybridData.results,
    users,
  };

  const summary = {
    inputFile: INPUT_FILE,
    ratingDate: RATING_DATE,
    players: dataset.players.length,
    ratings: dataset.ratings.length,
    tournaments: dataset.tournaments.length,
    tournamentResults: dataset.results.length,
    users: dataset.users.length,
  };

  const sql = buildSql(dataset);
  fs.writeFileSync(path.join(GENERATED_DIR, "seed_chessdb.sql"), sql, "utf8");
  fs.writeFileSync(
    path.join(GENERATED_DIR, "players_real.sql"),
    ["USE chessdb;", ...buildInsert("Players", ["player_ID", "Name", "Country", "Gender", "Birthday"], dataset.players)].join("\n\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(GENERATED_DIR, "ratings_real.sql"),
    ["USE chessdb;", ...buildInsert("Ratings", ["player_ID", "Rating_Type", "RatingDate", "Rating"], dataset.ratings)].join("\n\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(GENERATED_DIR, "tournaments_hybrid.sql"),
    ["USE chessdb;", ...buildInsert("Tournaments", ["Tournament_ID", "Tournament_Name", "Location", "Start_Date"], dataset.tournaments)].join("\n\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(GENERATED_DIR, "tournament_results_hybrid.sql"),
    ["USE chessdb;", ...buildInsert("TournamentResults", ["player_ID", "Tournament_ID", "GamesWon", "GamesPlayed", "RatingChange"], dataset.results)].join("\n\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(GENERATED_DIR, "user_accounts_seed.sql"),
    ["USE chessdb;", ...buildInsert("UserAccount", ["user_Id", "Username", "Password"], dataset.users)].join("\n\n"),
    "utf8"
  );
  fs.writeFileSync(path.join(GENERATED_DIR, "count_queries.sql"), buildCountsSql(), "utf8");
  fs.writeFileSync(path.join(GENERATED_DIR, "seed_summary.json"), JSON.stringify(summary, null, 2), "utf8");

  await maybeLoadDirectly(dataset);

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
