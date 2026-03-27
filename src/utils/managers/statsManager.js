import fs from "node:fs";
import path from "node:path";
import { log } from "../../logger.js";
import { tryGetDB } from "../database/sqlite-db.js";

const statsPath = path.join(process.cwd(), "src", "modules", "cache", "stats.json");

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// ─── JSON fallback store ──────────────────────────────────────────────────────
const jsonStore = {
    _data: {},
    _saveTimeout: null,
    load() {
        if (Object.keys(this._data).length > 0) return this._data;
        try {
            if (fs.existsSync(statsPath)) {
                this._data = JSON.parse(fs.readFileSync(statsPath, "utf-8"));
            } else { this._data = {}; this.save(); }
        } catch (e) { log.error("Lỗi khi load stats.json:", e.message); this._data = {}; }
        return this._data;
    },
    save() {
        try {
            const dir = path.dirname(statsPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(statsPath, JSON.stringify(this._data, null, 2), "utf-8");
        } catch (e) { log.error("Lỗi khi save stats.json:", e.message); }
    },
    saveDebounced() {
        if (this._saveTimeout) clearTimeout(this._saveTimeout);
        this._saveTimeout = setTimeout(() => this.save(), 5000);
    }
};

// ─── SQLite state ─────────────────────────────────────────────────────────────
let _db = null;
let _useSQLite = null;

async function getStorage() {
    if (_useSQLite !== null) return _useSQLite ? _db : null;
    const db = await tryGetDB();
    _useSQLite = !!db;
    if (db) {
        _db = db;
        // Migrate từ JSON sang SQLite (chỉ lần đầu)
        if (fs.existsSync(statsPath)) {
            try {
                const raw = JSON.parse(fs.readFileSync(statsPath, "utf-8"));
                migrateJSONtoSQLite(db, raw);
                fs.renameSync(statsPath, statsPath + ".bak");
                log.info("[StatsManager] Đã migrate stats.json → SQLite ✅");
            } catch (e) {
                log.warn(`[StatsManager] Migrate JSON lỗi: ${e.message}`);
            }
        }
    }
    return _useSQLite ? _db : null;
}

function migrateJSONtoSQLite(db, data) {
    const insertThread = db.prepare(`
        INSERT OR IGNORE INTO stats_threads (thread_id, last_reset_day, last_reset_week)
        VALUES (?, ?, ?)
    `);
    const insertMember = db.prepare(`
        INSERT OR IGNORE INTO stats_members
            (thread_id, member_id, name, total, day, week, join_date, role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const migrate = db.transaction(() => {
        for (const [tid, thread] of Object.entries(data)) {
            insertThread.run(tid, thread.lastResetDay || 0, thread.lastResetWeek || 0);
            for (const [uid, m] of Object.entries(thread.members || {})) {
                insertMember.run(tid, uid, m.name || "", m.total || 0, m.day || 0,
                    m.week || 0, m.joinDate || Date.now(), m.role || "Thành viên");
            }
        }
    });
    migrate();
}

// ─── Prepared statements (lazy) ───────────────────────────────────────────────
let stmts = null;
function getStmts(db) {
    if (stmts && stmts._db === db) return stmts;
    stmts = {
        _db: db,
        getThread:      db.prepare("SELECT * FROM stats_threads WHERE thread_id = ?"),
        upsertThread:   db.prepare(`INSERT INTO stats_threads (thread_id, last_reset_day, last_reset_week)
                                    VALUES (?, ?, ?)
                                    ON CONFLICT(thread_id) DO UPDATE SET
                                    last_reset_day = excluded.last_reset_day,
                                    last_reset_week = excluded.last_reset_week`),
        getMember:      db.prepare("SELECT * FROM stats_members WHERE thread_id = ? AND member_id = ?"),
        upsertMember:   db.prepare(`INSERT INTO stats_members
                                    (thread_id, member_id, name, total, day, week, join_date, role)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                                    ON CONFLICT(thread_id, member_id) DO UPDATE SET
                                    name = excluded.name, total = excluded.total,
                                    day = excluded.day, week = excluded.week, role = excluded.role`),
        resetDay:       db.prepare("UPDATE stats_members SET day = 0 WHERE thread_id = ?"),
        resetWeek:      db.prepare("UPDATE stats_members SET week = 0 WHERE thread_id = ?"),
        resetDayAll:    db.prepare("UPDATE stats_members SET day = 0"),
        resetWeekAll:   db.prepare("UPDATE stats_members SET week = 0"),
        getTop:         (type) => db.prepare(`SELECT member_id AS id, name, total, day, week, join_date AS joinDate, role
                                              FROM stats_members WHERE thread_id = ?
                                              ORDER BY ${type} DESC LIMIT 10`),
        getAllThreads:   db.prepare("SELECT DISTINCT thread_id FROM stats_members"),
        setRole:        db.prepare("UPDATE stats_members SET role = ? WHERE thread_id = ? AND member_id = ?"),
    };
    return stmts;
}

// ─── Public API ───────────────────────────────────────────────────────────────
export const statsManager = {
    async load() {
        await getStorage();
        if (!_useSQLite) jsonStore.load();
    },

    addMessage(threadId, senderId, senderName, role = null) {
        const db = _useSQLite ? _db : null;
        if (db) {
            const s = getStmts(db);
            const now = new Date();
            const today = now.getDate();
            const week  = getWeekNumber(now);

            let thread = s.getThread.get(threadId);
            if (!thread) {
                s.upsertThread.run(threadId, today, week);
                thread = { last_reset_day: today, last_reset_week: week };
            }

            if (thread.last_reset_day !== today) {
                s.resetDay.run(threadId);
                s.upsertThread.run(threadId, today, thread.last_reset_week);
            }
            if (thread.last_reset_week !== week) {
                s.resetWeek.run(threadId);
                s.upsertThread.run(threadId, thread.last_reset_day, week);
            }

            let member = s.getMember.get(threadId, senderId);
            const newTotal = (member?.total || 0) + 1;
            const newDay   = (member?.day   || 0) + 1;
            const newWeek  = (member?.week  || 0) + 1;
            const finalRole = role
                ? (role === "Admin" || !member?.role || member.role === "Thành viên" ? role : (member?.role || "Thành viên"))
                : (member?.role || "Thành viên");

            s.upsertMember.run(threadId, senderId, senderName, newTotal, newDay, newWeek,
                member?.join_date || Date.now(), finalRole);
            return;
        }

        // JSON fallback (logic giữ nguyên)
        const data = jsonStore.load();
        if (!data[threadId]) data[threadId] = { members: {}, lastResetDay: new Date().getDate(), lastResetWeek: getWeekNumber(new Date()) };
        const thread = data[threadId];
        const now = new Date();
        const today = now.getDate();
        const currentWeek = getWeekNumber(now);

        if (thread.lastResetDay !== today) { Object.values(thread.members).forEach(m => m.day = 0); thread.lastResetDay = today; }
        if (thread.lastResetWeek !== currentWeek) { Object.values(thread.members).forEach(m => m.week = 0); thread.lastResetWeek = currentWeek; }

        if (!thread.members[senderId]) {
            thread.members[senderId] = { name: senderName, total: 0, day: 0, week: 0, joinDate: Date.now(), role: "Thành viên" };
        }
        const member = thread.members[senderId];
        member.name = senderName;
        if (role) { if (role === "Admin" || member.role === "Thành viên") member.role = role; }
        member.total++; member.day++; member.week++;
        jsonStore.saveDebounced();
    },

    getStats(threadId, senderId) {
        const db = _useSQLite ? _db : null;
        if (db) {
            const row = getStmts(db).getMember.get(threadId, senderId);
            if (!row) return null;
            return { name: row.name, total: row.total, day: row.day, week: row.week, joinDate: row.join_date, role: row.role };
        }
        const data = jsonStore.load();
        const thread = data[threadId];
        if (!thread || !thread.members[senderId]) return null;
        return thread.members[senderId];
    },

    getTop(threadId, type = "total", limit = 10) {
        const db = _useSQLite ? _db : null;
        if (db) {
            const allowed = ["total", "day", "week"];
            const col = allowed.includes(type) ? type : "total";
            return db.prepare(`SELECT member_id AS id, name, total, day, week, join_date AS joinDate, role
                               FROM stats_members WHERE thread_id = ?
                               ORDER BY ${col} DESC LIMIT ?`).all(threadId, limit);
        }
        const data = jsonStore.load();
        const thread = data[threadId];
        if (!thread) return [];
        return Object.entries(thread.members)
            .map(([id, d]) => ({ id, ...d }))
            .sort((a, b) => b[type] - a[type])
            .slice(0, limit);
    },

    getAllThreads() {
        const db = _useSQLite ? _db : null;
        if (db) return getStmts(db).getAllThreads.all().map(r => r.thread_id);
        return Object.keys(jsonStore.load());
    },

    setRole(threadId, uid, role) {
        const db = _useSQLite ? _db : null;
        if (db) { getStmts(db).setRole.run(role, threadId, uid); return; }
        const data = jsonStore.load();
        if (!data[threadId]) data[threadId] = { members: {}, lastResetDay: new Date().getDate(), lastResetWeek: getWeekNumber(new Date()) };
        if (!data[threadId].members[uid]) {
            data[threadId].members[uid] = { name: "Người dùng", total: 0, day: 0, week: 0, joinDate: Date.now(), role };
        } else { data[threadId].members[uid].role = role; }
        jsonStore.save();
    },

    resetDayAll() {
        const db = _useSQLite ? _db : null;
        if (db) {
            const s = getStmts(db);
            s.resetDayAll.run();
            db.prepare("UPDATE stats_threads SET last_reset_day = ?").run(new Date().getDate());
            return;
        }
        const data = jsonStore.load();
        Object.values(data).forEach(t => { Object.values(t.members || {}).forEach(m => m.day = 0); t.lastResetDay = new Date().getDate(); });
        jsonStore.save();
    },

    resetWeekAll() {
        const db = _useSQLite ? _db : null;
        if (db) {
            const s = getStmts(db);
            s.resetWeekAll.run();
            db.prepare("UPDATE stats_threads SET last_reset_week = ?").run(getWeekNumber(new Date()));
            return;
        }
        const data = jsonStore.load();
        const week = getWeekNumber(new Date());
        Object.values(data).forEach(t => { Object.values(t.members || {}).forEach(m => m.week = 0); t.lastResetWeek = week; });
        jsonStore.save();
    },

    // Giữ tương thích API cũ (sync save)
    save() { if (!_useSQLite) jsonStore.save(); },
    saveDebounced() { if (!_useSQLite) jsonStore.saveDebounced(); },
    _getWeekNumber: getWeekNumber
};
