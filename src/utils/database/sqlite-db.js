/**
 * SQLite adapter — dùng better-sqlite3 (optional)
 * Nếu không cài được better-sqlite3, tự động fallback về JSON
 */

import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
const DB_PATH = path.join(process.cwd(), "src", "modules", "cache", "launa.db");

let _db = null;
let _initPromise = null;

function initSchema(db) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");

    db.exec(`
        CREATE TABLE IF NOT EXISTS rentals (
            thread_id TEXT PRIMARY KEY,
            exp       INTEGER NOT NULL,
            tier      TEXT    NOT NULL DEFAULT 'normal'
        );

        CREATE TABLE IF NOT EXISTS stats_members (
            thread_id  TEXT    NOT NULL,
            member_id  TEXT    NOT NULL,
            name       TEXT    NOT NULL DEFAULT '',
            total      INTEGER NOT NULL DEFAULT 0,
            day        INTEGER NOT NULL DEFAULT 0,
            week       INTEGER NOT NULL DEFAULT 0,
            join_date  INTEGER NOT NULL DEFAULT 0,
            role       TEXT    NOT NULL DEFAULT 'Thành viên',
            PRIMARY KEY (thread_id, member_id)
        );

        CREATE TABLE IF NOT EXISTS stats_threads (
            thread_id       TEXT    PRIMARY KEY,
            last_reset_day  INTEGER NOT NULL DEFAULT 0,
            last_reset_week INTEGER NOT NULL DEFAULT 0
        );
    `);
}

async function openDB() {
    if (_db) return _db;

    const SQLite = _require("better-sqlite3");
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    _db = new SQLite(DB_PATH);
    initSchema(_db);
    return _db;
}

/**
 * Trả về DB instance, hoặc null nếu better-sqlite3 không khả dụng.
 */
export async function tryGetDB() {
    if (_initPromise) return _initPromise;
    _initPromise = openDB().catch(() => {
        _initPromise = Promise.resolve(null);
        return null;
    });
    return _initPromise;
}
