const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'app.db');
require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  list_id TEXT,
  contract TEXT,
  list_name TEXT,
  name TEXT,
  ordem INTEGER,
  peso INTEGER,
  clean_title TEXT,
  status TEXT,
  is_pacote INTEGER DEFAULT 0,
  is_subtask INTEGER DEFAULT 0,
  assignees TEXT,
  tags TEXT,
  due_date INTEGER,
  url TEXT,
  revisor TEXT,
  description_excerpt TEXT,
  priority TEXT,
  date_updated INTEGER,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  from_status TEXT,
  to_status TEXT,
  at TEXT
);
CREATE INDEX IF NOT EXISTS idx_status_events_task ON status_events(task_id, at);

CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_date TEXT PRIMARY KEY,
  collected_at TEXT
);

CREATE TABLE IF NOT EXISTS snapshot_tasks (
  snapshot_date TEXT,
  task_id TEXT,
  task_name TEXT,
  url TEXT,
  status TEXT,
  assignees TEXT,
  due_date INTEGER,
  priority TEXT,
  tags TEXT,
  list_name TEXT,
  contract TEXT,
  is_subtask INTEGER DEFAULT 0,
  PRIMARY KEY (snapshot_date, task_id)
);

CREATE TABLE IF NOT EXISTS notes (
  snapshot_date TEXT,
  task_id TEXT,
  note TEXT,
  updated_at TEXT,
  PRIMARY KEY (snapshot_date, task_id)
);

CREATE TABLE IF NOT EXISTS task_info (
  task_id TEXT PRIMARY KEY,
  name TEXT,
  url TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS discord_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_name TEXT UNIQUE,
  discord_id TEXT
);

CREATE TABLE IF NOT EXISTS discord_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_name TEXT,
  discord_id TEXT,
  direction TEXT,
  content TEXT,
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS cycle_close (
  pacote_id TEXT PRIMARY KEY,
  data TEXT,
  updated_at TEXT
);
`);

const stmts = {
  upsertTask: db.prepare(`INSERT INTO tasks (id,list_id,contract,list_name,name,ordem,peso,clean_title,status,is_pacote,is_subtask,assignees,tags,due_date,url,revisor,description_excerpt,priority,date_updated,synced_at)
    VALUES (@id,@list_id,@contract,@list_name,@name,@ordem,@peso,@clean_title,@status,@is_pacote,@is_subtask,@assignees,@tags,@due_date,@url,@revisor,@description_excerpt,@priority,@date_updated,@synced_at)
    ON CONFLICT(id) DO UPDATE SET list_id=@list_id,contract=@contract,list_name=@list_name,name=@name,ordem=@ordem,peso=@peso,clean_title=@clean_title,status=@status,is_pacote=@is_pacote,is_subtask=@is_subtask,assignees=@assignees,tags=@tags,due_date=@due_date,url=@url,revisor=@revisor,description_excerpt=@description_excerpt,priority=@priority,date_updated=@date_updated,synced_at=@synced_at`),
  getTask: db.prepare(`SELECT status FROM tasks WHERE id=?`),
  insertEvent: db.prepare(`INSERT INTO status_events (task_id,from_status,to_status,at) VALUES (?,?,?,?)`),
};

function upsertTask(t) {
  const prev = stmts.getTask.get(t.id);
  stmts.upsertTask.run(t);
  if (prev && prev.status !== t.status) {
    stmts.insertEvent.run(t.id, prev.status, t.status, new Date().toISOString());
  } else if (!prev) {
    stmts.insertEvent.run(t.id, null, t.status, new Date().toISOString());
  }
}

const S = {
  openTasks: db.prepare(`SELECT * FROM tasks WHERE status != 'executado' ORDER BY due_date`),
  taskById: db.prepare(`SELECT * FROM tasks WHERE id=?`),
};

function openTasks() { return S.openTasks.all(); }
function taskById(id) { return S.taskById.get(id); }
function taskEvents(taskId) {
  return db.prepare(`SELECT * FROM status_events WHERE task_id=? ORDER BY at`).all(taskId);
}
function firstSeenStatus(taskId, status) {
  const r = db.prepare(`SELECT MIN(at) at FROM status_events WHERE task_id=? AND to_status=?`).get(taskId, status);
  return r && r.at;
}

module.exports = { db, upsertTask, openTasks, taskById, taskEvents, firstSeenStatus };
