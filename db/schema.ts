import { integer, sqliteTable, text, uniqueIndex, index, primaryKey, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const users = sqliteTable("users", {
  id: text("id").primaryKey(), createdAt: text("created_at").notNull(),
});
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => users.id),
  kind: text("kind").notNull(), metadata: text("metadata").notNull(), revision: integer("revision").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (t) => [uniqueIndex("projects_owner_unique").on(t.ownerId), check("revision_nonnegative", sql`${t.revision} >= 0`)]);
export const workspaces = sqliteTable("workspaces", {
  projectId: text("project_id").primaryKey().references(() => projects.id), content: text("content").notNull(), savedAt: text("saved_at").notNull(),
});
export const dailyHistory = sqliteTable("daily_history", {
  projectId: text("project_id").notNull().references(() => projects.id), date: text("date").notNull(),
  content: text("content").notNull(), savedAt: text("saved_at").notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.date] })]);
export const restoreBackups = sqliteTable("restore_backups", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id),
  content: text("content").notNull(), savedAt: text("saved_at").notNull(),
}, (t) => [index("restore_project_idx").on(t.projectId)]);
export const fileVersions = sqliteTable("file_versions", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id),
  metadata: text("metadata").notNull(), sha256: text("sha256").notNull(), bytes: integer("bytes").notNull(),
  status: text("status").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("file_project_hash_unique").on(t.projectId, t.sha256), index("file_project_date_idx").on(t.projectId, t.createdAt)]);
export const releaseArtifacts = sqliteTable("release_artifacts", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id),
  versionId: text("version_id").references(() => fileVersions.id), status: text("status").notNull().default("private"),
  releaseAt: text("release_at").notNull(), timeZone: text("time_zone").notNull(),
  autoReleaseConsent: integer("auto_release_consent").notNull().default(0), salesEnabled: integer("sales_enabled").notNull().default(0),
}, (t) => [uniqueIndex("artifact_project_unique").on(t.projectId)]);
export const usageLimits = sqliteTable("usage_limits", {
  key: text("key").primaryKey(), value: integer("value").notNull().default(0),
}, (t) => [check("usage_nonnegative", sql`${t.value} >= 0`)]);
