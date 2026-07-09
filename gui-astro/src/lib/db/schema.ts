import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// helper: SQLite vremenski epoch u ms (text ISO čuvamo zb čitljivosti)
const now = () => sql`(unixepoch() * 1000)`;

// ------------------------------------------------------------------
// users — single-user auth
// ------------------------------------------------------------------
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now()),
});

// ------------------------------------------------------------------
// statuses — pipeline statusi
// ------------------------------------------------------------------
export const statuses = sqliteTable("statuses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6b7280"),
  isTerminalWon: integer("is_terminal_won", { mode: "boolean" }).notNull().default(false),
  isTerminalLost: integer("is_terminal_lost", { mode: "boolean" }).notNull().default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  systemDefault: integer("system_default", { mode: "boolean" }).notNull().default(false),
});

// ------------------------------------------------------------------
// campaigns
// ------------------------------------------------------------------
export const campaigns = sqliteTable("campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category"),
  city: text("city"),
  promptTemplateId: integer("prompt_template_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now()),
});

// ------------------------------------------------------------------
// leads
// ------------------------------------------------------------------
export const leads = sqliteTable(
  "leads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category"),
    phoneRaw: text("phone_raw"),
    phoneE164: text("phone_e164"),
    email: text("email"),
    websiteRaw: text("website_raw"),
    websiteNormalized: text("website_normalized"),
    address: text("address"),
    city: text("city"),
    postalCode: text("postal_code"),
    googleRating: real("google_rating"),
    reviewsCount: integer("reviews_count"),
    source: text("source"),
    sourceUrl: text("source_url"),
    lat: real("lat"),
    lng: real("lng"),
    statusId: integer("status_id").references(() => statuses.id),
    doNotContact: integer("do_not_contact", { mode: "boolean" }).notNull().default(false),
    dedupKey: text("dedup_key").notNull(),
    importedAt: integer("imported_at", { mode: "timestamp_ms" }).default(now()),
    importBatchId: text("import_batch_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(now()),
  },
  (t) => ({
    dedupIdx: uniqueIndex("leads_dedup_key_uq").on(t.dedupKey),
    campaignIdx: index("leads_campaign_id_idx").on(t.campaignId),
    statusIdx: index("leads_status_id_idx").on(t.statusId),
    emailIdx: index("leads_email_idx").on(t.email),
    websiteIdx: index("leads_website_idx").on(t.websiteNormalized),
  }),
);

// ------------------------------------------------------------------
// comments
// ------------------------------------------------------------------
export const comments = sqliteTable("comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now()),
});

// ------------------------------------------------------------------
// site_scrapes
// ------------------------------------------------------------------
export const siteScrapes = sqliteTable("site_scrapes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  domain: text("domain"),
  sitemapUrl: text("sitemap_url"),
  totalPagesDiscovered: integer("total_pages_discovered").notNull().default(0),
  pagesScraped: integer("pages_scraped").notNull().default(0),
  status: text("status").notNull().default("pending"), // pending|running|done|error
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  error: text("error"),
});

// ------------------------------------------------------------------
// site_pages
// ------------------------------------------------------------------
export const sitePages = sqliteTable("site_pages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scrapeId: integer("scrape_id")
    .notNull()
    .references(() => siteScrapes.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  category: text("category"), // Home|Pages|Categories|Products|Posts|Portfolio|Other
  title: text("title"),
  metaDescription: text("meta_description"),
  h1: text("h1"),
  wordCount: integer("word_count").notNull().default(0),
  readingTime: integer("reading_time").notNull().default(0),
  seoMetricsJson: text("seo_metrics_json"), // JSON blob
  bodySummary: text("body_summary"),
  statusCode: integer("status_code"),
  fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).default(now()),
});

// ------------------------------------------------------------------
// screenshots
// ------------------------------------------------------------------
export const screenshots = sqliteTable("screenshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  capturedAt: integer("captured_at", { mode: "timestamp_ms" }).default(now()),
});

// ------------------------------------------------------------------
// site_analysis — M3 vizuelna + SEO ocena
// ------------------------------------------------------------------
export const siteAnalysis = sqliteTable("site_analysis", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  scrapeId: integer("scrape_id").references(() => siteScrapes.id, { onDelete: "set null" }),
  visualScore: integer("visual_score"), // 1–10
  visualNotes: text("visual_notes"), // JSON array string
  seoScore: integer("seo_score"), // 1–10
  totalPages: integer("total_pages").notNull().default(0),
  totalWords: integer("total_words").notNull().default(0),
  overallScore: real("overall_score"),
  issuesJson: text("issues_json"),
  aiSummary: text("ai_summary"),
  analyzedAt: integer("analyzed_at", { mode: "timestamp_ms" }).default(now()),
});

// ------------------------------------------------------------------
// prompt_templates
// ------------------------------------------------------------------
export const promptTemplates = sqliteTable("prompt_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // email_personalization | score | seo_summary | assistant
  type: text("type").notNull(),
  body: text("body").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  campaignId: integer("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(now()),
});

// ------------------------------------------------------------------
// senders
// ------------------------------------------------------------------
export const senders = sqliteTable("senders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  fromName: text("from_name").notNull(),
  smtpHost: text("smtp_host").notNull(),
  smtpPort: integer("smtp_port").notNull(),
  username: text("username").notNull(),
  passwordEncrypted: text("password_encrypted").notNull(),
  dailyCap: integer("daily_cap").notNull().default(50),
  hourlyCap: integer("hourly_cap").notNull().default(10),
  minDelaySec: integer("min_delay_sec").notNull().default(30),
  maxDelaySec: integer("max_delay_sec").notNull().default(120),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
});

// ------------------------------------------------------------------
// sequences
// ------------------------------------------------------------------
export const sequences = sqliteTable("sequences", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now()),
});

// ------------------------------------------------------------------
// sequence_steps
// ------------------------------------------------------------------
export const sequenceSteps = sqliteTable("sequence_steps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sequenceId: integer("sequence_id")
    .notNull()
    .references(() => sequences.id, { onDelete: "cascade" }),
  stepNumber: integer("step_number").notNull(),
  promptTemplateId: integer("prompt_template_id").references(() => promptTemplates.id, {
    onDelete: "set null",
  }),
  delayDays: integer("delay_days").notNull().default(0),
  sendWindowOnly: integer("send_window_only", { mode: "boolean" }).notNull().default(true),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

// ------------------------------------------------------------------
// email_sends
// ------------------------------------------------------------------
export const emailSends = sqliteTable("email_sends", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  senderId: integer("sender_id").references(() => senders.id, { onDelete: "set null" }),
  sequenceStepId: integer("sequence_step_id").references(() => sequenceSteps.id, {
    onDelete: "set null",
  }),
  promptTemplateId: integer("prompt_template_id").references(() => promptTemplates.id, {
    onDelete: "set null",
  }),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  // draft|queued|sending|sent|failed|bounced
  status: text("status").notNull().default("draft"),
  generatedByAi: integer("generated_by_ai", { mode: "boolean" }).notNull().default(false),
  reviewed: integer("reviewed", { mode: "boolean" }).notNull().default(false),
  queuedAt: integer("queued_at", { mode: "timestamp_ms" }),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  messageId: text("message_id"),
  error: text("error"),
  openedCount: integer("opened_count").notNull().default(0),
  openedFirstAt: integer("opened_first_at", { mode: "timestamp_ms" }),
  clickedCount: integer("clicked_count").notNull().default(0),
  replied: integer("replied", { mode: "boolean" }).notNull().default(false),
  repliedAt: integer("replied_at", { mode: "timestamp_ms" }),
});

// ------------------------------------------------------------------
// email_replies
// ------------------------------------------------------------------
export const emailReplies = sqliteTable("email_replies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  emailSendId: integer("email_send_id").references(() => emailSends.id, {
    onDelete: "set null",
  }),
  fromEmail: text("from_email").notNull(),
  subject: text("subject"),
  body: text("body"),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
  matchedBy: text("matched_by"), // thread|alias|sender
});

// ------------------------------------------------------------------
// blocklist
// ------------------------------------------------------------------
export const blocklist = sqliteTable("blocklist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  reason: text("reason"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now()),
});

// ------------------------------------------------------------------
// ai_chats
// ------------------------------------------------------------------
export const aiChats = sqliteTable("ai_chats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messagesJson: text("messages_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now()),
});

// ------------------------------------------------------------------
// settings — key/value
// ------------------------------------------------------------------
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});

// ------------------------------------------------------------------
// Tipovi (export)
// ------------------------------------------------------------------
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type Status = typeof statuses.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type SiteScrape = typeof siteScrapes.$inferSelect;
export type SitePage = typeof sitePages.$inferSelect;
export type Screenshot = typeof screenshots.$inferSelect;
export type SiteAnalysis = typeof siteAnalysis.$inferSelect;
export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type Sender = typeof senders.$inferSelect;
export type Sequence = typeof sequences.$inferSelect;
export type SequenceStep = typeof sequenceSteps.$inferSelect;
export type EmailSend = typeof emailSends.$inferSelect;
export type EmailReply = typeof emailReplies.$inferSelect;
export type BlocklistEntry = typeof blocklist.$inferSelect;
export type AiChat = typeof aiChats.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type User = typeof users.$inferSelect;
