const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const ROOT = path.resolve(__dirname, "..");
const GENERATED_DIR = path.join(ROOT, "generated");
const DOC_DIR = path.join(ROOT, "doc");
const SCREENSHOT_DIR = path.join(DOC_DIR, "screenshots");
const ANALYSIS_PATH = path.join(GENERATED_DIR, "stage3_analysis.json");

const DB_CONFIG = {
  host: process.env.DB_HOST || "34.44.121.67",
  user: process.env.DB_USER || "appuser",
  password: process.env.DB_PASSWORD || "your_password_here",
  database: process.env.DB_NAME || "chessdb",
  connectTimeout: 10000,
};

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapLine(line, maxWidth) {
  if (!line.length || line.length <= maxWidth) {
    return [line];
  }

  const wrapped = [];
  let remaining = line;

  while (remaining.length > maxWidth) {
    let splitAt = remaining.lastIndexOf(" ", maxWidth);
    if (splitAt <= 0) {
      splitAt = maxWidth;
    }
    wrapped.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length) {
    wrapped.push(remaining);
  }

  return wrapped;
}

function wrapLines(lines, maxWidth = 110) {
  return lines.flatMap((line) => wrapLine(line, maxWidth));
}

function formatAsciiTable(rows) {
  if (!rows.length) {
    return ["(no rows returned)"];
  }

  const headers = Object.keys(rows[0]);
  const widths = headers.map((header) =>
    Math.max(
      header.length,
      ...rows.map((row) => String(row[header]).length)
    )
  );

  const divider = `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`;
  const headerRow = `| ${headers.map((header, index) => header.padEnd(widths[index])).join(" | ")} |`;
  const bodyRows = rows.map(
    (row) => `| ${headers.map((header, index) => String(row[header]).padEnd(widths[index])).join(" | ")} |`
  );

  return [divider, headerRow, divider, ...bodyRows, divider];
}

function buildSvg(title, lines) {
  const wrapped = wrapLines(lines);
  const maxChars = Math.max(title.length, ...wrapped.map((line) => line.length), 40);
  const width = Math.max(960, 40 + maxChars * 9);
  const headerHeight = 54;
  const lineHeight = 22;
  const topPadding = 24;
  const bottomPadding = 24;
  const height = headerHeight + topPadding + wrapped.length * lineHeight + bottomPadding;

  const textElements = wrapped
    .map((line, index) => {
      const y = headerHeight + topPadding + index * lineHeight;
      return `<text x="20" y="${y}" font-family="Consolas, 'Courier New', monospace" font-size="16" fill="#c9d1d9" xml:space="preserve">${escapeXml(line)}</text>`;
    })
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#0d1117"/>`,
    `<rect width="${width}" height="${headerHeight}" fill="#161b22"/>`,
    `<circle cx="20" cy="27" r="6" fill="#ff5f56"/>`,
    `<circle cx="40" cy="27" r="6" fill="#ffbd2e"/>`,
    `<circle cx="60" cy="27" r="6" fill="#27c93f"/>`,
    `<text x="78" y="33" font-family="Segoe UI, Arial, sans-serif" font-size="18" fill="#f0f6fc">${escapeXml(title)}</text>`,
    textElements,
    `</svg>`,
  ].join("");
}

function writeSvg(filename, title, lines) {
  const targetPath = path.join(SCREENSHOT_DIR, filename);
  fs.writeFileSync(targetPath, buildSvg(title, lines), "utf8");
  return targetPath;
}

function sqlBlock(sql) {
  return sql.trim().split("\n");
}

function explainPreview(explainText, maxLines = 12) {
  const lines = explainText.trim().split("\n");
  if (lines.length <= maxLines) {
    return lines;
  }
  return [...lines.slice(0, maxLines), "..."];
}

async function fetchCounts(connection) {
  const [rows] = await connection.query(`
SELECT 'Players' AS table_name, COUNT(*) AS row_count FROM Players
UNION ALL
SELECT 'Ratings' AS table_name, COUNT(*) AS row_count FROM Ratings
UNION ALL
SELECT 'Tournaments' AS table_name, COUNT(*) AS row_count FROM Tournaments
UNION ALL
SELECT 'TournamentResults' AS table_name, COUNT(*) AS row_count FROM TournamentResults
UNION ALL
SELECT 'UserAccount' AS table_name, COUNT(*) AS row_count FROM UserAccount;
  `);
  return rows;
}

async function main() {
  if (!fs.existsSync(ANALYSIS_PATH)) {
    throw new Error("stage3_analysis.json was not found. Run npm run analyze:stage3 first.");
  }

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const summary = JSON.parse(fs.readFileSync(ANALYSIS_PATH, "utf8"));
  const connection = await mysql.createConnection(DB_CONFIG);

  try {
    const [connectionRows] = await connection.query("SELECT 1 AS ok");
    const countRows = await fetchCounts(connection);

    writeSvg("connection-check.svg", "Database connection screenshot", [
      "Cloud SQL connection verification",
      `host: ${DB_CONFIG.host}`,
      `user: ${DB_CONFIG.user}`,
      `database: ${DB_CONFIG.database}`,
      "",
      "mysql> SELECT 1 AS ok;",
      ...formatAsciiTable(connectionRows),
    ]);

    writeSvg("row-counts.svg", "Row count screenshot", [
      "mysql> SELECT 'Players' AS table_name, COUNT(*) AS row_count FROM Players",
      "   UNION ALL SELECT 'Ratings', COUNT(*) FROM Ratings",
      "   UNION ALL SELECT 'Tournaments', COUNT(*) FROM Tournaments",
      "   UNION ALL SELECT 'TournamentResults', COUNT(*) FROM TournamentResults",
      "   UNION ALL SELECT 'UserAccount', COUNT(*) FROM UserAccount;",
      "",
      ...formatAsciiTable(countRows),
    ]);

    for (const query of summary.queries) {
      writeSvg(`${query.id}-results.svg`, `${query.id.toUpperCase()} result screenshot`, [
        `Query: ${query.title}`,
        "",
        ...sqlBlock(query.sql),
        "",
        ...formatAsciiTable(query.topRows),
      ]);

      const explainLines = [
        `EXPLAIN ANALYZE screenshots for ${query.title}`,
        "",
        "Command:",
        "EXPLAIN ANALYZE",
        ...sqlBlock(query.sql),
        "",
      ];

      for (const design of query.designs) {
        explainLines.push(`Design: ${design.name} | cost: ${design.cost === null ? "n/a" : design.cost}`);
        explainLines.push(...explainPreview(design.explain));
        explainLines.push("");
      }

      writeSvg(`${query.id}-explain.svg`, `${query.id.toUpperCase()} EXPLAIN ANALYZE screenshot`, explainLines);
    }

    console.log(JSON.stringify({
      outputDir: SCREENSHOT_DIR,
      files: fs.readdirSync(SCREENSHOT_DIR).filter((file) => file.endsWith(".svg")).sort(),
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
