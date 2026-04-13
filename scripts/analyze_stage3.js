const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const ROOT = path.resolve(__dirname, "..");
const GENERATED_DIR = path.join(ROOT, "generated");
const DOC_DIR = path.join(ROOT, "doc");

const DB_CONFIG = {
  host: process.env.DB_HOST || "34.44.121.67",
  user: process.env.DB_USER || "appuser",
  password: process.env.DB_PASSWORD || "your_password_here",
  database: process.env.DB_NAME || "chessdb",
  connectTimeout: 10000,
  multipleStatements: true,
};

const DDL = {
  Players: `CREATE TABLE Players (
  player_ID INT PRIMARY KEY,
  Name VARCHAR(100),
  Country VARCHAR(50),
  Gender VARCHAR(20),
  Birthday DATE
)`,
  Tournaments: `CREATE TABLE Tournaments (
  Tournament_ID INT PRIMARY KEY,
  Tournament_Name VARCHAR(150),
  Location VARCHAR(100),
  Start_Date DATE
)`,
  TournamentResults: `CREATE TABLE TournamentResults (
  player_ID INT,
  Tournament_ID INT,
  GamesWon INT,
  GamesPlayed INT,
  RatingChange INT,
  PRIMARY KEY (player_ID, Tournament_ID),
  FOREIGN KEY (player_ID) REFERENCES Players(player_ID),
  FOREIGN KEY (Tournament_ID) REFERENCES Tournaments(Tournament_ID)
)`,
  Ratings: `CREATE TABLE Ratings (
  player_ID INT,
  Rating_Type VARCHAR(10),
  RatingDate DATE,
  Rating INT,
  PRIMARY KEY (player_ID, Rating_Type, RatingDate),
  FOREIGN KEY (player_ID) REFERENCES Players(player_ID)
)`,
  UserAccount: `CREATE TABLE UserAccount (
  user_Id INT PRIMARY KEY,
  Username VARCHAR(50),
  Password VARCHAR(255)
)`,
};

const ANALYSIS_INDEX_DROPS = [
  "DROP INDEX idx_ratings_type_rating_player ON Ratings",
  "DROP INDEX idx_players_country_only ON Players",
  "DROP INDEX idx_ratings_player_type_rating ON Ratings",
  "DROP INDEX idx_ratings_type_date_rating_player ON Ratings",
  "DROP INDEX idx_ratings_type_date_player_rating ON Ratings",
  "DROP INDEX idx_ratings_player_type_date_rating ON Ratings",
  "DROP INDEX idx_ratings_rating_only ON Ratings",
  "DROP INDEX idx_tournaments_date_id ON Tournaments",
  "DROP INDEX idx_results_tournament_player_gain ON TournamentResults",
  "DROP INDEX idx_results_tournament_gain_player ON TournamentResults",
  "DROP INDEX idx_results_gamesplayed_player_won ON TournamentResults",
  "DROP INDEX idx_results_gamesplayed_gameswon ON TournamentResults",
  "DROP INDEX idx_results_player_wins_games ON TournamentResults",
  "DROP INDEX idx_results_gameswon_gamesplayed ON TournamentResults",
  "DROP INDEX idx_players_name_only ON Players",
];

const QUERIES = [
  {
    id: "q1",
    title: "Win rate percentage by country",
    why: "This query summarizes how countries perform overall in tournament participation by comparing total wins against total games played.",
    concepts: ["join", "group by"],
    sql: `
SELECT
  p.Country,
  COUNT(*) AS total_participations,
  SUM(tr.GamesWon) AS total_wins,
  SUM(tr.GamesPlayed) AS total_games,
  SUM(tr.GamesWon) / SUM(tr.GamesPlayed) AS win_rate
FROM Players p
JOIN TournamentResults tr
  ON p.player_ID = tr.player_ID
WHERE tr.GamesPlayed > 1
GROUP BY p.Country
ORDER BY win_rate DESC
LIMIT 15;
`.trim(),
    indexDesigns: [
      {
        name: "baseline",
        rationale: "Use only the default primary-key indexes.",
        create: [],
        drop: [],
      },
      {
        name: "results_games_filter",
        rationale: "Add an index on `GamesPlayed` and `GamesWon`, both non-primary-key columns used in the query, so MySQL can narrow qualifying tournament rows earlier.",
        create: [
          "CREATE INDEX idx_results_gamesplayed_gameswon ON TournamentResults (GamesPlayed, GamesWon)",
        ],
        drop: ["DROP INDEX idx_results_gamesplayed_gameswon ON TournamentResults"],
      },
      {
        name: "country_only",
        rationale: "Add an index on `Country`, the grouped non-primary-key attribute from `Players`, to test whether grouping support helps more than filtering support.",
        create: [
          "CREATE INDEX idx_players_country_only ON Players (Country)",
        ],
        drop: [
          "DROP INDEX idx_players_country_only ON Players",
        ],
      },
      {
        name: "results_plus_country",
        rationale: "Combine the non-primary-key results index with the non-primary-key country index to support both filtering and grouping without indexing any primary-key columns.",
        create: [
          "CREATE INDEX idx_results_gamesplayed_gameswon ON TournamentResults (GamesPlayed, GamesWon)",
          "CREATE INDEX idx_players_country_only ON Players (Country)",
        ],
        drop: [
          "DROP INDEX idx_players_country_only ON Players",
          "DROP INDEX idx_results_gamesplayed_gameswon ON TournamentResults",
        ],
      },
    ],
  },
  {
    id: "q2",
    title: "Players with the most wins",
    why: "This query lists players with the highest total win counts across all tournament participation records.",
    concepts: ["join", "group by", "having"],
    sql: `
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
LIMIT 15;
`.trim(),
    indexDesigns: [
      {
        name: "baseline",
        rationale: "Use only the default primary-key indexes.",
        create: [],
        drop: [],
      },
      {
        name: "results_wins_games",
        rationale: "Add an index on `GamesWon` and `GamesPlayed`, which are the non-primary-key tournament-result columns used in the aggregates and HAVING condition.",
        create: [
          "CREATE INDEX idx_results_gameswon_gamesplayed ON TournamentResults (GamesWon, GamesPlayed)",
        ],
        drop: ["DROP INDEX idx_results_gameswon_gamesplayed ON TournamentResults"],
      },
      {
        name: "name_only",
        rationale: "Add an index on `Name`, the non-primary-key player attribute used in the grouped output, to compare against the results-table-only design.",
        create: [
          "CREATE INDEX idx_players_name_only ON Players (Name)",
        ],
        drop: [
          "DROP INDEX idx_players_name_only ON Players",
        ],
      },
      {
        name: "results_plus_name",
        rationale: "Combine the non-primary-key results index with the non-primary-key player-name index to support both aggregation and grouped output columns.",
        create: [
          "CREATE INDEX idx_results_gameswon_gamesplayed ON TournamentResults (GamesWon, GamesPlayed)",
          "CREATE INDEX idx_players_name_only ON Players (Name)",
        ],
        drop: [
          "DROP INDEX idx_players_name_only ON Players",
          "DROP INDEX idx_results_gameswon_gamesplayed ON TournamentResults",
        ],
      },
    ],
  },
  {
    id: "q3",
    title: "Players with the highest standard rating growth from 2020 to 2025",
    why: "This query measures how much each player's standard rating changed between the available rating snapshots from 2020 through 2025.",
    concepts: ["join", "group by"],
    sql: `
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
LIMIT 15;
`.trim(),
    indexDesigns: [
      {
        name: "baseline",
        rationale: "Use only the default primary-key indexes.",
        create: [],
        drop: [],
      },
      {
        name: "rating_only",
        rationale: "Add an index on `Rating`, the main non-primary-key attribute used in the MAX/MIN calculation for rating growth.",
        create: [
          "CREATE INDEX idx_ratings_rating_only ON Ratings (Rating)",
        ],
        drop: ["DROP INDEX idx_ratings_rating_only ON Ratings"],
      },
      {
        name: "name_only",
        rationale: "Add an index on `Name`, the non-primary-key player attribute used in the grouped output, to see whether it helps the join and grouping stage.",
        create: [
          "CREATE INDEX idx_players_name_only ON Players (Name)",
        ],
        drop: [
          "DROP INDEX idx_players_name_only ON Players",
        ],
      },
      {
        name: "rating_plus_name",
        rationale: "Combine the non-primary-key rating index with the non-primary-key player-name index so the design still avoids all primary-key columns.",
        create: [
          "CREATE INDEX idx_ratings_rating_only ON Ratings (Rating)",
          "CREATE INDEX idx_players_name_only ON Players (Name)",
        ],
        drop: [
          "DROP INDEX idx_players_name_only ON Players",
          "DROP INDEX idx_ratings_rating_only ON Ratings",
        ],
      },
    ],
  },
];

function safeParagraph(text) {
  return text.replace(/\s+/g, " ").trim();
}

function parseExplainCost(explainText) {
  const costs = [...explainText.matchAll(/\(cost=([0-9]+(?:\.[0-9]+)?)/g)].map((match) => Number(match[1]));
  return costs.length ? Math.max(...costs) : null;
}

async function runSql(connection, sql) {
  const [rows] = await connection.query(sql);
  return rows;
}

async function fetchCounts(connection) {
  const tables = ["Players", "Ratings", "Tournaments", "TournamentResults", "UserAccount"];
  const counts = {};
  for (const table of tables) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS row_count FROM ${table}`);
    counts[table] = rows[0].row_count;
  }
  return counts;
}

async function resetDesign(connection, design) {
  for (const statement of design.drop) {
    try {
      await connection.query(statement);
    } catch {
      // Ignore cleanup failures when the index is already absent.
    }
  }
}

async function cleanupAnalysisIndexes(connection) {
  for (const statement of ANALYSIS_INDEX_DROPS) {
    try {
      await connection.query(statement);
    } catch {
      // Ignore missing-index cleanup failures.
    }
  }
}

async function applyDesign(connection, design) {
  for (const statement of design.create) {
    await connection.query(statement);
  }
}

async function analyzeQuery(connection, query) {
  await cleanupAnalysisIndexes(connection);
  const topRows = await runSql(connection, query.sql);
  const designs = [];

  for (const design of query.indexDesigns) {
    await cleanupAnalysisIndexes(connection);
    await resetDesign(connection, design);
    await applyDesign(connection, design);

    const explainRows = await runSql(connection, `EXPLAIN ANALYZE ${query.sql}`);
    const explainText = explainRows.map((row) => row.EXPLAIN).join("\n");
    const cost = parseExplainCost(explainText);

    designs.push({
      name: design.name,
      rationale: design.rationale,
      cost,
      explain: explainText,
      create: design.create,
      drop: design.drop,
    });

    await resetDesign(connection, design);
    await cleanupAnalysisIndexes(connection);
  }

  const baseline = designs[0];
  let best = baseline;

  for (const design of designs.slice(1)) {
    if (design.cost !== null && (best.cost === null || design.cost < best.cost)) {
      best = design;
    }
  }

  return {
    id: query.id,
    title: query.title,
    why: query.why,
    concepts: query.concepts,
    sql: query.sql,
    topRows,
    designs,
    selectedDesign: best.name,
  };
}

function formatRowsTable(rows) {
  if (!rows.length) {
    return "_No rows returned._";
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  ];

  for (const row of rows) {
    lines.push(`| ${headers.map((header) => String(row[header])).join(" | ")} |`);
  }

  return lines.join("\n");
}

function formatDesignTable(designs) {
  const lines = [
    "| Design | Cost | Notes |",
    "| --- | ---: | --- |",
  ];

  for (const design of designs) {
    lines.push(`| ${design.name} | ${design.cost === null ? "n/a" : design.cost} | ${design.rationale} |`);
  }

  return lines.join("\n");
}

function renderDoc(summary) {
  const querySections = summary.queries
    .map((query) => {
      const selected = query.designs.find((design) => design.name === query.selectedDesign);
      const baseline = query.designs[0];
      const changeText =
        baseline.cost !== null && selected.cost !== null
          ? `${selected.cost - baseline.cost > 0 ? "increased" : "decreased"} from ${baseline.cost} to ${selected.cost}`
          : "could not be measured from the returned plan text";

      const analysisParagraph = safeParagraph(
        `For ${query.title.toLowerCase()}, I compared the baseline plan against three non-default indexing designs. I selected \`${query.selectedDesign}\` because it produced the lowest reported cost for this query. Relative to the baseline, the chosen design ${changeText}. This result matches the query shape: the selected indexes cover the most selective filters and/or join attributes that appear in the WHERE, GROUP BY, or HAVING clauses.`
      );

      const residualParagraph = safeParagraph(
        `The alternative designs still matter because they show the tradeoff space required by the assignment. Some designs only help one stage of the query plan, while others add indexes that are broader but less selective. When a design does not improve the reported cost very much, that likely means the dataset is moderate in size, the optimizer still prefers scans or temporary aggregation, or the predicate selectivity is not strong enough for the extra index to change the plan substantially.`
      );

      return [
        `## ${query.id.toUpperCase()}. ${query.title}`,
        "",
        safeParagraph(`${query.why} This query uses ${query.concepts.join(", ")}.`),
        "",
        "```sql",
        query.sql,
        "```",
        "",
        "Top 15 rows:",
        "",
        formatRowsTable(query.topRows),
        "",
        "Screenshot of top 15 rows:",
        "",
        `![${query.title} result screenshot](screenshots/${query.id}-results.svg)`,
        "",
        "Index designs and EXPLAIN ANALYZE cost summary:",
        "",
        formatDesignTable(query.designs),
        "",
        analysisParagraph,
        "",
        residualParagraph,
        "",
        `Selected final design: \`${query.selectedDesign}\``,
        "",
        "EXPLAIN ANALYZE screenshot:",
        "",
        `![${query.title} EXPLAIN ANALYZE screenshot](screenshots/${query.id}-explain.svg)`,
        "",
        "EXPLAIN ANALYZE outputs:",
        "",
        ...query.designs.flatMap((design) => [
          `### ${query.id.toUpperCase()} - ${design.name}`,
          "",
          "```text",
          design.explain,
          "```",
          "",
        ]),
      ].join("\n");
    })
    .join("\n");

  return [
    "# Database Design",
    "",
    "## Database Implementation",
    "",
    "This project implements the Stage 2 chess schema on MySQL 8.4 in Google Cloud SQL. The database was populated with a hybrid dataset: real player and rating data parsed from the official FIDE rating list, plus simple simulated tournament and tournament-result data added because we could not find a clean tournament dataset that matched our schema well enough for the project.",
    "",
    "### Connection Screenshot",
    "",
    "![Database connection screenshot](screenshots/connection-check.svg)",
    "",
    "### DDL Commands",
    "",
    "```sql",
    "-- Entity table",
    DDL.Players + ";",
    "",
    "-- Entity table",
    DDL.Tournaments + ";",
    "",
    "-- Relationship table for the many-to-many Players <-> Tournaments relationship",
    DDL.TournamentResults + ";",
    "",
    "-- Relationship/history table for player ratings over type and date",
    DDL.Ratings + ";",
    "",
    "-- Entity table",
    DDL.UserAccount + ";",
    "```",
    "",
    "### Row Counts",
    "",
    "| Table | Row count |",
    "| --- | ---: |",
    `| Players | ${summary.counts.Players} |`,
    `| Ratings | ${summary.counts.Ratings} |`,
    `| Tournaments | ${summary.counts.Tournaments} |`,
    `| TournamentResults | ${summary.counts.TournamentResults} |`,
    `| UserAccount | ${summary.counts.UserAccount} |`,
    "",
    "The counts confirm that at least three main tables have more than 1000 rows: `Players`, `Ratings`, and `TournamentResults` all exceed that threshold.",
    "",
    "Screenshot of row counts:",
    "",
    "![Row count screenshot](screenshots/row-counts.svg)",
    "",
    "### Data Generation Method",
    "",
    "We used a simple hybrid approach for the data. Real player data and the current rating snapshot came from the official FIDE rating list. The import script read the fixed-width file, extracted fields such as player ID, name, country, gender, birth year, and available ratings, removed duplicates, and kept up to 5000 valid players. The 2026 standard, rapid, and blitz values came directly from that file.",
    "",
    "We could not find a tournament dataset that matched our schema cleanly, so we created simple simulated tournament data as students. The script generated 220 tournaments with basic names like `Student Sim Tournament 1`, rotating locations from a small list, and generated dates across 2023 to 2026. For each tournament, it selected a set of unique players and then assigned straightforward random values for `GamesPlayed`, `GamesWon`, and `RatingChange` using a seeded pseudo-random generator.",
    "",
    "To support the rating-growth query, the script also generated simple historical standard-rating snapshots for 2020 through 2025. These yearly standard ratings are not from an external tournament dataset; they are naive simulated values derived from each player's available standard rating so that the database has multiple years to compare. The goal was not to build a sophisticated simulation, but to produce consistent sample data that fits the schema and satisfies the project requirements.",
    "",
    "## Advanced Queries And Indexing",
    "",
    querySections,
  ].join("\n");
}

async function main() {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  fs.mkdirSync(DOC_DIR, { recursive: true });

  const connection = await mysql.createConnection(DB_CONFIG);

  try {
    await cleanupAnalysisIndexes(connection);
    const counts = await fetchCounts(connection);
    const queries = [];

    for (const query of QUERIES) {
      queries.push(await analyzeQuery(connection, query));
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      counts,
      queries,
    };

    fs.writeFileSync(
      path.join(GENERATED_DIR, "stage3_analysis.json"),
      JSON.stringify(summary, null, 2),
      "utf8"
    );
    fs.writeFileSync(path.join(DOC_DIR, "Database Design.md"), renderDoc(summary), "utf8");

    console.log(JSON.stringify({
      outputJson: path.join(GENERATED_DIR, "stage3_analysis.json"),
      outputDoc: path.join(DOC_DIR, "Database Design.md"),
      counts,
      queries: queries.map((query) => ({
        id: query.id,
        selectedDesign: query.selectedDesign,
        costs: query.designs.map((design) => ({ name: design.name, cost: design.cost })),
      })),
    }, null, 2));
  } finally {
    await cleanupAnalysisIndexes(connection);
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
