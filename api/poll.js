import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';
import cookie from 'cookie';

let dbPromise = open({ filename: './votes.db', driver: sqlite3.Database });

export default async function handler(req, res) {
  const db = await dbPromise;
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

  // make sure one poll exists
  const exists = await db.get('SELECT id FROM polls LIMIT 1');
  if (!exists) {
    await db.run('INSERT INTO polls (title) VALUES (?)', ['Vote Your Favourites']);
    const pollId = (await db.get('SELECT id FROM polls LIMIT 1')).id;
    const names = Array.from({ length: 5 }, (_, i) => `Person ${i + 1}`);
    for (const n of names)
      await db.run('INSERT INTO options (poll_id, label) VALUES (?, ?)', pollId, n);
  }

  const { method, query, body } = req;
  const pollId = query.id || 1;

  if (method === 'GET') {
    const poll = await db.get('SELECT * FROM polls WHERE id = ?', pollId);
    const options = await db.all('SELECT * FROM options WHERE poll_id = ?', pollId);

    const cookies = cookie.parse(req.headers.cookie || '');
    let voterUUID = cookies.voter_uuid || uuidv4();
    res.setHeader(
      'Set-Cookie',
      cookie.serialize('voter_uuid', voterUUID, {
        httpOnly: true,
        maxAge: 31536000,
        path: '/',
      })
    );

    const voter = await db.get(
      'SELECT voted FROM voters WHERE poll_id = ? AND voter_uuid = ?',
      pollId,
      voterUUID
    );

    return res.json({ poll, options, alreadyVoted: voter?.voted || 0 });
  }

  if (method === 'POST') {
    const { choices } = body;
    const cookies = cookie.parse(req.headers.cookie || '');
    const voterUUID = cookies.voter_uuid;
    if (!voterUUID) return res.status(400).json({ error: 'Missing voter ID' });

    const voter = await db.get(
      'SELECT voted FROM voters WHERE poll_id = ? AND voter_uuid = ?',
      pollId,
      voterUUID
    );
    if (voter && voter.voted)
      return res.status(403).json({ error: 'You already voted' });

    const insert = await db.prepare(
      'INSERT OR IGNORE INTO votes (poll_id, option_id, voter_uuid) VALUES (?,?,?)'
    );
    for (const opt of choices) await insert.run(pollId, opt, voterUUID);
    await insert.finalize();

    await db.run(
      'INSERT OR REPLACE INTO voters (poll_id, voter_uuid, voted) VALUES (?,?,1)',
      pollId,
      voterUUID
    );

    return res.json({ ok: true });
  }

  if (method === 'DELETE') {
    await db.run('DELETE FROM votes');
    await db.run('DELETE FROM voters');
    return res.json({ ok: true, msg: 'Votes reset' });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
