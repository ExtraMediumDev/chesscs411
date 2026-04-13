const { query } = require("../lib/db");

module.exports = async (req, res) => {
  try {
    await query("SELECT 1 AS ok");
    res.json({ ok: true, database: true });
  } catch (err) {
    res.json({ ok: false, database: false, error: err.message });
  }
};
