import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { v4 as uuidv4 } from "uuid";
import cookie from "cookie";

let db;

async function initDB() {
  if (!db) {
    db = await open({
      filename: "./votes.db",
      driver: sqlite3.Database,
    });

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

    const exists = await db.get("SELECT id FROM polls LIMIT 1");
    if (!exists) {
      await db.run("INSERT INTO polls (title) VALUES (?)", ["Vote Your Favourites"]);
      const pollId = (await db.get("SELECT id FROM polls LIMIT 1")).id;
      const names = Array.from({ length: 19 }, (_, i) => `Person ${i + 1}`);
      for (const n of names) {
        await db.run("INSERT INTO options (poll_id, label) VALUES (?,?)", pollId, n);
      }
      console.log("✅ Created demo poll with 19 options.");
    }
  }
  return db;
}

export default async function handler(req, res) {
  const db = await initDB();

  const urlParts = req.url.split("/").filter(Boolean);
  const pollId = parseInt(urlParts[1]) || 1;

  // Parse cookies manually (Vercel functions don't have req.cookies)
  const cookies = cookie.parse(req.headers.cookie || "");
  let voterUUID = cookies.voter_uuid;
  if (!voterUUID) {
    voterUUID = uuidv4();
    res.setHeader(
      "Set-Cookie",
      cookie.serialize("voter_uuid", voterUUID, {
        httpOnly: true,
        path: "/",
        maxAge: 31536000,
      })
    );
  }

  if (req.method === "GET") {
    if (urlParts.length === 2 && urlParts[1] === "results") {
      const results = await db.all(`
        SELECT o.label, COUNT(v.id) AS votes
        FROM options o
        LEFT JOIN votes v ON o.id = v.option_id
        WHERE o.poll_id = ?
        GROUP BY o.id, o.label
        ORDER BY o.id
      `, pollId);
      res.status(200).json({ results });
    } else {
      const poll = await db.get("SELECT * FROM polls WHERE id = ?", pollId);
      const options = await db.all("SELECT * FROM options WHERE poll_id = ?", pollId);
      const voter = await db.get(
        "SELECT voted FROM voters WHERE poll_id = ? AND voter_uuid = ?",
        pollId,
        voterUUID
      );
      res.status(200).json({ poll, options, alreadyVoted: voter?.voted || 0 });
    }
  } 
  else if (req.method === "POST") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", async () => {
      const { choices } = JSON.parse(body || "{}");
      if (!choices || !choices.length) {
        res.status(400).json({ error: "No choices provided" });
        return;
      }

      const voter = await db.get(
        "SELECT voted FROM voters WHERE poll_id = ? AND voter_uuid = ?",
        pollId,
        voterUUID
      );
      if (voter && voter.voted) {
        res.status(403).json({ error: "You already voted" });
        return;
      }

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

      res.status(200).json({ ok: true });
    });
  } 
  else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
