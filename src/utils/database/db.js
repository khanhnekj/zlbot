import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, gt, sql } from "drizzle-orm";
import {
    rentals, licenseKeys, memberStats,
    threadMeta, mutes, threadSettings, botSettings, launaMemory
} from "./schema.js";

const { Pool } = pg;

let _db = null;

function getDb() {
    if (!_db) {
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false }
        });
        pool.on("error", (err) => console.error("[DB] Pool error:", err.message));
        _db = drizzle(pool);
    }
    return _db;
}

// ─────────────────────────────────────────────
// RENTALS
// ─────────────────────────────────────────────

export const db_rentals = {
    async get(threadId) {
        const db = getDb();
        const rows = await db.select().from(rentals).where(eq(rentals.threadId, threadId));
        return rows[0] || null;
    },
    async set(threadId, exp, tier = "normal") {
        const db = getDb();
        await db.insert(rentals)
            .values({ threadId, exp, tier, updatedAt: new Date() })
            .onConflictDoUpdate({
                target: rentals.threadId,
                set: { exp, tier, updatedAt: new Date() }
            });
    },
    async delete(threadId) {
        const db = getDb();
        await db.delete(rentals).where(eq(rentals.threadId, threadId));
    },
    async isRented(threadId) {
        const db = getDb();
        const rows = await db.select()
            .from(rentals)
            .where(and(eq(rentals.threadId, threadId), gt(rentals.exp, Date.now())));
        return rows.length > 0;
    },
    async getAll() {
        const db = getDb();
        return await db.select().from(rentals).orderBy(sql`${rentals.updatedAt} DESC`);
    },
    async cleanup() {
        const db = getDb();
        await db.delete(rentals).where(sql`${rentals.exp} <= ${Date.now()}`);
    }
};

// ─────────────────────────────────────────────
// LICENSE KEYS
// ─────────────────────────────────────────────

export const db_keys = {
    async get(keyValue) {
        const db = getDb();
        const rows = await db.select().from(licenseKeys).where(eq(licenseKeys.keyValue, keyValue));
        return rows[0] || null;
    },
    async create(keyValue, durationMs, tier = "normal") {
        const db = getDb();
        await db.insert(licenseKeys)
            .values({ keyValue, durationMs, tier })
            .onConflictDoNothing();
    },
    async use(keyValue, usedBy) {
        const db = getDb();
        await db.update(licenseKeys)
            .set({ usedBy, usedAt: new Date() })
            .where(and(eq(licenseKeys.keyValue, keyValue), sql`${licenseKeys.usedBy} IS NULL`));
    },
    async delete(keyValue) {
        const db = getDb();
        await db.delete(licenseKeys).where(eq(licenseKeys.keyValue, keyValue));
    },
    async getAll() {
        const db = getDb();
        return await db.select().from(licenseKeys).orderBy(sql`${licenseKeys.createdAt} DESC`);
    }
};

// ─────────────────────────────────────────────
// MEMBER STATS
// ─────────────────────────────────────────────

export const db_stats = {
    async get(threadId, memberId) {
        const db = getDb();
        const rows = await db.select().from(memberStats)
            .where(and(eq(memberStats.threadId, threadId), eq(memberStats.memberId, memberId)));
        return rows[0] || null;
    },
    async getThread(threadId) {
        const db = getDb();
        return await db.select().from(memberStats)
            .where(eq(memberStats.threadId, threadId))
            .orderBy(sql`${memberStats.total} DESC`);
    },
    async upsert(threadId, memberId, name, total, day, week, joinDate, role) {
        const db = getDb();
        await db.insert(memberStats)
            .values({ threadId, memberId, name, total, day, week, joinDate, role, updatedAt: new Date() })
            .onConflictDoUpdate({
                target: [memberStats.threadId, memberStats.memberId],
                set: { name, total, day, week, role, updatedAt: new Date() }
            });
    },
    async increment(threadId, memberId, name, role) {
        const db = getDb();
        await db.insert(memberStats)
            .values({ threadId, memberId, name, total: 1, day: 1, week: 1, role, joinDate: Date.now(), updatedAt: new Date() })
            .onConflictDoUpdate({
                target: [memberStats.threadId, memberStats.memberId],
                set: {
                    name,
                    total: sql`${memberStats.total} + 1`,
                    day: sql`${memberStats.day} + 1`,
                    week: sql`${memberStats.week} + 1`,
                    role,
                    updatedAt: new Date()
                }
            });
    },
    async resetDay(threadId) {
        const db = getDb();
        await db.update(memberStats).set({ day: 0 }).where(eq(memberStats.threadId, threadId));
    },
    async resetWeek(threadId) {
        const db = getDb();
        await db.update(memberStats).set({ week: 0 }).where(eq(memberStats.threadId, threadId));
    },
    async getMeta(threadId) {
        const db = getDb();
        const rows = await db.select().from(threadMeta).where(eq(threadMeta.threadId, threadId));
        return rows[0] || { lastResetDay: 0, lastResetWeek: 0 };
    },
    async setMeta(threadId, lastResetDay, lastResetWeek) {
        const db = getDb();
        await db.insert(threadMeta)
            .values({ threadId, lastResetDay, lastResetWeek, updatedAt: new Date() })
            .onConflictDoUpdate({
                target: threadMeta.threadId,
                set: { lastResetDay, lastResetWeek, updatedAt: new Date() }
            });
    }
};

// ─────────────────────────────────────────────
// MUTES
// ─────────────────────────────────────────────

export const db_mutes = {
    async add(threadId, memberId) {
        const db = getDb();
        await db.insert(mutes).values({ threadId, memberId }).onConflictDoNothing();
    },
    async remove(threadId, memberId) {
        const db = getDb();
        await db.delete(mutes).where(and(eq(mutes.threadId, threadId), eq(mutes.memberId, memberId)));
    },
    async isMuted(threadId, memberId) {
        const db = getDb();
        const rows = await db.select().from(mutes)
            .where(and(eq(mutes.threadId, threadId), eq(mutes.memberId, memberId)));
        return rows.length > 0;
    },
    async getAll(threadId) {
        const db = getDb();
        const rows = await db.select({ memberId: mutes.memberId }).from(mutes)
            .where(eq(mutes.threadId, threadId));
        return rows.map(r => r.memberId);
    },
    async clearThread(threadId) {
        const db = getDb();
        await db.delete(mutes).where(eq(mutes.threadId, threadId));
    }
};

// ─────────────────────────────────────────────
// THREAD SETTINGS
// ─────────────────────────────────────────────

export const db_thread = {
    async get(threadId) {
        const db = getDb();
        const rows = await db.select().from(threadSettings).where(eq(threadSettings.threadId, threadId));
        return rows[0] || null;
    },
    async ensure(threadId) {
        const db = getDb();
        await db.insert(threadSettings).values({ threadId }).onConflictDoNothing();
        return this.get(threadId);
    },
    async setPrefix(threadId, prefix) {
        const db = getDb();
        await db.insert(threadSettings)
            .values({ threadId, prefix, updatedAt: new Date() })
            .onConflictDoUpdate({
                target: threadSettings.threadId,
                set: { prefix, updatedAt: new Date() }
            });
    },
    async getPrefix(threadId, defaultPrefix = ".") {
        const db = getDb();
        const rows = await db.select({ prefix: threadSettings.prefix })
            .from(threadSettings).where(eq(threadSettings.threadId, threadId));
        return rows[0]?.prefix || defaultPrefix;
    },
    async setAdminOnly(threadId, value) {
        const db = getDb();
        await db.insert(threadSettings)
            .values({ threadId, adminOnly: value, updatedAt: new Date() })
            .onConflictDoUpdate({
                target: threadSettings.threadId,
                set: { adminOnly: value, updatedAt: new Date() }
            });
    },
    async setAutoReact(threadId, enabled, count, icon) {
        const db = getDb();
        await db.insert(threadSettings)
            .values({ threadId, autoReactEnabled: enabled, autoReactCount: count, autoReactIcon: icon || null, updatedAt: new Date() })
            .onConflictDoUpdate({
                target: threadSettings.threadId,
                set: { autoReactEnabled: enabled, autoReactCount: count, autoReactIcon: icon || null, updatedAt: new Date() }
            });
    },
    async setProtection(threadId, settings) {
        const db = getDb();
        await db.insert(threadSettings)
            .values({
                threadId,
                protectionPhoto: !!settings.photo,
                protectionTag: !!settings.tag,
                protectionSticker: !!settings.sticker,
                protectionSpam: !!settings.spam,
                protectionUndo: !!settings.undo,
                updatedAt: new Date()
            })
            .onConflictDoUpdate({
                target: threadSettings.threadId,
                set: {
                    protectionPhoto: !!settings.photo,
                    protectionTag: !!settings.tag,
                    protectionSticker: !!settings.sticker,
                    protectionSpam: !!settings.spam,
                    protectionUndo: !!settings.undo,
                    updatedAt: new Date()
                }
            });
    },
    async getProtection(threadId) {
        const db = getDb();
        const rows = await db.select({
            protectionPhoto: threadSettings.protectionPhoto,
            protectionTag: threadSettings.protectionTag,
            protectionSticker: threadSettings.protectionSticker,
            protectionSpam: threadSettings.protectionSpam,
            protectionUndo: threadSettings.protectionUndo
        }).from(threadSettings).where(eq(threadSettings.threadId, threadId));
        if (!rows[0]) return { photo: false, tag: false, sticker: false, spam: false, undo: false };
        const row = rows[0];
        return {
            photo: row.protectionPhoto,
            tag: row.protectionTag,
            sticker: row.protectionSticker,
            spam: row.protectionSpam,
            undo: row.protectionUndo
        };
    }
};

// ─────────────────────────────────────────────
// BOT SETTINGS (key-value store)
// ─────────────────────────────────────────────

export const db_settings = {
    async get(key) {
        const db = getDb();
        const rows = await db.select({ value: botSettings.value })
            .from(botSettings).where(eq(botSettings.key, key));
        return rows[0]?.value || null;
    },
    async set(key, value) {
        const db = getDb();
        await db.insert(botSettings)
            .values({ key, value: String(value), updatedAt: new Date() })
            .onConflictDoUpdate({
                target: botSettings.key,
                set: { value: String(value), updatedAt: new Date() }
            });
    },
    async delete(key) {
        const db = getDb();
        await db.delete(botSettings).where(eq(botSettings.key, key));
    },
    async getAll() {
        const db = getDb();
        const rows = await db.select({ key: botSettings.key, value: botSettings.value }).from(botSettings)
            .orderBy(botSettings.key);
        return Object.fromEntries(rows.map(r => [r.key, r.value]));
    }
};

// ─────────────────────────────────────────────
// LAUNA MEMORY (AI chat history)
// ─────────────────────────────────────────────

export const db_launa = {
    async loadHistory(threadId, limit = 12) {
        const db = getDb();
        const rows = await db.select({
            role: launaMemory.role,
            content: launaMemory.content
        })
            .from(launaMemory)
            .where(eq(launaMemory.threadId, String(threadId)))
            .orderBy(sql`${launaMemory.createdAt} DESC`)
            .limit(limit);
        return rows.reverse();
    },

    async saveExchange(threadId, userId, userMsg, assistantMsg) {
        const db = getDb();
        await db.insert(launaMemory).values([
            { threadId: String(threadId), userId: String(userId), role: "user", content: userMsg },
            { threadId: String(threadId), userId: String(userId), role: "assistant", content: assistantMsg }
        ]);
        await db.execute(sql`
            DELETE FROM launa_memory
            WHERE thread_id = ${String(threadId)}
              AND id NOT IN (
                SELECT id FROM launa_memory
                WHERE thread_id = ${String(threadId)}
                ORDER BY created_at DESC
                LIMIT ${12 * 2}
              )
        `);
    },

    async clearHistory(threadId) {
        const db = getDb();
        const result = await db.delete(launaMemory)
            .where(eq(launaMemory.threadId, String(threadId)));
        return result.rowCount ?? 0;
    }
};

export default {
    rentals: db_rentals,
    keys: db_keys,
    stats: db_stats,
    mutes: db_mutes,
    thread: db_thread,
    settings: db_settings,
    launa: db_launa
};
