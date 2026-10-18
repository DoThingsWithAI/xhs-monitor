import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { XHS_GOODS_SELECTORS, XHS_GOODS_LEGACY_DEFAULT_SELECTORS } from '../core/source-selectors';

export const DB_PATH = process.env.DB_PATH || join(process.env.XHS_DATA_DIR || '/data','xhs-monitor.sqlite');
let cached: Database.Database | undefined;
export function db(): Database.Database {
  if (!cached) {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    cached = new Database(DB_PATH, { timeout: 5000 });
    cached.pragma('journal_mode = WAL');
    cached.pragma('busy_timeout = 5000');
    cached.pragma('foreign_keys = ON');
    initSchema(cached);
  }
  return cached;
}
export function initSchema(d: Database.Database): void {
  d.exec("\nCREATE TABLE IF NOT EXISTS admin_users (\n id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL\n);\nCREATE TABLE IF NOT EXISTS products (\n id TEXT PRIMARY KEY, platform TEXT NOT NULL DEFAULT 'xiaohongshu',\n platform_product_id TEXT, original_url TEXT NOT NULL, canonical_url TEXT NOT NULL UNIQUE,\n title TEXT, shop_name TEXT, category TEXT DEFAULT '',\n monitor_status TEXT NOT NULL DEFAULT 'active' CHECK(monitor_status IN ('active','paused','deleted')),\n created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER\n);\nCREATE UNIQUE INDEX IF NOT EXISTS ux_platform_product_id ON products(platform,platform_product_id) WHERE platform_product_id IS NOT NULL;\nCREATE TABLE IF NOT EXISTS data_sources (\n id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,\n enabled INTEGER NOT NULL DEFAULT 0, automated_access_allowed INTEGER NOT NULL DEFAULT 0,\n storage_allowed INTEGER NOT NULL DEFAULT 0, analysis_allowed INTEGER NOT NULL DEFAULT 0,\n permission_basis TEXT NOT NULL DEFAULT '', permission_expires_at INTEGER,\n minimum_interval_seconds INTEGER NOT NULL DEFAULT 86400,\n allowed_hosts_json TEXT NOT NULL DEFAULT '[]', selectors_json TEXT NOT NULL DEFAULT '{}',\n created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL\n);\nCREATE TABLE IF NOT EXISTS product_source_bindings (\n id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),\n source_id TEXT NOT NULL REFERENCES data_sources(id),\n status TEXT NOT NULL DEFAULT 'awaiting_authorization',\n interval_seconds INTEGER NOT NULL DEFAULT 86400,\n next_due_at INTEGER NOT NULL, last_attempt_at INTEGER, last_success_at INTEGER,\n consecutive_failures INTEGER NOT NULL DEFAULT 0, blocked_reason TEXT,\n created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(product_id,source_id)\n);\nCREATE INDEX IF NOT EXISTS ix_bindings_due ON product_source_bindings(status,next_due_at);\nCREATE TABLE IF NOT EXISTS collection_jobs (\n id TEXT PRIMARY KEY, binding_id TEXT NOT NULL REFERENCES product_source_bindings(id),\n scheduled_for INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued',\n idempotency_key TEXT NOT NULL UNIQUE, lease_owner TEXT, lease_expires_at INTEGER,\n attempt_count INTEGER NOT NULL DEFAULT 0, next_retry_at INTEGER,\n created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL\n);\nCREATE INDEX IF NOT EXISTS ix_jobs_queue ON collection_jobs(status,scheduled_for,next_retry_at);\nCREATE TABLE IF NOT EXISTS collection_runs (\n id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES collection_jobs(id),\n attempt_no INTEGER NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER,\n result TEXT, error_code TEXT, error_message_redacted TEXT, http_status INTEGER,\n adapter_version TEXT DEFAULT 'v1', UNIQUE(job_id,attempt_no)\n);\nCREATE TABLE IF NOT EXISTS product_observations (\n id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),\n source_id TEXT NOT NULL REFERENCES data_sources(id),\n job_id TEXT NOT NULL UNIQUE REFERENCES collection_jobs(id),\n run_id TEXT NOT NULL REFERENCES collection_runs(id),\n observed_at INTEGER NOT NULL, sales_raw_text TEXT, sales_value INTEGER,\n sales_precision TEXT NOT NULL CHECK(sales_precision IN ('exact','lower_bound','approximate','missing')),\n sales_scope TEXT NOT NULL DEFAULT 'product_cumulative_display',\n price_raw_text TEXT, price_minor INTEGER, price_kind TEXT NOT NULL,\n title_observed TEXT, shop_observed TEXT, quality_status TEXT NOT NULL,\n parser_version TEXT NOT NULL DEFAULT 'v1',\n CHECK(sales_precision <> 'missing' OR sales_value IS NULL)\n);\nCREATE INDEX IF NOT EXISTS ix_observation_history ON product_observations(product_id,source_id,observed_at DESC);\nCREATE TABLE IF NOT EXISTS alert_events (\n id TEXT PRIMARY KEY, product_id TEXT, source_id TEXT, type TEXT NOT NULL,\n severity TEXT NOT NULL DEFAULT 'warning', dedupe_key TEXT NOT NULL UNIQUE,\n first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,\n occurrences INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'open',\n details_json TEXT NOT NULL DEFAULT '{}'\n);\nCREATE TABLE IF NOT EXISTS system_heartbeats (name TEXT PRIMARY KEY, last_seen_at INTEGER NOT NULL);\nCREATE TABLE IF NOT EXISTS audit_logs (\n id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,\n entity_type TEXT NOT NULL, entity_id TEXT, created_at INTEGER NOT NULL\n);\n");
  const stamp = Date.now();
  d.prepare('INSERT OR IGNORE INTO data_sources (id,name,kind,enabled,automated_access_allowed,storage_allowed,analysis_allowed,permission_basis,minimum_interval_seconds,allowed_hosts_json,selectors_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    'xhs-browser','XHS browser (permission required)','licensed_browser',0,0,0,0,'',86400,
    JSON.stringify(['xiaohongshu.com','xhscdn.com']),
    JSON.stringify(XHS_GOODS_SELECTORS),stamp,stamp
  );
  // Upgrade only the untouched, disabled v1 placeholder. Never overwrite
  // user-selected selectors, and never enable automated collection by migration.
  d.prepare(`UPDATE data_sources SET selectors_json=?,updated_at=?
    WHERE id='xhs-browser' AND enabled=0 AND automated_access_allowed=0
    AND selectors_json=?`).run(JSON.stringify(XHS_GOODS_SELECTORS),
      stamp,JSON.stringify(XHS_GOODS_LEGACY_DEFAULT_SELECTORS));
}
export function uuid() { return randomUUID(); }
export function audit(action: string, entity: string, id?: string) {
 db().prepare('INSERT INTO audit_logs VALUES (?,?,?,?,?,?)').run(uuid(),'admin',action,entity,id||null,Date.now());
}
