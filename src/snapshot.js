const { db } = require('./db');
const { OPEN_STATUSES } = require('./config');

const DAYS_AHEAD = +(process.env.DAYS_AHEAD || 2);

// snapshot diário de cobrança: tasks abertas vencidas ou vencendo em até DAYS_AHEAD dias
function collect(dateStr) {
  const today = dateStr || new Date().toLocaleDateString('en-CA', { timeZone: process.env.TZ || 'America/Sao_Paulo' });
  const limit = new Date(today + 'T23:59:59');
  limit.setDate(limit.getDate() + DAYS_AHEAD);
  const limitMs = limit.getTime();

  const tasks = db.prepare(`SELECT * FROM tasks WHERE due_date IS NOT NULL AND due_date <= ?`).all(limitMs)
    .filter(t => OPEN_STATUSES.includes(t.status) || !isKnownClosed(t.status));

  db.prepare(`INSERT OR REPLACE INTO snapshots (snapshot_date, collected_at) VALUES (?,?)`)
    .run(today, new Date().toISOString());

  const del = db.prepare(`DELETE FROM snapshot_tasks WHERE snapshot_date=?`);
  const ins = db.prepare(`INSERT OR REPLACE INTO snapshot_tasks
    (snapshot_date, task_id, task_name, url, status, assignees, due_date, priority, tags, list_name, contract, is_subtask)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const info = db.prepare(`INSERT INTO task_info (task_id,name,url,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(task_id) DO UPDATE SET name=excluded.name, url=excluded.url, updated_at=excluded.updated_at`);
  const now = new Date().toISOString();
  db.transaction(() => {
    del.run(today);
    for (const t of tasks) {
      ins.run(today, t.id, t.name, t.url, t.status, t.assignees, t.due_date, t.priority, t.tags, t.list_name, t.contract, t.is_subtask);
      info.run(t.id, t.name, t.url, now);
    }
  })();
  return { date: today, count: tasks.length };
}

function isKnownClosed(status) { return status === 'executado' || status === 'closed' || status === 'complete'; }

function getSnapshot(dateStr) {
  return db.prepare(`SELECT * FROM snapshot_tasks WHERE snapshot_date=?`).all(dateStr);
}
function snapshotDates() {
  return db.prepare(`SELECT snapshot_date, collected_at FROM snapshots ORDER BY snapshot_date DESC`).all();
}
function getNotes(dateStr) {
  const rows = db.prepare(`SELECT * FROM notes WHERE snapshot_date=?`).all(dateStr);
  const m = {};
  for (const r of rows) m[r.task_id] = r.note;
  return m;
}
function saveNote(dateStr, taskId, note) {
  db.prepare(`INSERT INTO notes (snapshot_date, task_id, note, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(snapshot_date, task_id) DO UPDATE SET note=excluded.note, updated_at=excluded.updated_at`)
    .run(dateStr, taskId, note, new Date().toISOString());
}
// notas do dia cuja task não está mais no snapshot (task fechou/mudou de status)
function orphanNotes(dateStr) {
  return db.prepare(`SELECT n.task_id, n.note, i.name, i.url FROM notes n
    LEFT JOIN snapshot_tasks t ON t.snapshot_date=n.snapshot_date AND t.task_id=n.task_id
    LEFT JOIN task_info i ON i.task_id=n.task_id
    WHERE n.snapshot_date=? AND t.task_id IS NULL AND n.note != ''`).all(dateStr);
}

module.exports = { collect, getSnapshot, snapshotDates, getNotes, saveNote, orphanNotes };
