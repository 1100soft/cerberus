PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, platform TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY, display_name TEXT NOT NULL, canonical_remote TEXT,
  host_type TEXT NOT NULL DEFAULT 'local', default_branch TEXT,
  manual_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repository_devices (
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  local_path TEXT NOT NULL, availability TEXT NOT NULL DEFAULT 'available',
  last_scan_at TEXT, PRIMARY KEY (repository_id, device_id)
);
CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE, git_name TEXT NOT NULL,
  git_email TEXT NOT NULL, provider_type TEXT, provider_username TEXT
);
CREATE TABLE IF NOT EXISTS repository_identity (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
  identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS device_identity_bindings (
  identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  ssh_binding TEXT, editor_executable TEXT, editor_user_data_dir TEXT,
  browser_executable TEXT, browser_profile TEXT, credential_reference TEXT,
  PRIMARY KEY (identity_id, device_id)
);
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS repository_tags (
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (repository_id, tag_id)
);
CREATE TABLE IF NOT EXISTS repository_snapshots (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
  branch TEXT, detached INTEGER NOT NULL DEFAULT 0, staged_count INTEGER NOT NULL DEFAULT 0,
  modified_count INTEGER NOT NULL DEFAULT 0, untracked_count INTEGER NOT NULL DEFAULT 0,
  ahead INTEGER NOT NULL DEFAULT 0, behind INTEGER NOT NULL DEFAULT 0,
  last_commit_summary TEXT, last_commit_at TEXT, scanned_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_rules (
  id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL, trigger_config TEXT NOT NULL DEFAULT '{}',
  action_type TEXT NOT NULL, action_config TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY, rule_id TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL, finished_at TEXT, result TEXT NOT NULL,
  exit_code INTEGER, summary TEXT
);
INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
