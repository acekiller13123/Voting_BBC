// server.js
const express = require("express");
const bodyParser = require("body-parser");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const cookieParser = require("cookie-parser");

const app = express();
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static("public"));

let db;
(async () => {
  db = await open({ filename: "./votes.db", driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER,
      label TEXT
    );
    CREATE TABLE IF NOT EXISTS voters (
      poll_id INTEGER,
      voter_uuid TEXT,
      voted INTEGER DEFAULT 0,
      UNIQUE(poll_id, voter_uuid)
    );
    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER,
      option_id INTEGER,
      voter_uuid TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (poll_id, option_id, voter_uuid)
    );
  `);

  // Create demo poll if not exists
  const exists = await db.get("SELECT id FROM polls LIMIT 1");
  if (!exists) {
    await db.run("INSERT INTO polls (title) VALUES (?)", ["Vote Your Favourites"]);
    const pollId = (await db.get("SELECT id FROM polls LIMIT 1")).id;
    const names = Array.from({ length: 19 }, (_, i) => `Person ${i + 1}`);
    for (const n of names) {
      await db.run("INSERT INTO options (poll_id, label) VALUES (?,?)", pollId, n);
    }
    console.log("Created demo poll with 19 people.");
  }
})();

app.get("/api/poll/:id", async (req, res) => {
  const pollId = req.params.id;
  const poll = await db.get("SELECT * FROM polls WHERE id = ?", pollId);
  const options = await db.all("SELECT * FROM options WHERE poll_id = ?", pollId);
  let voterUUID = req.cookies.voter_uuid;
  if (!voterUUID) {
    voterUUID = uuidv4();
    res.cookie("voter_uuid", voterUUID, { httpOnly: true, maxAge: 31536000000 }); // 1 year
  }
  const voter = await db.get(
    "SELECT voted FROM voters WHERE poll_id = ? AND voter_uuid = ?",
    pollId,
    voterUUID
  );
  res.json({ poll, options, alreadyVoted: voter?.voted || 0 });
});

app.post("/api/poll/:id/vote", async (req, res) => {
  const pollId = req.params.id;
  const { choices } = req.body;
  let voterUUID = req.cookies.voter_uuid;
  if (!voterUUID) return res.status(400).json({ error: "Missing voter ID" });

  const voter = await db.get(
    "SELECT voted FROM voters WHERE poll_id = ? AND voter_uuid = ?",
    pollId,
    voterUUID
  );
  if (voter && voter.voted) return res.status(403).json({ error: "You already voted" });

  const insert = await db.prepare(
    "INSERT OR IGNORE INTO votes (poll_id, option_id, voter_uuid) VALUES (?,?,?)"
  );
  for (const opt of choices) await insert.run(pollId, opt, voterUUID);
  await insert.finalize();

  await db.run(
    "INSERT OR REPLACE INTO voters (poll_id, voter_uuid, voted) VALUES (?,?,1)",
    pollId,
    voterUUID
  );

  res.json({ ok: true });
});

app.get("/api/poll/:id/results", async (req, res) => {
  const pollId = req.params.id;
  const results = await db.all(`
    SELECT o.label, COUNT(v.id) AS votes
    FROM options o
    LEFT JOIN votes v ON o.id = v.option_id
    WHERE o.poll_id = ?
    GROUP BY o.id, o.label
    ORDER BY o.id
  `, pollId);
  res.json({ results });
});

const PORT = 3000;
app.listen(PORT, () => console.log("Server running at http://localhost:" + PORT));
