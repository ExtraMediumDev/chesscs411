async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function renderSummary(summary) {
  const cards = [
    ["Players", summary.players],
    ["Ratings", summary.ratings],
    ["Tournaments", summary.tournaments],
    ["Match Results", summary.results],
  ];

  document.getElementById("summaryCards").innerHTML = cards
    .map(
      ([label, value]) => `
        <div class="card">
          <div class="label">${label}</div>
          <div class="value">${Number(value).toLocaleString()}</div>
        </div>
      `
    )
    .join("");
}

function renderRows(targetId, rows, columns, clickHandler) {
  const target = document.getElementById(targetId);
  target.innerHTML = rows
    .map((row) => {
      const tds = columns.map((column) => `<td>${row[column] ?? ""}</td>`).join("");
      return `<tr data-id="${row.player_ID || ""}">${tds}</tr>`;
    })
    .join("");

  if (clickHandler) {
    Array.from(target.querySelectorAll("tr")).forEach((row) => {
      row.addEventListener("click", () => {
        target.querySelectorAll("tr.selected").forEach((el) => el.classList.remove("selected"));
        row.classList.add("selected");
        clickHandler(row.dataset.id);
      });
    });
  }
}

function renderPlayerDetails(player, ratings, tournaments) {
  const details = document.getElementById("playerDetails");
  details.classList.remove("empty");

  const ratingBadges = [
    ["standard", player.standard_rating],
    ["rapid", player.rapid_rating],
    ["blitz", player.blitz_rating],
  ]
    .filter(([, val]) => val)
    .map(([type, val]) => `<span class="rating-badge ${type}">${type}: ${val}</span>`)
    .join("");

  details.innerHTML = `
    <h3>${player.Name}</h3>
    <p class="muted">${player.Country || "Unknown"} &middot; ${player.Gender === "M" ? "Male" : player.Gender === "F" ? "Female" : player.Gender || "Unknown"}</p>
    <div style="margin: 12px 0">${ratingBadges || '<span class="muted">No current ratings</span>'}</div>

    <h4>Standard Rating History</h4>
    ${
      ratings.length
        ? `<div class="mini-list">${ratings
            .map(
              (r) => `
                <div class="mini-item">
                  <strong>${String(r.RatingDate).slice(0, 10)}</strong> &mdash; ${r.Rating}
                </div>
              `
            )
            .join("")}</div>`
        : '<p class="muted">No standard rating history available.</p>'
    }

    <h4>Tournament Results</h4>
    ${
      tournaments.length
        ? `<div class="mini-list">${tournaments
            .map(
              (t) => `
                <div class="mini-item">
                  <strong>${t.Tournament_Name}</strong><br />
                  <span class="muted">${t.Location} &middot; ${String(t.Start_Date).slice(0, 10)}</span><br />
                  Won ${t.GamesWon} / ${t.GamesPlayed} &middot; Rating change: ${t.RatingChange > 0 ? "+" : ""}${t.RatingChange}
                </div>
              `
            )
            .join("")}</div>`
        : '<p class="muted">No tournament participation on record.</p>'
    }
  `;
}

async function loadPlayer(playerId) {
  const [player, ratings, tournaments] = await Promise.all([
    fetchJson(`/api/players/${playerId}`),
    fetchJson(`/api/players/${playerId}/ratings?type=standard`),
    fetchJson(`/api/players/${playerId}/tournaments`),
  ]);

  renderPlayerDetails(player, ratings, tournaments);
}

async function loadPlayers(search = "") {
  const rows = await fetchJson(`/api/players?search=${encodeURIComponent(search)}`);
  renderRows("playersTable", rows, ["Name", "Country", "standard_rating"], loadPlayer);
  if (rows[0]) {
    const firstRow = document.querySelector("#playersTable tr");
    if (firstRow) firstRow.classList.add("selected");
    await loadPlayer(rows[0].player_ID);
  }
}

async function loadTournaments() {
  const rows = await fetchJson("/api/tournaments");
  renderRows("tournamentsTable", rows, ["Tournament_Name", "Location", "Start_Date", "participants"]);
}

async function loadAnalytics() {
  const [winRates, topWinners, growth] = await Promise.all([
    fetchJson("/api/analytics/win-rates"),
    fetchJson("/api/analytics/top-winners"),
    fetchJson("/api/analytics/rating-growth"),
  ]);

  renderRows("winRatesTable", winRates, ["Country", "total_participations", "win_rate"]);
  renderRows("topWinnersTable", topWinners, ["Name", "tournaments_played", "total_wins"]);
  renderRows("growthTable", growth, ["Name", "rating_growth"]);
}

let searchTimeout = null;

async function init() {
  try {
    const summary = await fetchJson("/api/summary");
    renderSummary(summary);
    await Promise.all([loadPlayers(), loadTournaments(), loadAnalytics()]);
  } catch (error) {
    console.error("Failed to load data:", error);
  }

  document.getElementById("playerSearch").addEventListener("input", (event) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadPlayers(event.target.value.trim()), 300);
  });

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      document.querySelectorAll(".nav-link").forEach((el) => el.classList.remove("active"));
      link.classList.add("active");
      const target = document.getElementById(link.dataset.section);
      if (target) target.scrollIntoView({ behavior: "smooth" });
    });
  });
}

init();
