import fs from "node:fs";
import path from "node:path";
import { log } from "../../logger.js";
import { tryGetDB } from "../database/sqlite-db.js";

const rentalsPath = path.join(process.cwd(), "src", "modules", "cache", "rentals.json");

// ─── Đọc JSON cũ để migrate sang SQLite lần đầu ──────────────────────────────
function readLegacyJSON() {
    try {
        if (!fs.existsSync(rentalsPath)) return {};
        return JSON.parse(fs.readFileSync(rentalsPath, "utf-8"));
    } catch { return {}; }
}

async function migrateJSONtoSQLite(db, data) {
    const insert = db.prepare(`
        INSERT OR IGNORE INTO rentals (thread_id, exp, tier)
        VALUES (@thread_id, @exp, @tier)
    `);
    const insertMany = db.transaction((entries) => {
        for (const e of entries) insert.run(e);
    });
    const entries = Object.entries(data).map(([id, val]) => ({
        thread_id: id,
        exp:  typeof val === "object" ? val.exp  : val,
        tier: typeof val === "object" ? (val.tier || "normal") : "normal"
    }));
    if (entries.length > 0) insertMany(entries);
}

// ─── Khởi tạo SQLite (lazy) ──────────────────────────────────────────────────
let _db = null;
let _useSQLite = null;

async function getStorage() {
    if (_useSQLite !== null) return _useSQLite ? _db : null;
    const db = await tryGetDB();
    if (db) {
        _db = db;
        _useSQLite = true;
        // Migration từ JSON sang SQLite
        const legacy = readLegacyJSON();
        if (Object.keys(legacy).length > 0) {
            try {
                await migrateJSONtoSQLite(db, legacy);
                // Đổi tên file JSON cũ để tránh nhầm lẫn
                const bakPath = rentalsPath + ".bak";
                if (!fs.existsSync(bakPath)) fs.renameSync(rentalsPath, bakPath);
                log.info("[RentalManager] Đã migrate rentals.json → SQLite ✅");
            } catch (e) {
                log.warn(`[RentalManager] Migrate JSON lỗi: ${e.message}`);
            }
        }
        return db;
    }
    _useSQLite = false;
    return null;
}

// ─── JSON fallback ────────────────────────────────────────────────────────────
const jsonStore = {
    _data: {},
    load() {
        if (Object.keys(this._data).length > 0) return this._data;
        try {
            if (fs.existsSync(rentalsPath)) {
                this._data = JSON.parse(fs.readFileSync(rentalsPath, "utf-8"));
            } else { this._data = {}; this.save(); }
        } catch (e) { log.error("Lỗi khi load rentals.json:", e.message); this._data = {}; }
        return this._data;
    },
    save() {
        try {
            const dir = path.dirname(rentalsPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(rentalsPath, JSON.stringify(this._data, null, 2), "utf-8");
        } catch (e) { log.error("Lỗi khi save rentals.json:", e.message); }
    }
};

// ─── Public API ───────────────────────────────────────────────────────────────
export const rentalManager = {
    // Gọi khi khởi động bot để warm-up SQLite
    async load() {
        await getStorage();
        if (!_useSQLite) jsonStore.load();
    },

    async addRent(threadId, days, tier = "normal") {
        const db = await getStorage();
        const msToAdd = days * 24 * 60 * 60 * 1000;
        const now = Date.now();

        if (db) {
            const row = db.prepare("SELECT exp, tier FROM rentals WHERE thread_id = ?").get(String(threadId));
            const currentExp = row ? Math.max(row.exp, now) : now;
            const newExp = currentExp + msToAdd;
            db.prepare(`
                INSERT INTO rentals (thread_id, exp, tier) VALUES (?, ?, ?)
                ON CONFLICT(thread_id) DO UPDATE SET exp = excluded.exp, tier = excluded.tier
            `).run(String(threadId), newExp, tier);
            return newExp;
        }

        // JSON fallback
        const d = jsonStore.load();
        let currentExp = now;
        if (d[threadId]) {
            currentExp = Math.max(typeof d[threadId] === "object" ? d[threadId].exp : d[threadId], now);
        }
        const newExp = currentExp + msToAdd;
        d[threadId] = { exp: newExp, tier };
        jsonStore.save();
        return newExp;
    },

    isRented(threadId) {
        if (_useSQLite && _db) {
            const row = _db.prepare("SELECT exp FROM rentals WHERE thread_id = ?").get(String(threadId));
            return row ? row.exp > Date.now() : false;
        }
        const d = jsonStore.load();
        const data = d[String(threadId)];
        if (!data) return false;
        return (typeof data === "object" ? data.exp : data) > Date.now();
    },

    getTier(threadId) {
        if (_useSQLite && _db) {
            const row = _db.prepare("SELECT tier FROM rentals WHERE thread_id = ?").get(String(threadId));
            return row ? (row.tier || "normal") : "none";
        }
        const d = jsonStore.load();
        const data = d[String(threadId)];
        if (!data) return "none";
        return typeof data === "object" ? (data.tier || "normal") : "normal";
    },

    getExpiry(threadId) {
        let exp, tier;
        if (_useSQLite && _db) {
            const row = _db.prepare("SELECT exp, tier FROM rentals WHERE thread_id = ?").get(String(threadId));
            if (!row) return "Chưa thuê";
            exp = row.exp; tier = row.tier || "normal";
        } else {
            const d = jsonStore.load();
            const data = d[threadId];
            if (!data) return "Chưa thuê";
            exp  = typeof data === "object" ? data.exp  : data;
            tier = typeof data === "object" ? data.tier : "normal";
        }
        if (exp <= Date.now()) return "Đã hết hạn";
        return `${new Date(exp).toLocaleString("vi-VN")} (${tier})`;
    },

    getAllRentals() {
        const now = Date.now();
        if (_useSQLite && _db) {
            return _db.prepare("SELECT thread_id AS id, exp, tier FROM rentals WHERE exp > ?").all(now);
        }
        const d = jsonStore.load();
        return Object.entries(d)
            .filter(([_, data]) => (typeof data === "object" ? data.exp : data) > now)
            .map(([id, data]) => ({
                id,
                exp:  typeof data === "object" ? data.exp  : data,
                tier: typeof data === "object" ? data.tier : "normal"
            }));
    },

    async removeRent(threadId) {
        const db = await getStorage();
        if (db) {
            const info = db.prepare("DELETE FROM rentals WHERE thread_id = ?").run(String(threadId));
            return info.changes > 0;
        }
        const d = jsonStore.load();
        if (d[threadId]) { delete d[threadId]; jsonStore.save(); return true; }
        return false;
    }
};
