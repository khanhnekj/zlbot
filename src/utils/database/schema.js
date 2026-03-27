import { pgTable, text, boolean, integer, bigint, timestamp } from "drizzle-orm/pg-core";

export const rentals = pgTable("rentals", {
    threadId: text("thread_id").primaryKey(),
    exp: bigint("exp", { mode: "number" }).notNull(),
    tier: text("tier").notNull().default("normal"),
    updatedAt: timestamp("updated_at").defaultNow()
});

export const licenseKeys = pgTable("license_keys", {
    keyValue: text("key_value").primaryKey(),
    durationMs: bigint("duration_ms", { mode: "number" }).notNull(),
    tier: text("tier").notNull().default("normal"),
    usedBy: text("used_by"),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow()
});

export const memberStats = pgTable("member_stats", {
    threadId: text("thread_id").notNull(),
    memberId: text("member_id").notNull(),
    name: text("name"),
    total: bigint("total", { mode: "number" }).default(0),
    day: bigint("day", { mode: "number" }).default(0),
    week: bigint("week", { mode: "number" }).default(0),
    joinDate: bigint("join_date", { mode: "number" }),
    role: text("role"),
    updatedAt: timestamp("updated_at").defaultNow()
});

export const threadMeta = pgTable("thread_meta", {
    threadId: text("thread_id").primaryKey(),
    lastResetDay: bigint("last_reset_day", { mode: "number" }).default(0),
    lastResetWeek: bigint("last_reset_week", { mode: "number" }).default(0),
    updatedAt: timestamp("updated_at").defaultNow()
});

export const mutes = pgTable("mutes", {
    threadId: text("thread_id").notNull(),
    memberId: text("member_id").notNull()
});

export const threadSettings = pgTable("thread_settings", {
    threadId: text("thread_id").primaryKey(),
    prefix: text("prefix").default("."),
    adminOnly: boolean("admin_only").default(false),
    autoReactEnabled: boolean("auto_react_enabled").default(false),
    autoReactCount: integer("auto_react_count").default(0),
    autoReactIcon: text("auto_react_icon"),
    protectionPhoto: boolean("protection_photo").default(false),
    protectionTag: boolean("protection_tag").default(false),
    protectionSticker: boolean("protection_sticker").default(false),
    protectionSpam: boolean("protection_spam").default(false),
    protectionUndo: boolean("protection_undo").default(false),
    updatedAt: timestamp("updated_at").defaultNow()
});

export const botSettings = pgTable("bot_settings", {
    key: text("key").primaryKey(),
    value: text("value"),
    updatedAt: timestamp("updated_at").defaultNow()
});

export const launaMemory = pgTable("launa_memory", {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    threadId: text("thread_id").notNull(),
    userId: text("user_id"),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow()
});
