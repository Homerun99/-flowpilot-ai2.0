import {
  pgTable,
  text,
  varchar,
  integer,
  timestamp,
  json,
  boolean,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ── Enums ────────────────────────────────────────────────────────────────

export const aiEmployeeTypeEnum = pgEnum("ai_employee_type", [
  "email-agent",
  "invoice-clerk",
  "scheduler",
]);

export const leadStatusEnum = pgEnum("lead_status", [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "sent",
  "paid",
  "overdue",
  "cancelled",
]);

// ── Tables ───────────────────────────────────────────────────────────────

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  fromName: varchar("from_name", { length: 255 }),
  fromEmail: varchar("from_email", { length: 255 }),
  replyTo: varchar("reply_to", { length: 255 }),
  sendgridDomainId: varchar("sendgrid_domain_id", { length: 255 }),
  sendgridDomain: varchar("sendgrid_domain", { length: 255 }),
  sendgridSubdomain: varchar("sendgrid_subdomain", { length: 255 }),
  sendgridDnsRecords: json("sendgrid_dns_records").$type<SendgridDnsRecord[]>(),
  paymentLink: text("payment_link"),
  receptionistConfig: json("receptionist_config").$type<ReceptionistConfig>(),
  twilioPhone: varchar("twilio_phone", { length: 20 }),
  twilioPhoneSid: varchar("twilio_phone_sid", { length: 64 }),
  twilioTransferNumber: varchar("twilio_transfer_number", { length: 40 }),
  phoneMode: varchar("phone_mode", { length: 20 }).default("none"),
  // IANA timezone for the business's wall clock (e.g. "America/Phoenix").
  // All receptionist booking math resolves slots in this zone; null/"UTC"
  // fall back to UTC. Set explicitly per workspace — never rely on server tz.
  timezone: varchar("timezone", { length: 64 }).default("UTC"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export interface ReceptionistConfig {
  businessName?: string;
  businessType?: string;
  businessHours?: string;
  description?: string;
  customInstructions?: string;
  /** When true, Nova must capture the caller's service address before booking. */
  requireAddress?: boolean;
  /** Structured open days — full day names, e.g. ["Monday","Tuesday"]. When set with openHours, drives availability instead of parsing businessHours free text. */
  openDays?: string[];
  /** Structured open hours — 24h "HH:MM", e.g. { start: "10:00", end: "17:00" }. null explicitly clears. */
  openHours?: { start: string; end: string } | null;
  /** Minimum gap (minutes) Nova must leave between consecutive appointments. null/absent = disabled (no spacer). */
  appointmentSpacer?: number | null;
  /** Conditional qualification rules — IF the caller's situation matches a condition, Nova asks that block's Then-ask questions one at a time. null/absent = disabled. */
  keyQuestions?: { if: string; thenAsk: string[] }[] | null;
  /** ISO timestamp when the workspace owner accepted the Terms of Service. null/absent = not yet accepted. */
  termsAcceptedAt?: string | null;
}

/** Max IF blocks in the key-questions config (prompt safety). */
export const MAX_KEY_QUESTION_BLOCKS = 20;
/** Max Then-ask questions per IF block (prompt safety). */
export const MAX_KEY_QUESTIONS_PER_BLOCK = 20;
/** Cap on the injected key-questions prompt text length (chars). */
export const KEY_QUESTION_PROMPT_CHAR_LIMIT = 1500;

export interface SendgridDnsRecord {
  type: string;
  host: string;
  data: string;
  validated: boolean;
}

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  role: varchar("role", { length: 50 }).notNull().default("member"),
  passwordHash: varchar("password_hash", { length: 255 }),
  googleId: varchar("google_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const leads = pgTable("leads", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  source: varchar("source", { length: 50 }),
  status: leadStatusEnum("status").notNull().default("new"),
  score: integer("score").default(0),
  notes: text("notes"),
  summary: text("summary"),
  qa: json("qa").$type<{ question: string; answer: string }[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const aiEmployees = pgTable("ai_employees", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  name: varchar("name", { length: 255 }).notNull(),
  type: aiEmployeeTypeEnum("type").notNull(),
  status: varchar("status", { length: 50 }).notNull().default("active"),
  config: json("config").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const automations = pgTable("automations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  aiEmployeeId: text("ai_employee_id").references(() => aiEmployees.id),
  name: varchar("name", { length: 255 }).notNull(),
  triggerType: varchar("trigger_type", { length: 50 }).notNull(),
  actionType: varchar("action_type", { length: 50 }).notNull(),
  config: json("config").$type<Record<string, unknown>>(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const automationRuns = pgTable("automation_runs", {
  id: text("id").primaryKey(),
  automationId: text("automation_id")
    .notNull()
    .references(() => automations.id),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  input: json("input").$type<Record<string, unknown>>(),
  output: json("output").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  customerEmail: varchar("customer_email", { length: 255 }),
  amountCents: integer("amount_cents").notNull(),
  status: invoiceStatusEnum("status").notNull().default("draft"),
  dueDate: timestamp("due_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const appointments = pgTable("appointments", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  leadId: text("lead_id").references(() => leads.id),
  title: varchar("title", { length: 255 }).notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  status: varchar("status", { length: 50 }).notNull().default("scheduled"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const proposals = pgTable("proposals", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  leadId: text("lead_id").references(() => leads.id),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content"),
  status: varchar("status", { length: 50 }).notNull().default("draft"),
  totalAmount: integer("total_amount"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const activityLog = pgTable("activity_log", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  type: varchar("type", { length: 100 }).notNull(),
  description: text("description"),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  filename: varchar("filename", { length: 512 }).notNull(),
  fileType: varchar("file_type", { length: 100 }).notNull(),
  fileSize: integer("file_size").notNull(),
  content: text("content"),
  metadata: json("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Call log ───────────────────────────────────────────────────────────────

/**
 * Every phone call through the AI receptionist, upserted by (workspaceId, callSid)
 * on every webhook event. outcome tracks what the call produced:
 * 'incomplete' | 'lead_captured' | 'appointment_booked' | 'transferred' | 'message_taken' | 'completed'
 *
 * NOTE: indexes are declared table-level (pgTable's 3rd arg) — top-level
 * `export const idx = index().on(...)` declarations crash drizzle-kit 0.31's
 * schema parser (JSON.parse(undefined) in IndexBuilderOn.on).
 */
export const calls = pgTable(
  "calls",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    callSid: varchar("call_sid", { length: 64 }).notNull(),
    callerNumber: varchar("caller_number", { length: 20 }),
    toNumber: varchar("to_number", { length: 20 }),
    status: varchar("status", { length: 20 }).notNull().default("ringing"),
    outcome: varchar("outcome", { length: 40 }).notNull().default("incomplete"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
    durationSec: integer("duration_sec"),
    leadId: text("lead_id").references(() => leads.id),
    appointmentId: text("appointment_id").references(() => appointments.id),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("calls_ws_callsid_idx").on(t.workspaceId, t.callSid),
    index("calls_ws_started_idx").on(t.workspaceId, t.startedAt),
  ],
);

// ── Type exports ─────────────────────────────────────────────────────────

export type Workspace = typeof workspaces.$inferSelect;
export type User = typeof users.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type AiEmployee = typeof aiEmployees.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type Proposal = typeof proposals.$inferSelect;
export type ActivityLog = typeof activityLog.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Call = typeof calls.$inferSelect;
