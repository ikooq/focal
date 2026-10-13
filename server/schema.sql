CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS energy_logs (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), energy_level INTEGER NOT NULL CHECK(energy_level BETWEEN 1 AND 10), logged_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_energy_user_time ON energy_logs(user_id,logged_at);
CREATE TABLE IF NOT EXISTS tasks (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
 brain_hemisphere TEXT NOT NULL CHECK(brain_hemisphere IN ('analytical','creative')),
 required_energy INTEGER NOT NULL CHECK(required_energy BETWEEN 1 AND 10), deadline TEXT,
 penalty_minor INTEGER NOT NULL DEFAULT 0 CHECK(penalty_minor>=0), currency TEXT NOT NULL DEFAULT 'KZT',
 status TEXT NOT NULL CHECK(status IN ('pending','active','completed','failed')), created_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id,status);
CREATE TABLE IF NOT EXISTS focus_sessions (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
 dopamine_debt_duration INTEGER NOT NULL CHECK(dopamine_debt_duration BETWEEN 0 AND 20),
 work_duration INTEGER NOT NULL CHECK(work_duration BETWEEN 1 AND 120), break_duration INTEGER NOT NULL CHECK(break_duration BETWEEN 1 AND 60),
 audio_type TEXT NOT NULL CHECK(audio_type IN ('baroque','binaural','isochronic','none')),
 is_successful INTEGER CHECK(is_successful IN (0,1)), phase TEXT NOT NULL CHECK(phase IN ('preparation','work','break','completed','cancelled')),
 started_at TEXT NOT NULL, phase_ends_at TEXT NOT NULL, ended_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_running_session ON focus_sessions((1)) WHERE phase IN ('preparation','work','break');
CREATE INDEX IF NOT EXISTS idx_sessions_task ON focus_sessions(task_id);
CREATE TABLE IF NOT EXISTS financial_transactions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL CHECK(type IN ('income','expense','penalty')),
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0), currency TEXT NOT NULL DEFAULT 'KZT', category TEXT NOT NULL,
 planned_date TEXT NOT NULL, actual_date TEXT, task_id TEXT REFERENCES tasks(id), session_id TEXT REFERENCES focus_sessions(id),
 idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON financial_transactions(user_id,planned_date);
CREATE TABLE IF NOT EXISTS notes (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',note_date TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_user_date ON notes(user_id,note_date);
CREATE TABLE IF NOT EXISTS calendar_events (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',
 start_at TEXT NOT NULL,end_at TEXT NOT NULL CHECK(end_at>start_at),color TEXT NOT NULL CHECK(color IN ('emerald','sky','violet','rose','amber')),
 task_id TEXT REFERENCES tasks(id),completed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_user_start ON calendar_events(user_id,start_at);
CREATE INDEX IF NOT EXISTS idx_events_task ON calendar_events(task_id);
CREATE TABLE IF NOT EXISTS event_series (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),rule_json TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS week_templates (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,blocks_json TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS calendar_undo (
 user_id TEXT PRIMARY KEY REFERENCES users(id),label TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS applied_requests (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL
);
PRAGMA optimize;
CREATE TABLE IF NOT EXISTS projects (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',target_date TEXT,color TEXT NOT NULL DEFAULT 'emerald',archived INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS habits (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,target_per_week INTEGER NOT NULL CHECK(target_per_week BETWEEN 1 AND 7),color TEXT NOT NULL DEFAULT 'emerald',archived INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS habit_checks (
 id TEXT PRIMARY KEY,habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,check_date TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(habit_id,check_date)
);
CREATE TABLE IF NOT EXISTS decisions (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,reasons TEXT NOT NULL DEFAULT '',expected TEXT NOT NULL DEFAULT '',outcome TEXT NOT NULL DEFAULT '',decided_on TEXT NOT NULL,review_on TEXT,reviewed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS work_checkpoints (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),task_id TEXT NOT NULL REFERENCES tasks(id),session_id TEXT REFERENCES focus_sessions(id),summary TEXT NOT NULL,next_step TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS focus_thoughts (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),task_id TEXT REFERENCES tasks(id),session_id TEXT REFERENCES focus_sessions(id),body TEXT NOT NULL,created_at TEXT NOT NULL,resolved_at TEXT,destination TEXT
);
CREATE TABLE IF NOT EXISTS resources (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),task_id TEXT REFERENCES tasks(id),note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,title TEXT NOT NULL,url TEXT,mime TEXT,content BLOB,size INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,CHECK(task_id IS NOT NULL OR note_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS user_settings (
 user_id TEXT PRIMARY KEY REFERENCES users(id),json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS recurring_flows (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('income','expense')),amount_minor INTEGER NOT NULL CHECK(amount_minor>0),frequency TEXT NOT NULL CHECK(frequency IN ('weekly','monthly')),start_date TEXT NOT NULL,end_date TEXT,enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plan_previews (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,summary TEXT NOT NULL,payload_json TEXT NOT NULL,baseline_json TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,applied_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON work_checkpoints(task_id,created_at);
CREATE INDEX IF NOT EXISTS idx_thoughts_user ON focus_thoughts(user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_resources_task ON resources(task_id);
CREATE INDEX IF NOT EXISTS idx_resources_note ON resources(note_id);
