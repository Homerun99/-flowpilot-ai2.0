/**
 * Seed script — populates a demo workspace with sample data.
 *
 * Run: DATABASE_URL="postgres://..." bun run src/db/seed.ts
 */
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(url);
const db = drizzle(sql, { schema });

const now = new Date();
const DAY = 86_400_000;

async function seed() {
  console.log("🌱 Seeding demo data...\n");

  // ── Clean up any existing demo data ──
  await db.delete(schema.activityLog).where(eq(schema.activityLog.workspaceId, "ws_demo_001"));
  await db.delete(schema.leads).where(eq(schema.leads.workspaceId, "ws_demo_001"));
  await db.delete(schema.aiEmployees).where(eq(schema.aiEmployees.workspaceId, "ws_demo_001"));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, "ws_demo_001"));
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, "ws_demo_001"));
  console.log("  🧹 Cleaned up any previous demo data");

  // ── Workspace ──
  const [workspace] = await db
    .insert(schema.workspaces)
    .values({ id: "ws_demo_001", name: "Demo Workspace", createdAt: now })
    .returning();
  console.log(`  ✓ Workspace: ${workspace.name}`);

  // ── Users ──
  await db.insert(schema.users).values([
    { id: "usr_demo_admin", workspaceId: workspace.id, email: "admin@demo.com", name: "Alex Morgan", role: "admin", createdAt: now },
    { id: "usr_demo_member", workspaceId: workspace.id, email: "jamie@demo.com", name: "Jamie Chen", role: "member", createdAt: now },
  ]);
  console.log("  ✓ 2 users");

  // ── AI Employees ──
  const [emailAgent] = await db
    .insert(schema.aiEmployees)
    .values({
      id: "ai_email_001",
      workspaceId: workspace.id,
      name: "Sarah Sales",
      type: "email-agent",
      status: "active",
      config: { personality: "professional", temperature: 0.7, instructions: "You are a professional sales rep. Qualify leads and send follow-ups." },
      createdAt: now,
    })
    .returning();

  const [invoiceClerk] = await db
    .insert(schema.aiEmployees)
    .values({
      id: "ai_invoice_001",
      workspaceId: workspace.id,
      name: "Max Invoicing",
      type: "invoice-clerk",
      status: "active",
      config: { personality: "precise", temperature: 0.3, instructions: "You are a billing specialist. Generate invoices and track payments." },
      createdAt: now,
    })
    .returning();

  const [scheduler] = await db
    .insert(schema.aiEmployees)
    .values({
      id: "ai_sched_001",
      workspaceId: workspace.id,
      name: "Olivia Calendar",
      type: "scheduler",
      status: "active",
      config: { personality: "friendly", temperature: 0.5, instructions: "You are a scheduling assistant. Book appointments and manage calendars." },
      createdAt: now,
    })
    .returning();
  console.log(`  ✓ 3 AI employees (email-agent, invoice-clerk, scheduler)`);

  // ── Leads ──
  const [lead1] = await db
    .insert(schema.leads)
    .values({
      id: "lead_001",
      workspaceId: workspace.id,
      name: "Sarah Johnson",
      email: "sarah@abcrealty.com",
      phone: "(310) 555-0101",
      source: "website",
      status: "new",
      score: 85,
      notes: "Interested in AI email agent. Requested demo.",
      createdAt: now,
    })
    .returning();

  await db.insert(schema.leads).values([
    {
      id: "lead_002",
      workspaceId: workspace.id,
      name: "Mike Torres",
      email: "mike@rooftech.com",
      phone: "(512) 555-0202",
      source: "referral",
      status: "contacted",
      score: 72,
      notes: "Referred by existing customer. Needs roofing estimate automation.",
      createdAt: new Date(now.getTime() - 1 * DAY),
    },
    {
      id: "lead_003",
      workspaceId: workspace.id,
      name: "Priya Sharma",
      email: "priya@greenleafmed.com",
      phone: "(206) 555-0303",
      source: "website",
      status: "qualified",
      score: 92,
      notes: "Medical office — interested in phone receptionist and scheduling.",
      createdAt: new Date(now.getTime() - 2 * DAY),
    },
    {
      id: "lead_004",
      workspaceId: workspace.id,
      name: "Derek Johnston",
      email: "derek@johnstonroofing.com",
      phone: "(303) 555-0404",
      source: "email",
      status: "proposal",
      score: 78,
      notes: "Sent Scale plan proposal. Follow up in 3 days.",
      createdAt: new Date(now.getTime() - 3 * DAY),
    },
    {
      id: "lead_005",
      workspaceId: workspace.id,
      name: "Emily Rodriguez",
      email: "emily@primehvac.com",
      phone: "(210) 555-0505",
      source: "referral",
      status: "won",
      score: 95,
      notes: "Closed deal. Onboarding scheduled for next week.",
      createdAt: new Date(now.getTime() - 5 * DAY),
    },
    {
      id: "lead_006",
      workspaceId: workspace.id,
      name: "Tom Wilson",
      email: "tom@wilsonmed.com",
      phone: "(602) 555-0606",
      source: "website",
      status: "lost",
      score: 35,
      notes: "Went with competitor. Price was main concern.",
      createdAt: new Date(now.getTime() - 7 * DAY),
    },
  ]);
  console.log("  ✓ 6 leads (all statuses)");

  // ── Activity Log ──
  await db.insert(schema.activityLog).values([
    {
      id: "act_001",
      workspaceId: workspace.id,
      type: "lead_created",
      description: `New lead: ${lead1.name}`,
      metadata: { leadId: lead1.id, source: "website" },
      createdAt: new Date(now.getTime() - 2 * DAY),
    },
    {
      id: "act_002",
      workspaceId: workspace.id,
      type: "automation_run",
      description: "Email follow-up sent to Sarah Johnson",
      metadata: { leadId: lead1.id, automation: "new_lead_followup" },
      createdAt: new Date(now.getTime() - 1 * DAY),
    },
    {
      id: "act_003",
      workspaceId: workspace.id,
      type: "ai_employee_created",
      description: "Sarah Sales (email-agent) activated",
      metadata: { aiEmployeeId: emailAgent.id },
      createdAt: new Date(now.getTime() - 3 * DAY),
    },
    {
      id: "act_004",
      workspaceId: workspace.id,
      type: "lead_qualified",
      description: "Priya Sharma qualified — score 92",
      metadata: { leadId: "lead_003", score: 92 },
      createdAt: new Date(now.getTime() - 12 * 3600_000),
    },
  ]);
  console.log("  ✓ 4 activity log entries");

  console.log("\n✅ Demo data seeded!");
  console.log("   Workspace: Demo Workspace | 2 users | 3 AI employees | 6 leads");
}

seed()
  .catch((e) => {
    console.error("\n❌ Seed failed:", e.message);
    if (e.cause) console.error("  cause:", e.cause);
    if (e.code) console.error("  code:", e.code);
    if (e.detail) console.error("  detail:", e.detail);
    process.exit(1);
  })
  .finally(() => process.exit(0));
