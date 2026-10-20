// pastebox keeps every paste in one SQLite table.
export const SCHEMA = `
CREATE TABLE pastes (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export function createPaste(db, id, body, now) {
  db.run("INSERT INTO pastes (id, body, created_at) VALUES (?, ?, ?)", id, body, now);
  return { status: 201, id };
}

export function showPaste(db, id) {
  const row = db.get("SELECT body FROM pastes WHERE id = ?", id);
  if (!row) return { status: 404 };
  return { status: 200, body: row.body };
}

export function rawPaste(db, id) {
  const shown = showPaste(db, id);
  return { ...shown, type: "text/plain" };
}

export function deletePaste(db, id) {
  db.run("DELETE FROM pastes WHERE id = ?", id);
  return { status: 204 };
}
