// API handler for the FlowPilot AI server — handles all /api/* routes directly
// Imported by serve.ts to bypass TanStack's API routing (incompatible with custom server)

import { db } from "./src/db/index";
import {
  leads,
  invoices,
  appointments,
  proposals,
  automations,
  automationRuns,
  aiEmployees,
  activityLog,
  documents,
  workspaces,
  users,
  calls,
  emails,
  MAX_KEY_QUESTION_BLOCKS,
  MAX_KEY_QUESTIONS_PER_BLOCK,
} from "./src/db/schema";
import { eq, desc, and, like, or, sql } from "drizzle-orm";
import {
  scoreLead,
  processLeadReply,
  generateInvoice,
  detectSchedulingIntent,
  generateProposal,
  searchKnowledgeBase,
  summarizeEmail,
  type EmployeeConfig,
} from "./src/lib/ai-employees";
import { sendEmail } from "./src/lib/email";
import { hashPassword, verifyPassword } from "./src/lib/auth/password";
import {
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  getSessionCookie,
  verifySessionToken,
} from "./src/lib/auth/jwt";
import { getSession, DEMO_WORKSPACE } from "./src/lib/auth/session";
import { startDomainVerification, checkDomainVerification } from "./src/lib/sendgrid";
import { fireAutomationTrigger } from "./src/lib/automation-trigger";
import { twilioConfigured, provisionForWorkspace } from "./src/lib/twilio-provision";

export async function handleApiRequest(
  pathname: string,
  method: string,
  request: Request
): Promise<Response | null> {
  const url = new URL(request.url);

  try {
    // Resolve workspace from JWT session (falls back to demo)
    const session = await getSession(request);
    const workspaceId = session.workspaceId;

    // ════════════════════════════════════════════════════════════
    // Auth Routes
    // ════════════════════════════════════════════════════════════

    // ── POST /api/auth/signup ────────────────────────────────────
    if (pathname === "/api/auth/signup" && method === "POST") {
      const body = await request.json() as {
        email?: string; password?: string; name?: string; workspaceId?: string;
      };
      if (!body.email || !body.password || !body.name) {
        return new Response(JSON.stringify({ error: "email, password, and name are required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      // Only block duplicate signups for the admin email
      // Non-admin emails get a fresh account (old record is purged)
      const email = body.email.toLowerCase().trim();
      if (email === "connorj.elsasser@gmail.com") {
        const existing = await db.query.users.findFirst({
          where: eq(users.email, email),
        });
        if (existing) {
          return new Response(JSON.stringify({ error: "Email already registered" }), {
            status: 409, headers: { "Content-Type": "application/json" },
          });
        }
      } else {
        // Purge any existing record for this email so re-signup works
        await db.delete(users).where(eq(users.email, email));
      }

      // Create or lookup workspace
      const workspaceId = body.workspaceId || crypto.randomUUID();
      let workspaceExists = false;
      if (body.workspaceId) {
        const existing = await db.query.workspaces.findFirst({
          where: eq(workspaces.id, workspaceId),
        });
        workspaceExists = !!existing;
      }
      if (!workspaceExists) {
        const wsName = `${body.name}'s Workspace`;
        // Generate a branded sender address: slug@flowpilot.ai
        // Use just the user's name (strip "'s Workspace" suffix from default naming)
        const rawName = wsName.replace(/'s\s+workspace$/i, "").replace(/\s+workspace$/i, "");
        const wsSlug = rawName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .substring(0, 40) || "workspace";
        const brandedEmail = `${wsSlug}@klerkitai.com`;
        await db.insert(workspaces).values({
          id: workspaceId,
          name: wsName,
          fromName: wsName,
          fromEmail: brandedEmail,
          createdAt: new Date(),
        });

        // Auto-seed AI employees + default automations for new workspace
        const now = new Date();
        const aiDefs = [
          { name: "Sarah Sales", type: "email-agent" as const, config: { personality: "professional", temperature: 0.7, instructions: "You are a professional sales rep. Qualify leads and send follow-ups." } },
          { name: "Max Invoicing", type: "invoice-clerk" as const, config: { personality: "precise", temperature: 0.3, instructions: "You are a billing specialist. Generate invoices and track payments." } },
          { name: "Olivia Calendar", type: "scheduler" as const, config: { personality: "friendly", temperature: 0.5, instructions: "You are a scheduling assistant. Book appointments and manage calendars." } },
        ];
        const aiIds: Record<string, string> = {};
        for (const def of aiDefs) {
          const aiId = crypto.randomUUID();
          await db.insert(aiEmployees).values({
            id: aiId, workspaceId, name: def.name, type: def.type,
            status: "active", config: def.config, createdAt: now,
          });
          aiIds[def.type] = aiId;
        }
        const autoDefs = [
          { name: "Score new leads", triggerType: "new_lead", actionType: "score_lead", aiType: "email-agent" },
          { name: "Reply to new emails", triggerType: "new_email", actionType: "generate_reply", aiType: "email-agent" },
          { name: "Invoice on request", triggerType: "invoice_request", actionType: "generate_invoice", aiType: "invoice-clerk" },
        ];
        for (const def of autoDefs) {
          await db.insert(automations).values({
            id: crypto.randomUUID(), workspaceId, name: def.name,
            aiEmployeeId: aiIds[def.aiType], triggerType: def.triggerType,
            actionType: def.actionType, config: {}, enabled: true, createdAt: now,
          });
        }
        await db.insert(activityLog).values({
          id: crypto.randomUUID(), workspaceId, type: "workspace_seeded",
          description: "Default AI employees and automations created",
          metadata: { workspaceId }, createdAt: now,
        });
      }

      const userId = crypto.randomUUID();
      const passwordHash = await hashPassword(body.password);

      const isOwner = body.email.toLowerCase().trim() === "connorj.elsasser@gmail.com";
      await db.insert(users).values({
        id: userId,
        workspaceId,
        email: body.email.toLowerCase().trim(),
        name: body.name,
        role: isOwner ? "admin" : "member",
        passwordHash,
        googleId: null,
        createdAt: new Date(),
      });

      const token = await createSessionToken({
        userId,
        workspaceId,
        email: body.email.toLowerCase().trim(),
      });

      const headers = new Headers({ "Content-Type": "application/json" });
      setSessionCookie(headers, token);

      return new Response(JSON.stringify({
        success: true,
        user: { id: userId, email: body.email, name: body.name, workspaceId },
      }), { status: 201, headers });
    }

    // ── POST /api/auth/signin ────────────────────────────────────
    if (pathname === "/api/auth/signin" && method === "POST") {
      const body = await request.json() as { email?: string; password?: string };
      if (!body.email || !body.password) {
        return new Response(JSON.stringify({ error: "email and password are required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      const user = await db.query.users.findFirst({
        where: eq(users.email, body.email.toLowerCase().trim()),
        columns: { id: true, email: true, name: true, workspaceId: true, passwordHash: true, role: true },
      });

      if (!user || !user.passwordHash) {
        return new Response(JSON.stringify({ error: "Invalid email or password" }), {
          status: 401, headers: { "Content-Type": "application/json" },
        });
      }

      const valid = await verifyPassword(body.password, user.passwordHash);
      if (!valid) {
        return new Response(JSON.stringify({ error: "Invalid email or password" }), {
          status: 401, headers: { "Content-Type": "application/json" },
        });
      }

      const token = await createSessionToken({
        userId: user.id,
        workspaceId: user.workspaceId,
        email: user.email,
      });

      const headers = new Headers({ "Content-Type": "application/json" });
      setSessionCookie(headers, token);

      return new Response(JSON.stringify({
        success: true,
        user: { id: user.id, email: user.email, name: user.name, workspaceId: user.workspaceId, role: user.role },
      }), { headers });
    }

    // ── POST /api/auth/signout ───────────────────────────────────
    if (pathname === "/api/auth/signout" && method === "POST") {
      const headers = new Headers({ "Content-Type": "application/json" });
      clearSessionCookie(headers);
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    // ── GET /api/auth/session ────────────────────────────────────
    if (pathname === "/api/auth/session" && method === "GET") {
      const session = await getSession(request);
      if (session.isDemo) {
        return new Response(JSON.stringify({ user: null, isDemo: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      const user = await db.query.users.findFirst({
        where: eq(users.id, session.userId!),
        columns: { id: true, email: true, name: true, workspaceId: true, role: true },
      });
      return new Response(JSON.stringify({ user, isDemo: false }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── GET /api/auth/google ─────────────────────────────────────
    if (pathname === "/api/auth/google" && method === "GET") {
      const redirectUri = `${new URL(request.url).origin}/api/auth/google/callback`;
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) {
        return new Response(JSON.stringify({ error: "Google OAuth not configured" }), {
          status: 501, headers: { "Content-Type": "application/json" },
        });
      }
      const scope = "openid email profile";
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&prompt=select_account`;
      return new Response(null, {
        status: 302,
        headers: { Location: authUrl },
      });
    }

    // ── GET /api/auth/google/callback ────────────────────────────
    if (pathname === "/api/auth/google/callback" && method === "GET") {
      const code = url.searchParams.get("code");
      if (!code) {
        return new Response(JSON.stringify({ error: "Missing authorization code" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return new Response(JSON.stringify({ error: "Google OAuth not configured" }), {
          status: 501, headers: { "Content-Type": "application/json" },
        });
      }

      const redirectUri = `${new URL(request.url).origin}/api/auth/google/callback`;

      // Exchange code for tokens
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
      if (!tokenData.access_token) {
        return new Response(JSON.stringify({ error: tokenData.error || "Failed to exchange code" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      // Get user info
      const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const googleProfile = await userRes.json() as {
        id?: string; email?: string; name?: string; verified_email?: boolean;
      };

      if (!googleProfile.id || !googleProfile.email) {
        return new Response(JSON.stringify({ error: "Failed to get Google profile" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      // Find or create user by googleId
      let user = await db.query.users.findFirst({
        where: eq(users.googleId, googleProfile.id),
        columns: { id: true, email: true, name: true, workspaceId: true, role: true },
      });

      if (!user) {
        // Check if email is already registered
        const existingEmail = await db.query.users.findFirst({
          where: eq(users.email, googleProfile.email.toLowerCase()),
          columns: { id: true, email: true, name: true, workspaceId: true, role: true },
        });
        if (existingEmail) {
          // Link Google to existing account
          await db.update(users)
            .set({ googleId: googleProfile.id })
            .where(eq(users.id, existingEmail.id));
          user = existingEmail;
        } else {
          // Create new user + workspace
          const workspaceId = crypto.randomUUID();
          await db.insert(workspaces).values({
            id: workspaceId,
            name: `${googleProfile.name || googleProfile.email}'s Workspace`,
            createdAt: new Date(),
          });
          const userId = crypto.randomUUID();
          const isOwner = googleProfile.email.toLowerCase() === "connorj.elsasser@gmail.com";
          await db.insert(users).values({
            id: userId,
            workspaceId,
            email: googleProfile.email.toLowerCase(),
            name: googleProfile.name || null,
            role: isOwner ? "admin" : "member",
            googleId: googleProfile.id,
            createdAt: new Date(),
          });
          user = { id: userId, email: googleProfile.email, name: googleProfile.name || null, workspaceId, role: isOwner ? "admin" : "member" };
        }
      }

      const token = await createSessionToken({
        userId: user.id,
        workspaceId: user.workspaceId,
        email: user.email,
      });

      const headers = new Headers();
      setSessionCookie(headers, token);
      headers.set("Location", "/dashboard");

      return new Response(null, { status: 302, headers });
    }

    // ── GET /api/leads ──────────────────────────────────────────
    if (pathname === "/api/leads" && method === "GET") {
      const status = url.searchParams.get("status");
      const search = url.searchParams.get("search");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
      const offset = parseInt(url.searchParams.get("offset") || "0");

      const result = await db.query.leads.findMany({
        where: (leads, { and, like, or, eq }) => {
          const conditions = [eq(leads.workspaceId, workspaceId)];
          if (status) conditions.push(eq(leads.status, status));
          if (search) {
            conditions.push(
              or(
                like(leads.name, `%${search}%`),
                like(leads.email, `%${search}%`)
              )!
            );
          }
          return and(...conditions);
        },
        orderBy: desc(leads.createdAt),
        limit,
        offset,
      });

      return new Response(JSON.stringify({ leads: result }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── POST /api/leads ─────────────────────────────────────────
    if (pathname === "/api/leads" && method === "POST") {
      const body = await request.json() as {
        name?: string;
        email?: string;
        phone?: string;
        source?: string;
        notes?: string;
      };

      if (!body.name) {
        return new Response(JSON.stringify({ error: "name is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const id = crypto.randomUUID();
      const now = new Date();

      await db.insert(leads).values({
        id,
        workspaceId: workspaceId,
        name: body.name,
        email: body.email || null,
        phone: body.phone || null,
        source: body.source || null,
        notes: body.notes || null,
        status: "new",
        score: 0,
        createdAt: now,
        updatedAt: now,
      });

      const created = await db.query.leads.findFirst({
        where: eq(leads.id, id),
      });

      // Fire automations for new lead via sandbox (non-blocking)
      const sandboxPayload = { name: body.name, source: body.source, message: body.notes || "" };
      db.query.automations.findMany({
        where: and(
          eq(automations.workspaceId, workspaceId),
          eq(automations.triggerType, "new_lead"),
          eq(automations.enabled, true)
        ),
      }).then(async (matching) => {
        for (const auto of matching) {
          try {
            const emp = await db.query.aiEmployees.findFirst({
              where: eq(aiEmployees.id, auto.aiEmployeeId),
            });
            const employeeConfig = emp?.config as Record<string, unknown> | undefined;
            const runId = crypto.randomUUID();
            if (auto.actionType === "score_lead") {
              const result = await scoreLead(
                { name: body.name || "", source: body.source, message: body.notes || "" },
                workspaceId,
                employeeConfig as Parameters<typeof scoreLead>[2]
              );
              await db.update(leads).set({ score: result.score, updatedAt: new Date() }).where(eq(leads.id, id));
              await db.insert(automationRuns).values({
                id: runId, automationId: auto.id, workspaceId: workspaceId,
                status: "completed", input: sandboxPayload, output: result as Record<string, unknown>,
                durationMs: 0, createdAt: new Date(),
              });
            }
          } catch (err) { console.error("Sandbox lead automation failed:", err); }
        }
      }).catch((err) => console.error("Sandbox trigger failed:", err));

      return new Response(JSON.stringify({ lead: created }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── GET /api/stats ──────────────────────────────────────────
    if (pathname === "/api/stats" && method === "GET") {
      const [totalLeads, totalInvoices, totalAppointments, totalAutomations, totalRuns, leadsByStatus, totalCalls, callsToday] =
        await Promise.all([
          db.select({ count: sql<number>`count(*)::int` }).from(leads).where(eq(leads.workspaceId, workspaceId)).then((r) => r[0]?.count ?? 0),
          db.select({ count: sql<number>`count(*)::int` }).from(invoices).where(eq(invoices.workspaceId, workspaceId)).then((r) => r[0]?.count ?? 0),
          db.select({ count: sql<number>`count(*)::int` }).from(appointments).where(eq(appointments.workspaceId, workspaceId)).then((r) => r[0]?.count ?? 0),
          db.select({ count: sql<number>`count(*)::int` }).from(automations).where(eq(automations.workspaceId, workspaceId)).then((r) => r[0]?.count ?? 0),
          db.select({ count: sql<number>`count(*)::int` }).from(automationRuns).where(eq(automationRuns.workspaceId, workspaceId)).then((r) => r[0]?.count ?? 0),
          db.select({ status: sql<string>`${leads.status}`, count: sql<number>`count(*)::int` }).from(leads).where(eq(leads.workspaceId, workspaceId)).groupBy(leads.status),
          db.select({ count: sql<number>`count(*)::int` }).from(calls).where(eq(calls.workspaceId, workspaceId)).then((r) => r[0]?.count ?? 0),
          db.select({ count: sql<number>`count(*)::int` }).from(calls).where(and(eq(calls.workspaceId, workspaceId), sql`${calls.startedAt} >= date_trunc('day', now())`)).then((r) => r[0]?.count ?? 0),
        ]);

      return new Response(
        JSON.stringify({
          stats: {
            totalLeads,
            totalInvoices,
            totalAppointments,
            totalAutomations,
            totalAutomationRuns: totalRuns,
            totalCalls,
            callsToday,
            leadsByStatus: Object.fromEntries(leadsByStatus.map((r) => [r.status, r.count])),
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // ── GET /api/ai-employees ───────────────────────────────────
    if (pathname === "/api/ai-employees" && method === "GET") {
      const employees = await db.query.aiEmployees.findMany({
        where: eq(aiEmployees.workspaceId, workspaceId),
        orderBy: (cols, { desc }) => desc(cols.createdAt),
      });

      const enriched = await Promise.all(
        employees.map(async (emp) => {
          const runs = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(automationRuns)
            .where(eq(automationRuns.workspaceId, workspaceId))
            .then((r) => r[0]?.count ?? 0);

          return { ...emp, stats: { totalRuns: runs, successfulRuns: runs } };
        })
      );

      return new Response(JSON.stringify({ employees: enriched }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── GET /api/activity ───────────────────────────────────────
    if (pathname === "/api/activity" && method === "GET") {
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
      const offset = parseInt(url.searchParams.get("offset") || "0");

      const result = await db.query.activityLog.findMany({
        where: eq(activityLog.workspaceId, workspaceId),
        orderBy: desc(activityLog.createdAt),
        limit,
        offset,
      });

      return new Response(JSON.stringify({ activities: result }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── GET /api/automations ────────────────────────────────────
    if (pathname === "/api/automations" && method === "GET") {
      const result = await db.query.automations.findMany({
        where: eq(automations.workspaceId, workspaceId),
        orderBy: desc(automations.createdAt),
      });

      return new Response(JSON.stringify({ automations: result }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── POST /api/automations ───────────────────────────────────
    if (pathname === "/api/automations" && method === "POST") {
      const body = await request.json() as {
        name?: string;
        aiEmployeeId?: string;
        triggerType?: string;
        actionType?: string;
      };

      if (!body.name) {
        return new Response(JSON.stringify({ error: "name is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const id = crypto.randomUUID();
      const now = new Date();

      await db.insert(automations).values({
        id,
        workspaceId: workspaceId,
        name: body.name,
        aiEmployeeId: body.aiEmployeeId || null,
        triggerType: body.triggerType || null,
        actionType: body.actionType || null,
        config: {},
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });

      return new Response(JSON.stringify({ success: true, id }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── PUT /api/automations ───────────────────────────────────
    if (pathname === "/api/automations" && method === "PUT") {
      const body = await request.json() as {
        id?: string;
        name?: string;
        aiEmployeeId?: string;
        triggerType?: string;
        actionType?: string;
        enabled?: boolean;
      };

      if (!body.id) {
        return new Response(JSON.stringify({ error: "id is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.aiEmployeeId !== undefined) updates.aiEmployeeId = body.aiEmployeeId;
      if (body.triggerType !== undefined) updates.triggerType = body.triggerType;
      if (body.actionType !== undefined) updates.actionType = body.actionType;
      if (body.enabled !== undefined) updates.enabled = body.enabled;

      await db
        .update(automations)
        .set(updates)
        .where(and(eq(automations.id, body.id), eq(automations.workspaceId, workspaceId)));

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── DELETE /api/automations ─────────────────────────────────
    if (pathname === "/api/automations" && method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) {
        return new Response(JSON.stringify({ error: "id query param is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Verify automation belongs to workspace
      const existing = await db.query.automations.findFirst({
        where: (cols, { and }) =>
          and(eq(cols.id, id), eq(cols.workspaceId, workspaceId)),
      });
      if (!existing) {
        return new Response(JSON.stringify({ error: "Automation not found" }), {
          status: 404, headers: { "Content-Type": "application/json" },
        });
      }

      // Delete associated runs first (FK constraint)
      await db.delete(automationRuns).where(eq(automationRuns.automationId, id));
      await db
        .delete(automations)
        .where(and(eq(automations.id, id), eq(automations.workspaceId, workspaceId)));

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── POST /api/workspace/seed-automations ───────────────────────
    if (pathname === "/api/workspace/seed-automations" && method === "POST") {
      const body = await request.json() as { workspaceId?: string };
      const targetWs = body.workspaceId || workspaceId;
      const now = new Date();

      // 1. Create the 3 standard AI employees (idempotent — skip if exists)
      const aiDefs = [
        { suffix: "email", name: "Sarah Sales", type: "email-agent" as const, config: { personality: "professional", temperature: 0.7, instructions: "You are a professional sales rep. Qualify leads and send follow-ups." } },
        { suffix: "invoice", name: "Max Invoicing", type: "invoice-clerk" as const, config: { personality: "precise", temperature: 0.3, instructions: "You are a billing specialist. Generate invoices and track payments." } },
        { suffix: "sched", name: "Olivia Calendar", type: "scheduler" as const, config: { personality: "friendly", temperature: 0.5, instructions: "You are a scheduling assistant. Book appointments and manage calendars." } },
      ];

      const aiIds: Record<string, string> = {};

      for (const def of aiDefs) {
        const aiId = `ai_${def.suffix}_001`;
        const existing = await db.query.aiEmployees.findFirst({
          where: (cols, { and }) =>
            and(eq(cols.workspaceId, targetWs), eq(cols.type, def.type)),
        });
        if (!existing) {
          await db.insert(aiEmployees).values({
            id: aiId,
            workspaceId: targetWs,
            name: def.name,
            type: def.type,
            status: "active",
            config: def.config,
            createdAt: now,
          });
        }
        aiIds[def.type] = existing?.id || aiId;
      }

      // 2. Create the 3 default automations (idempotent by triggerType)
      const autoDefs = [
        { name: "Score new leads", triggerType: "new_lead", actionType: "score_lead", aiType: "email-agent" },
        { name: "Reply to new emails", triggerType: "new_email", actionType: "generate_reply", aiType: "email-agent" },
        { name: "Invoice on request", triggerType: "invoice_request", actionType: "generate_invoice", aiType: "invoice-clerk" },
      ];

      const created: string[] = [];

      for (const def of autoDefs) {
        const aiId = aiIds[def.aiType];
        const autoId = `auto_${def.triggerType}_001`;
        const existing = await db.query.automations.findFirst({
          where: (cols, { and }) =>
            and(eq(cols.workspaceId, targetWs), eq(cols.triggerType, def.triggerType)),
        });
        if (!existing) {
          await db.insert(automations).values({
            id: autoId,
            workspaceId: targetWs,
            name: def.name,
            aiEmployeeId: aiId,
            triggerType: def.triggerType,
            actionType: def.actionType,
            config: {},
            enabled: true,
            createdAt: now,
          });
          created.push(autoId);
        }
      }

      // Log activity
      await db.insert(activityLog).values({
        id: crypto.randomUUID(),
        workspaceId: targetWs,
        type: "automations_seeded",
        description: `Seeded ${created.length} default automations + AI employees`,
        metadata: { automationIds: created, workspaceId: targetWs },
        createdAt: now,
      });

      return new Response(JSON.stringify({ success: true, automationsCreated: created.length, ids: created }), {
        status: 201, headers: { "Content-Type": "application/json" },
      });
    }

    // ── GET /api/invoices ───────────────────────────────────────
    if (pathname === "/api/invoices" && method === "GET") {
      const status = url.searchParams.get("status");
      const result = await db.query.invoices.findMany({
        where: (invoices, { eq, and }) => {
          const conditions = [eq(invoices.workspaceId, workspaceId)];
          if (status) conditions.push(eq(invoices.status, status));
          return and(...conditions);
        },
        orderBy: desc(invoices.createdAt),
      });

      return new Response(JSON.stringify({ invoices: result }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── POST /api/invoices ──────────────────────────────────────
    if (pathname === "/api/invoices" && method === "POST") {
      const body = await request.json() as {
        customerName?: string;
        customerEmail?: string;
        amountCents?: number;
        dueDate?: string;
      };

      if (!body.customerName || !body.amountCents) {
        return new Response(JSON.stringify({ error: "customerName and amountCents are required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const id = crypto.randomUUID();
      const now = new Date();

      await db.insert(invoices).values({
        id,
        workspaceId: workspaceId,
        customerName: body.customerName,
        customerEmail: body.customerEmail || null,
        amountCents: body.amountCents,
        status: "pending",
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        createdAt: now,
        updatedAt: now,
      });

      return new Response(JSON.stringify({ success: true, id }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── GET /api/appointments ───────────────────────────────────
    if (pathname === "/api/appointments" && method === "GET") {
      const result = await db.query.appointments.findMany({
        where: eq(appointments.workspaceId, workspaceId),
        orderBy: desc(appointments.scheduledAt),
      });

      return new Response(JSON.stringify({ appointments: result }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── POST /api/appointments ──────────────────────────────────
    if (pathname === "/api/appointments" && method === "POST") {
      const body = await request.json() as {
        title?: string;
        leadId?: string;
        scheduledAt?: string;
        notes?: string;
      };

      if (!body.title || !body.scheduledAt) {
        return new Response(JSON.stringify({ error: "title and scheduledAt are required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const id = crypto.randomUUID();
      const now = new Date();

      await db.insert(appointments).values({
        id,
        workspaceId: workspaceId,
        leadId: body.leadId || null,
        title: body.title,
        scheduledAt: new Date(body.scheduledAt),
        status: "scheduled",
        notes: body.notes || null,
        createdAt: now,
        updatedAt: now,
      });

      return new Response(JSON.stringify({ success: true, id }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── GET /api/documents ───────────────────────────────────────
    if (pathname === "/api/documents" && method === "GET") {
      const targetWorkspaceId = url.searchParams.get("workspace") || workspaceId;

      const result = await db.query.documents.findMany({
        where: eq(documents.workspaceId, targetWorkspaceId),
        orderBy: desc(documents.createdAt),
      });

      return new Response(JSON.stringify({ documents: result }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── POST /api/upload-document ─────────────────────────────────
    if (pathname === "/api/upload-document" && method === "POST") {
      const targetWorkspaceId = url.searchParams.get("workspace") || workspaceId;

      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        return new Response(
          JSON.stringify({ error: "Expected multipart/form-data with a 'file' field" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const file = formData.get("file") as File | null;
      if (!file) {
        return new Response(
          JSON.stringify({ error: "'file' field is required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const id = crypto.randomUUID();
      const now = new Date();
      const ext = file.name.includes(".")
        ? file.name.split(".").pop() || "bin"
        : "bin";

      // Ensure upload directory exists
      const uploadDir = `/home/team/shared/site/uploads/${targetWorkspaceId}`;
      await Bun.write(`${uploadDir}/.keep`, "").then(async () => {
        // Directory created by side-effect of write
      }).catch(async () => {
        // Create directory manually
        const { mkdir } = await import("node:fs/promises");
        await mkdir(uploadDir, { recursive: true });
      });

      // Write file to disk
      const filePath = `${uploadDir}/${id}.${ext}`;
      const fileBytes = await file.arrayBuffer();
      await Bun.write(filePath, new Uint8Array(fileBytes));

      // Read text content for supported types
      let content: string | null = null;
      const textTypes = [
        "text/", "application/json", "application/pdf",
        "application/msword", "application/vnd.openxmlformats",
      ];
      if (textTypes.some((t) => file.type.startsWith(t)) || ext === "txt" || ext === "csv" || ext === "md") {
        try {
          content = await file.text();
        } catch {
          // Binary file — skip content extraction
        }
      }

      await db.insert(documents).values({
        id,
        workspaceId: targetWorkspaceId,
        filename: file.name,
        fileType: file.type || "application/octet-stream",
        fileSize: file.size,
        content,
        metadata: { originalPath: filePath, uploadedAt: now.toISOString() },
        createdAt: now,
      });

      // Log activity
      const activityId = crypto.randomUUID();
      await db.insert(activityLog).values({
        id: activityId,
        workspaceId: targetWorkspaceId,
        type: "document_uploaded",
        description: `Uploaded document: ${file.name}`,
        metadata: { documentId: id, filename: file.name, fileSize: file.size },
        createdAt: now,
      });

      return new Response(
        JSON.stringify({ success: true, id, filename: file.name, file_type: file.type }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    }

    // ════════════════════════════════════════════════════════════
    // AI Action Routes — POST /api/ai/*
    // ════════════════════════════════════════════════════════════

    // ── POST /api/ai/score-lead ──────────────────────────────────
    if (pathname === "/api/ai/score-lead" && method === "POST") {
      const body = await request.json() as { name?: string; source?: string; message?: string };
      if (!body.name) {
        return new Response(JSON.stringify({ error: "name is required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      const result = await scoreLead(
        { name: body.name, source: body.source, message: body.message || "" },
        workspaceId
      );
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── POST /api/ai/generate-reply ──────────────────────────────
    if (pathname === "/api/ai/generate-reply" && method === "POST") {
      const body = await request.json() as { leadName?: string; inquiryText?: string; businessContext?: string };
      if (!body.leadName || !body.inquiryText) {
        return new Response(JSON.stringify({ error: "leadName and inquiryText are required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      const result = await processLeadReply(
        { leadName: body.leadName, inquiryText: body.inquiryText, businessContext: body.businessContext },
        workspaceId
      );
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── POST /api/ai/generate-invoice ────────────────────────────
    if (pathname === "/api/ai/generate-invoice" && method === "POST") {
      const body = await request.json() as { customerName?: string; serviceDescription?: string; amount?: number };
      if (!body.customerName || !body.serviceDescription || !body.amount) {
        return new Response(JSON.stringify({ error: "customerName, serviceDescription, and amount are required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      const result = await generateInvoice(
        { customerName: body.customerName, serviceDescription: body.serviceDescription, amount: body.amount },
        workspaceId
      );
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── POST /api/ai/detect-scheduling ───────────────────────────
    if (pathname === "/api/ai/detect-scheduling" && method === "POST") {
      const body = await request.json() as { message?: string };
      if (!body.message) {
        return new Response(JSON.stringify({ error: "message is required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      const result = await detectSchedulingIntent({ message: body.message }, workspaceId);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── POST /api/ai/generate-proposal ───────────────────────────
    if (pathname === "/api/ai/generate-proposal" && method === "POST") {
      const body = await request.json() as {
        leadName?: string; companyName?: string; serviceType?: string; additionalNotes?: string;
      };
      if (!body.leadName || !body.serviceType) {
        return new Response(JSON.stringify({ error: "leadName and serviceType are required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      const result = await generateProposal(
        { leadName: body.leadName, companyName: body.companyName, serviceType: body.serviceType, additionalNotes: body.additionalNotes },
        workspaceId
      );
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── POST /api/ai/search-knowledge-base ───────────────────────
    if (pathname === "/api/ai/search-knowledge-base" && method === "POST") {
      const body = await request.json() as { query?: string };
      if (!body.query) {
        return new Response(JSON.stringify({ error: "query is required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      const result = await searchKnowledgeBase(body.query, workspaceId);
      return new Response(JSON.stringify({ results: result }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── POST /api/ai/run ── Sandbox runtime ─────────────────────
    if (pathname === "/api/ai/run" && method === "POST") {
      const body = await request.json() as {
        trigger_type?: string;
        workspace_id?: string;
        payload?: Record<string, unknown>;
      };

      if (!body.trigger_type || !body.workspace_id) {
        return new Response(JSON.stringify({ error: "trigger_type and workspace_id are required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      // Find matching enabled automations
      const matching = await db.query.automations.findMany({
        where: and(
          eq(automations.workspaceId, body.workspace_id),
          eq(automations.triggerType, body.trigger_type),
          eq(automations.enabled, true)
        ),
      });

      if (matching.length === 0) {
        return new Response(JSON.stringify({ results: {}, message: "No matching automations" }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      const results: Record<string, unknown> = {};

      for (const auto of matching) {
        const start = Date.now();
        const runId = crypto.randomUUID();
        try {
          // Load employee config
          const emp = await db.query.aiEmployees.findFirst({
            where: eq(aiEmployees.id, auto.aiEmployeeId),
          });

          const employeeConfig = emp?.config as Record<string, unknown> | undefined;

          let output: unknown;
          const p = body.payload || {};

          // Dispatch to correct AI function
          switch (auto.actionType) {
            case "score_lead":
              output = await scoreLead(
                { name: (p.name as string) || "", source: (p.source as string) || "", message: (p.message as string) || "" },
                body.workspace_id,
                employeeConfig as Parameters<typeof scoreLead>[2]
              );
              break;
            case "generate_reply": {
              // Load workspace email config for sender branding
              const ws = await db.query.workspaces.findFirst({
                where: eq(workspaces.id, body.workspace_id),
                columns: { name: true, fromName: true, fromEmail: true, replyTo: true },
              });
              const reply = await processLeadReply(
                { leadName: (p.name as string) || "", leadMessage: (p.message as string) || "" },
                body.workspace_id,
                employeeConfig as Parameters<typeof processLeadReply>[2]
              );
              // Attach workspace email context so the caller can send from the right address
              output = {
                ...(reply as Record<string, unknown>),
                _email: {
                  from: ws?.fromEmail
                    ? (ws.fromName ? `${ws.fromName} <${ws.fromEmail}>` : ws.fromEmail)
                    : null,
                  replyTo: ws?.replyTo || ws?.fromEmail || null,
                  workspaceName: ws?.name || null,
                },
              };
              break;
            }
            case "generate_invoice":
              output = await generateInvoice(
                { clientName: (p.name as string) || "", description: (p.description as string) || "", amount: (p.amount as number) || 0 },
                body.workspace_id,
                employeeConfig as Parameters<typeof generateInvoice>[2]
              );
              break;
            case "detect_scheduling":
              output = await detectSchedulingIntent(
                (p.message as string) || "",
                body.workspace_id,
                employeeConfig as Parameters<typeof detectSchedulingIntent>[2]
              );
              break;
            default:
              output = { error: `Unknown action: ${auto.actionType}` };
          }

          const duration = Date.now() - start;
          await db.insert(automationRuns).values({
            id: runId,
            automationId: auto.id,
            workspaceId: body.workspace_id,
            status: "completed",
            input: body.payload || {},
            output: output as Record<string, unknown>,
            durationMs: duration,
            createdAt: new Date(),
          });

          results[auto.id] = { status: "completed", output, durationMs: duration };
        } catch (err: unknown) {
          const duration = Date.now() - start;
          const errorMsg = err instanceof Error ? err.message : String(err);
          await db.insert(automationRuns).values({
            id: runId,
            automationId: auto.id,
            workspaceId: body.workspace_id,
            status: "failed",
            input: body.payload || {},
            output: { error: errorMsg },
            durationMs: duration,
            createdAt: new Date(),
          });
          results[auto.id] = { status: "failed", error: errorMsg, durationMs: duration };
        }
      }

      return new Response(JSON.stringify({ results }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ════════════════════════════════════════════════════════════
    // Automation Trigger Routes — POST /api/web-chat, /api/webhooks/email/inbound
    // These fire automations by trigger_type, dispatching to AI functions.
    // ════════════════════════════════════════════════════════════

    // ── POST /api/web-chat ────────────────────────────────────────
    if (pathname === "/api/web-chat" && method === "POST") {
      const body = await request.json() as {
        name?: string; email?: string; message?: string; workspace_id?: string;
      };

      const wsId = body.workspace_id || workspaceId;

      if (!body.message) {
        return new Response(JSON.stringify({ error: "message is required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      const payload: Record<string, unknown> = {
        name: body.name || "Website Visitor",
        email: body.email,
        message: body.message,
        source: "web_chat",
      };

      const results = await fireAutomationTrigger(wsId, "web_chat", payload);

      return new Response(JSON.stringify({ results }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // ── POST /api/webhooks/email/inbound ───────────────────────────────
    // Receives inbound customer email from SendGrid Inbound Parse (form payload)
    // OR a JSON body {from, fromName?, to, subject, body} for simulation/testing.
    // Resolves the workspace by To address, stores the email (status=draft),
    // recognizes/creates a lead, and runs AI summary + AI draft reply in
    // parallel (each hard-capped at 6s). NEVER auto-sends — human approval
    // happens in the dashboard via POST /api/emails/:id/send.
    if (pathname === "/api/webhooks/email/inbound" && method === "POST") {
      // Always answer 200 so the mail provider stops retrying, even on errors.
      try {
        let from = "", fromName = "", to = "", subject = "", bodyText = "";
        const contentType = request.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const j = await request.json() as Record<string, unknown>;
          from = String(j.from ?? ""); fromName = String(j.fromName ?? "");
          to = String(j.to ?? ""); subject = String(j.subject ?? "");
          bodyText = String(j.body ?? "");
        } else {
          const form = await request.formData();
          from = String(form.get("from") ?? ""); fromName = String(form.get("from_name") ?? "");
          to = String(form.get("to") ?? ""); subject = String(form.get("subject") ?? "");
          bodyText = String(form.get("text") ?? form.get("html") ?? "");
        }
        from = from.trim(); to = to.trim();
        if (!from || !to) {
          return new Response(JSON.stringify({ status: "ignored", reason: "missing from/to" }), {
            status: 200, headers: { "Content-Type": "application/json" },
          });
        }
        console.log(`[email-inbound] from=${from} to=${to} subject=${subject?.slice(0, 80)}`);
        // Resolve workspace by To address — exact case-insensitive match
        const ws = await db.query.workspaces.findFirst({
          where: sql`lower(${workspaces.fromEmail}) = ${to.toLowerCase()}`,
        });
        if (!ws) {
          console.log(`[email-inbound] no workspace for ${to} — acknowledged`);
          return new Response(JSON.stringify({ status: "ignored", reason: "unknown_recipient" }), {
            status: 200, headers: { "Content-Type": "application/json" },
          });
        }
        // Lead recognition — dedupe by sender email (lowercase), never duplicate
        const senderLower = from.toLowerCase();
        let lead = await db.query.leads.findFirst({
          where: and(eq(leads.workspaceId, ws.id), sql`lower(${leads.email}) = ${senderLower}`),
        });
        let leadId: string | null = lead?.id ?? null;
        if (!lead) {
          const newLeadId = crypto.randomUUID();
          await db.insert(leads).values({
            id: newLeadId,
            workspaceId: ws.id,
            name: fromName || from.split("@")[0] || "Unknown Sender",
            email: from,
            source: "email",
            notes: bodyText.slice(0, 200),
          });
          leadId = newLeadId;
          // Score the new lead (non-fatal — never blocks the webhook response)
          try {
            const scored = await scoreLead(
              { name: fromName || from, source: "email", message: bodyText.slice(0, 2000), signal: AbortSignal.timeout(6000) },
              ws.id,
            );
            await db.update(leads).set({ score: scored.score }).where(eq(leads.id, newLeadId));
          } catch (leadErr) {
            console.error("[email-inbound] lead scoring failed:", leadErr);
          }
        }
        // Insert the email row (status=draft)
        const emailId = crypto.randomUUID();
        await db.insert(emails).values({
          id: emailId,
          workspaceId: ws.id,
          fromEmail: from,
          fromName: fromName || null,
          toEmail: to,
          subject,
          body: bodyText,
          status: "draft",
          leadId,
        });
        // Business context for the AI draft from the workspace's receptionist config
        const rc = (ws.receptionistConfig ?? {}) as Record<string, unknown>;
        const businessContext = [rc.businessName, rc.businessType, rc.description, rc.customInstructions]
          .filter((v): v is string => typeof v === "string" && v.length > 0)
          .join(" · ") || undefined;
        // Email-agent employee config if the workspace has one
        const emailAgent = await db.query.aiEmployees.findFirst({
          where: and(eq(aiEmployees.workspaceId, ws.id), eq(aiEmployees.type, "email-agent")),
        });
        const agentCfg = emailAgent?.config as Record<string, unknown> | undefined;
        const employeeConfig: EmployeeConfig | undefined = emailAgent
          ? {
              name: emailAgent.name,
              personality: (agentCfg?.personality as string) || "professional",
              temperature: (agentCfg?.temperature as number) || 0.5,
              instructions: (agentCfg?.instructions as string) || "",
            }
          : undefined;
        // AI summary + AI draft in parallel, each hard-capped at 6s
        const [summaryRes, draftRes] = await Promise.allSettled([
          summarizeEmail({ text: bodyText, subject }, ws.id, AbortSignal.timeout(6000)),
          processLeadReply(
            {
              leadName: fromName || from,
              inquiryText: `Subject: ${subject || "(no subject)"}\n\n${bodyText}`,
              businessContext,
              signal: AbortSignal.timeout(6000),
            },
            ws.id,
            employeeConfig,
          ),
        ]);
        const updates: Record<string, unknown> = {};
        if (summaryRes.status === "fulfilled") updates.summary = summaryRes.value.summary;
        if (draftRes.status === "fulfilled") {
          updates.aiSubject = draftRes.value.subject;
          updates.aiBody = draftRes.value.body;
        }
        const failures: string[] = [];
        if (summaryRes.status === "rejected") failures.push(`summary: ${(summaryRes.reason as Error)?.message ?? summaryRes.reason}`);
        if (draftRes.status === "rejected") failures.push(`draft: ${(draftRes.reason as Error)?.message ?? draftRes.reason}`);
        if (failures.length > 0) {
          updates.status = "error";
          updates.error = failures.join(" | ").slice(0, 1000);
          console.error(`[email-inbound] AI failed for ${emailId}: ${updates.error}`);
        }
        await db.update(emails).set(updates).where(eq(emails.id, emailId));
        // Fire the automation trigger (fire-and-forget — never delays the 200)
        fireAutomationTrigger(ws.id, "new_email", { emailId, from, fromName, to, subject })
          .catch((err) => console.error("[email-inbound] automation trigger failed:", err));
        return new Response(JSON.stringify({
          status: "ok",
          emailId,
          leadId,
          draftReady: failures.length === 0,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      } catch (err) {
        console.error("[email-inbound] handler error (acking 200):", err);
        return new Response(JSON.stringify({ status: "error", message: "ack" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
    }
    // ── GET /api/emails ── Email Inbox list (newest first) ────────────
    if (pathname === "/api/emails" && method === "GET") {
      const wsId = url.searchParams.get("workspace") || workspaceId;
      const result = await db.query.emails.findMany({
        where: eq(emails.workspaceId, wsId),
        orderBy: desc(emails.createdAt),
        limit: 200,
      });
      return new Response(JSON.stringify({ emails: result }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    // ── POST /api/emails/:id/regenerate ── re-run the AI draft ────────
    const regenMatch = pathname.match(/^\/api\/emails\/([^/]+)\/regenerate$/);
    if (regenMatch && method === "POST") {
      const emailId = decodeURIComponent(regenMatch[1]);
      const email = await db.query.emails.findFirst({ where: eq(emails.id, emailId) });
      if (!email || email.workspaceId !== workspaceId) {
        return new Response(JSON.stringify({ error: "Email not found" }), {
          status: 404, headers: { "Content-Type": "application/json" },
        });
      }
      if (email.status === "sent") {
        return new Response(JSON.stringify({ error: "This email was already sent" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      const body = await request.json().catch(() => ({})) as { prompt?: string };
      const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
      const rc = (ws?.receptionistConfig ?? {}) as Record<string, unknown>;
      const businessContext = [rc.businessName, rc.businessType, rc.description, rc.customInstructions]
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .join(" · ") || undefined;
      const emailAgent = await db.query.aiEmployees.findFirst({
        where: and(eq(aiEmployees.workspaceId, workspaceId), eq(aiEmployees.type, "email-agent")),
      });
      const agentCfg = emailAgent?.config as Record<string, unknown> | undefined;
      const employeeConfig: EmployeeConfig | undefined = emailAgent
        ? {
            name: emailAgent.name,
            personality: (agentCfg?.personality as string) || "professional",
            temperature: (agentCfg?.temperature as number) || 0.5,
            instructions: (agentCfg?.instructions as string) || "",
          }
        : undefined;
      const direction = body.prompt?.trim()
        ? `\n\nRewrite this reply per the following direction: ${body.prompt.trim()}`
        : "";
      const draft = await processLeadReply(
        {
          leadName: email.fromName || email.fromEmail,
          inquiryText: `Subject: ${email.subject}\n\n${email.body}${direction}`,
          businessContext,
          signal: AbortSignal.timeout(6000),
        },
        workspaceId,
        employeeConfig,
      );
      await db.update(emails).set({
        aiSubject: draft.subject,
        aiBody: draft.body,
        regenPrompt: body.prompt?.trim() || null,
        status: "draft",
        error: null,
      }).where(eq(emails.id, emailId));
      const updated = await db.query.emails.findFirst({ where: eq(emails.id, emailId) });
      return new Response(JSON.stringify({ email: updated }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    // ── POST /api/emails/:id/send ── human-approved send of the draft ─
    const sendMatch = pathname.match(/^\/api\/emails\/([^/]+)\/send$/);
    if (sendMatch && method === "POST") {
      const emailId = decodeURIComponent(sendMatch[1]);
      const email = await db.query.emails.findFirst({ where: eq(emails.id, emailId) });
      if (!email || email.workspaceId !== workspaceId) {
        return new Response(JSON.stringify({ error: "Email not found" }), {
          status: 404, headers: { "Content-Type": "application/json" },
        });
      }
      if (!email.aiSubject || !email.aiBody) {
        return new Response(JSON.stringify({ error: "No AI draft to send — regenerate first" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      if (email.status === "sent") {
        return new Response(JSON.stringify({ error: "This email was already sent" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
      const fromName = ws?.fromName || ws?.name || "FlowPilot AI";
      const result = await sendEmail({
        from: `${fromName} <${ws?.fromEmail || email.toEmail}>`,
        to: email.fromEmail,
        subject: email.aiSubject,
        body: email.aiBody,
        replyTo: ws?.replyTo || ws?.fromEmail || undefined,
      });
      await db.update(emails).set({ status: "sent", sentAt: new Date() }).where(eq(emails.id, emailId));
      await db.insert(activityLog).values({
        id: crypto.randomUUID(),
        workspaceId,
        type: "email_agent",
        description: `Sent AI reply to ${email.fromName || email.fromEmail}`,
        metadata: { emailId, to: email.fromEmail, subject: email.aiSubject },
      });
      return new Response(JSON.stringify({ success: true, messageId: result.messageId }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── GET /api/workspace/email-config ──────────────────────────
    if (pathname === "/api/workspace/email-config" && method === "GET") {
      const targetWorkspaceId = url.searchParams.get("workspace") || workspaceId;

      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, targetWorkspaceId),
        columns: { id: true, name: true, fromName: true, fromEmail: true, replyTo: true, paymentLink: true },
      });

      if (!ws) {
        return new Response(JSON.stringify({ error: "Workspace not found" }), {
          status: 404, headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        workspace_id: ws.id,
        workspace_name: ws.name,
        from_name: ws.fromName || null,
        from_email: ws.fromEmail || null,
        reply_to: ws.replyTo || null,
        payment_link: ws.paymentLink || null,
      }), { headers: { "Content-Type": "application/json" } });
    }

    // ── POST /api/workspace/email-config ──────────────────────────
    if (pathname === "/api/workspace/email-config" && method === "POST") {
      const body = await request.json() as {
        workspace_id?: string;
        from_name?: string;
        from_email?: string;
        reply_to?: string;
        payment_link?: string;
      };

      const targetWorkspaceId = body.workspace_id || workspaceId;

      if (!body.from_email) {
        return new Response(JSON.stringify({ error: "from_email is required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      await db
        .update(workspaces)
        .set({
          fromName: body.from_name || body.from_email.split("@")[0],
          fromEmail: body.from_email,
          replyTo: body.reply_to || null,
          paymentLink: body.payment_link || null,
        })
        .where(eq(workspaces.id, targetWorkspaceId));

      // Log activity
      const activityId = crypto.randomUUID();
      await db.insert(activityLog).values({
        id: activityId,
        workspaceId,
        type: "email_config_updated",
        description: `Email config updated: ${body.from_name} <${body.from_email}>`,
        metadata: { from_name: body.from_name, from_email: body.from_email, reply_to: body.reply_to },
        createdAt: new Date(),
      });

      return new Response(JSON.stringify({ success: true, workspace_id: workspaceId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // ── POST /api/workspace/verify-domain ─────────────────────────
    if (pathname === "/api/workspace/verify-domain" && method === "POST") {
      const body = await request.json() as {
        workspace_id?: string;
        domain?: string;
        subdomain?: string;
      };

      const wsId = body.workspace_id || workspaceId;

      if (!body.domain) {
        return new Response(JSON.stringify({ error: "domain is required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const result = await startDomainVerification(body.domain, body.subdomain || "mail");

        // Store in workspace
        await db
          .update(workspaces)
          .set({
            sendgridDomainId: String(result.domainId),
            sendgridDomain: result.domain,
            sendgridSubdomain: result.subdomain,
            sendgridDnsRecords: result.dnsRecords as unknown as Record<string, unknown>[],
          })
          .where(eq(workspaces.id, wsId));

        // Log activity
        const activityId = crypto.randomUUID();
        await db.insert(activityLog).values({
          id: activityId,
          workspaceId: wsId,
          type: "domain_verification_started",
          description: `SendGrid domain verification started for ${result.domain} (subdomain: ${result.subdomain})`,
          metadata: { domainId: result.domainId, domain: result.domain, dnsRecords: result.dnsRecords },
          createdAt: new Date(),
        });

        return new Response(JSON.stringify({
          success: true,
          domain_id: result.domainId,
          domain: result.domain,
          subdomain: result.subdomain,
          dns_records: result.dnsRecords,
          verified: result.verified,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("SendGrid domain verification error:", msg);
        return new Response(JSON.stringify({ error: msg }), {
          status: 502, headers: { "Content-Type": "application/json" },
        });
      }
    }

    // ── GET /api/workspace/verify-domain ───────────────────────────
    if (pathname === "/api/workspace/verify-domain" && method === "GET") {
      const wsId = url.searchParams.get("workspace") || workspaceId;

      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, wsId),
        columns: { sendgridDomainId: true, sendgridDomain: true, sendgridSubdomain: true, sendgridDnsRecords: true },
      });

      if (!ws?.sendgridDomainId) {
        return new Response(JSON.stringify({ error: "No domain verification in progress for this workspace" }), {
          status: 404, headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const result = await checkDomainVerification(Number(ws.sendgridDomainId));

        // Update stored DNS record validation status
        const updatedRecords = (result.dnsRecords as unknown as Record<string, unknown>[]);
        await db
          .update(workspaces)
          .set({ sendgridDnsRecords: updatedRecords })
          .where(eq(workspaces.id, wsId));

        return new Response(JSON.stringify({
          domain_id: result.domainId,
          domain: ws.sendgridDomain,
          subdomain: ws.sendgridSubdomain,
          dns_records: result.dnsRecords,
          verified: result.verified,
        }), { headers: { "Content-Type": "application/json" } });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("SendGrid verification check error:", msg);
        return new Response(JSON.stringify({ error: msg }), {
          status: 502, headers: { "Content-Type": "application/json" },
        });
      }
    }

    // ── GET /api/workspace/receptionist-config ──────────────────────
    if (pathname === "/api/workspace/receptionist-config" && method === "GET") {
      const wsId = url.searchParams.get("workspace") || workspaceId;

      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, wsId),
        columns: { receptionistConfig: true, timezone: true },
      });

      return new Response(JSON.stringify({
        workspace_id: wsId,
        timezone: ws?.timezone || "UTC",
        config: (ws?.receptionistConfig as Record<string, unknown>) || {},
      }), { headers: { "Content-Type": "application/json" } });
    }

    // ── POST /api/workspace/receptionist-config ──────────────────────
    if (pathname === "/api/workspace/receptionist-config" && method === "POST") {
      const body = await request.json() as {
        workspace_id?: string;
        businessName?: string;
        businessType?: string;
        businessHours?: string;
        description?: string;
        customInstructions?: string;
        requireAddress?: boolean;
        openDays?: string[];
        openHours?: { start: string; end: string } | null;
        appointmentSpacer?: number | null;
        keyQuestions?: { if: string; thenAsk: string[] }[] | null;
        termsAcceptedAt?: string | null;
        timezone?: string;
      };

      const wsId = body.workspace_id || workspaceId;

      // Load the existing config so fields the client didn't send survive —
      // e.g. requireAddress / openDays set in one card, then re-saved by
      // another card that only knows about its own fields. An omitted key
      // carries the stored value over; only an explicitly sent key is
      // overwritten (empty string → null, matching the old behavior for
      // cleared fields).
      const existingWs = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, wsId),
        columns: { receptionistConfig: true },
      });
      const existing =
        (existingWs?.receptionistConfig as Record<string, unknown> | null) ?? {};

      const CORE_FIELDS = [
        "businessName",
        "businessType",
        "businessHours",
        "description",
        "customInstructions",
      ] as const;
      const config: Record<string, unknown> = {};
      for (const f of CORE_FIELDS) {
        if (f in body) {
          config[f] = body[f as keyof typeof body] || null;
        } else if (existing[f] !== undefined) {
          config[f] = existing[f];
        }
      }
      // Persist requireAddress when the client explicitly sent it (true OR
      // false — unchecking the box sends false and disables the address ask).
      // When omitted, carry the stored value over so a client that doesn't
      // know the flag can't silently clear it.
      if (typeof body.requireAddress === "boolean") {
        config.requireAddress = body.requireAddress;
      } else if (typeof existing.requireAddress === "boolean") {
        config.requireAddress = existing.requireAddress;
      }
      // Structured open days/hours — persist when explicitly sent (arrays /
      // objects / explicit null clear), carry the stored value over when
      // omitted or sent in a shape we can't store (same merge pattern).
      if (Array.isArray(body.openDays)) {
        config.openDays = body.openDays;
      } else if (Array.isArray(existing.openDays)) {
        config.openDays = existing.openDays;
      }
      if (body.openHours !== undefined) {
        if (body.openHours === null) {
          config.openHours = null; // explicit clear
        } else if (typeof body.openHours === "object" && body.openHours !== null) {
          config.openHours = body.openHours;
        }
        // invalid shape (string/number) → fall through to carry-over below
      }
      if (
        !("openHours" in config) &&
        existing.openHours !== undefined &&
        existing.openHours !== null &&
        typeof existing.openHours === "object"
      ) {
        config.openHours = existing.openHours as { start: string; end: string };
      }
      // Appointment spacer (minutes >= 0) — explicit number persists (invalid
      // values → null = disabled), explicit null clears, omitted carries the
      // stored value over (same merge pattern as the fields above).
      if (typeof body.appointmentSpacer === "number") {
        const n = body.appointmentSpacer;
        config.appointmentSpacer =
          Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
      } else if (body.appointmentSpacer === null) {
        config.appointmentSpacer = null; // explicit clear
      } else if (typeof existing.appointmentSpacer === "number") {
        config.appointmentSpacer = existing.appointmentSpacer;
      }
      // Key questions (conditional qualification rules) — explicit array
      // persists with shape validation (each entry needs a non-empty trimmed
      // `if` string and an array of non-empty trimmed questions; invalid/empty
      // entries are dropped; caps 20 IF blocks × 20 questions per block).
      // Explicit null / an empty (or fully-invalid) array clears; omitted
      // carries the stored value over (same merge pattern as the fields above).
      if (body.keyQuestions !== undefined) {
        if (body.keyQuestions === null) {
          config.keyQuestions = null; // explicit clear
        } else if (Array.isArray(body.keyQuestions)) {
          const cleaned: { if: string; thenAsk: string[] }[] = [];
          for (const b of body.keyQuestions.slice(0, MAX_KEY_QUESTION_BLOCKS)) {
            if (typeof b !== "object" || b === null) continue;
            const cond =
              typeof (b as { if?: unknown }).if === "string"
                ? ((b as { if: string }).if).trim()
                : "";
            const qs = (Array.isArray((b as { thenAsk?: unknown }).thenAsk)
              ? ((b as { thenAsk: unknown[] }).thenAsk)
              : []
            )
              .map((q) => (typeof q === "string" ? q.trim() : ""))
              .filter((q) => q.length > 0)
              .slice(0, MAX_KEY_QUESTIONS_PER_BLOCK);
            if (!cond || qs.length === 0) continue;
            cleaned.push({ if: cond, thenAsk: qs });
          }
          // Empty (or all-invalid) array = cleared.
          config.keyQuestions = cleaned.length > 0 ? cleaned : null;
        }
        // invalid shape (string/number) → fall through to carry-over below
      } else if (Array.isArray(existing.keyQuestions)) {
        config.keyQuestions = existing.keyQuestions;
      }
      // Terms-of-Service acceptance timestamp — explicit valid ISO string
      // persists (validated with Date.parse), explicit null clears, omitted
      // OR invalid values carry the stored value over (same merge pattern as
      // appointmentSpacer above).
      if (body.termsAcceptedAt === null) {
        config.termsAcceptedAt = null; // explicit clear
      } else if (
        typeof body.termsAcceptedAt === "string" &&
        !isNaN(Date.parse(body.termsAcceptedAt))
      ) {
        config.termsAcceptedAt = body.termsAcceptedAt;
      } else if (typeof existing.termsAcceptedAt === "string") {
        config.termsAcceptedAt = existing.termsAcceptedAt;
      }

      const updateData: Record<string, unknown> = {
        receptionistConfig: config as unknown as Record<string, unknown>,
      };
      // Persist the IANA timezone if provided (validated; invalid values are
      // ignored so a bad client payload can't poison the booking engine).
      if (body.timezone !== undefined && body.timezone !== null && body.timezone !== "") {
        const { isValidTimezone } = await import("./src/lib/booking");
        if (isValidTimezone(body.timezone)) updateData.timezone = body.timezone;
      }

      await db
        .update(workspaces)
        .set(updateData)
        .where(eq(workspaces.id, wsId));

      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, wsId),
        columns: { timezone: true },
      });

      return new Response(JSON.stringify({
        success: true,
        workspace_id: wsId,
        timezone: ws?.timezone || "UTC",
        config,
      }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // ── GET /api/workspace/phone-config ─────────────────────────────
    if (pathname === "/api/workspace/phone-config" && method === "GET") {
      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, workspaceId),
        columns: { twilioPhone: true, twilioPhoneSid: true, twilioTransferNumber: true, phoneMode: true },
      });

      return new Response(JSON.stringify({
        twilio_phone: ws?.twilioPhone || null,
        twilio_sid: ws?.twilioPhoneSid || null,
        transfer_number: ws?.twilioTransferNumber || null,
        phone_mode: ws?.phoneMode || "none",
        provisioning: { configured: twilioConfigured() },
      }), { headers: { "Content-Type": "application/json" } });
    }

    // ── POST /api/workspace/phone-config ────────────────────────────
    if (pathname === "/api/workspace/phone-config" && method === "POST") {
      const body = await request.json() as {
        transfer_number?: string | null;
        phone_mode?: string;
      };

      const updateData: Record<string, unknown> = {};
      if (body.transfer_number !== undefined) updateData.twilioTransferNumber = body.transfer_number;
      if (body.phone_mode !== undefined) updateData.phoneMode = body.phone_mode;

      if (Object.keys(updateData).length > 0) {
        await db
          .update(workspaces)
          .set(updateData)
          .where(eq(workspaces.id, workspaceId));
      }

      // Return updated config
      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, workspaceId),
        columns: { twilioPhone: true, twilioPhoneSid: true, twilioTransferNumber: true, phoneMode: true },
      });

      return new Response(JSON.stringify({
        success: true,
        twilio_phone: ws?.twilioPhone || null,
        twilio_sid: ws?.twilioPhoneSid || null,
        transfer_number: ws?.twilioTransferNumber || null,
        phone_mode: ws?.phoneMode || "none",
      }), { headers: { "Content-Type": "application/json" } });
    }

    // ── POST /api/workspace/phone-config/provision ──────────────────
    if (pathname === "/api/workspace/phone-config/provision" && method === "POST") {
      if (!twilioConfigured()) {
        return new Response(JSON.stringify({
          success: false,
          configured: false,
          message: "Twilio API not configured yet — ask the owner to add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      const body = await request.json() as { area_code?: string };

      const result = await provisionForWorkspace(body.area_code);
      if (!result) {
        return new Response(JSON.stringify({
          success: false,
          configured: true,
          message: "Failed to provision a phone number. Please try again or contact support.",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      // Update workspace with the new number (persist the SID for lifecycle mgmt)
      await db
        .update(workspaces)
        .set({ twilioPhone: result.number, twilioPhoneSid: result.sid, phoneMode: "provisioned" })
        .where(eq(workspaces.id, workspaceId));

      // Log activity
      await db.insert(activityLog).values({
        id: crypto.randomUUID(),
        workspaceId,
        type: "phone_provisioned",
        description: `Provisioned Twilio number ${result.number}`,
        metadata: { twilioPhone: result.number, twilioSid: result.sid },
        createdAt: new Date(),
      });

      return new Response(JSON.stringify({
        success: true,
        twilio_phone: result.number,
        twilio_sid: result.sid,
        phone_mode: "provisioned",
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    }

    // ── GET /api/workspace/calls ────────────────────────────────────
    if (pathname === "/api/workspace/calls" && method === "GET") {
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "25"), 100);

      const rows = await db
        .select({
          id: calls.id,
          callSid: calls.callSid,
          callerNumber: calls.callerNumber,
          toNumber: calls.toNumber,
          status: calls.status,
          outcome: calls.outcome,
          startedAt: calls.startedAt,
          endedAt: calls.endedAt,
          durationSec: calls.durationSec,
          leadId: calls.leadId,
          appointmentId: calls.appointmentId,
          leadName: leads.name,
          appointmentTitle: appointments.title,
        })
        .from(calls)
        .leftJoin(leads, eq(calls.leadId, leads.id))
        .leftJoin(appointments, eq(calls.appointmentId, appointments.id))
        .where(eq(calls.workspaceId, workspaceId))
        .orderBy(desc(calls.startedAt))
        .limit(limit);

      return new Response(JSON.stringify({ calls: rows }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── POST /api/workspace/chat ────────────────────────────────────
    if (pathname === "/api/workspace/chat" && method === "POST") {
      const body = await request.json() as {
        message?: string;
        history?: Array<{ role: "user" | "assistant" | "tool"; content: string; toolCallId?: string; name?: string }>;
      };

      if (!body.message) {
        return new Response(JSON.stringify({ error: "message is required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      // Load workspace context for the orchestrator
      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, workspaceId),
        columns: { name: true, fromName: true, fromEmail: true, paymentLink: true, receptionistConfig: true },
      });

      const rc = ws?.receptionistConfig as Record<string, unknown> | null;

      const workspaceContext = {
        businessName: ws?.name || "your business",
        businessType: (rc?.businessType as string) || undefined,
        fromEmail: ws?.fromEmail || undefined,
        fromName: ws?.fromName || ws?.name || undefined,
        paymentLink: ws?.paymentLink || undefined,
      };

      const { chatWithOrchestrator } = await import("./src/lib/orchestrator");

      const result = await chatWithOrchestrator(
        workspaceId,
        body.message,
        (body.history || []) as Parameters<typeof chatWithOrchestrator>[2],
        workspaceContext,
      );

      return new Response(JSON.stringify(result), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // ── POST /api/ai/send-reply ───────────────────────────────────
    if (pathname === "/api/ai/send-reply" && method === "POST") {
      const body = await request.json() as {
        workspace_id?: string;
        lead_email?: string;
        reply_text?: string;
        subject?: string;
      };

      const targetWorkspaceId = body.workspace_id || workspaceId;

      if (!body.lead_email || !body.reply_text) {
        return new Response(JSON.stringify({ error: "lead_email and reply_text are required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      // Load workspace email config
      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, targetWorkspaceId),
        columns: { id: true, name: true, fromName: true, fromEmail: true, replyTo: true },
      });

      if (!ws || !ws.fromEmail) {
        return new Response(JSON.stringify({ error: "Workspace email not configured" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      const fromAddress = ws.fromName
        ? `${ws.fromName} <${ws.fromEmail}>`
        : ws.fromEmail;

      const subject = body.subject || "Reply from FlowPilot AI";

      // Wrap plain text in basic HTML
      const htmlBody = `<html><body style="font-family:Arial,sans-serif;line-height:1.6">${body.reply_text.replace(/\n/g, "<br>")}</body></html>`;

      const result = await sendEmail({
        from: fromAddress,
        to: body.lead_email,
        subject,
        body: htmlBody,
        replyTo: ws.replyTo || ws.fromEmail,
      });

      // Log activity
      const activityId = crypto.randomUUID();
      await db.insert(activityLog).values({
        id: activityId,
        workspaceId: targetWorkspaceId,
        type: "email_sent",
        description: `Reply sent to ${body.lead_email}: "${subject}"`,
        metadata: { messageId: result.messageId, leadEmail: body.lead_email, fromAddress },
        createdAt: new Date(),
      });

      return new Response(JSON.stringify({ success: true, message_id: result.messageId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    // ── POST /api/workspace/send-invoice ─────────────────────────
    if (pathname === "/api/workspace/send-invoice" && method === "POST") {
      const body = await request.json() as {
        customer_name?: string;
        customer_email?: string;
        service_description?: string;
        amount?: number;
        due_date?: string;
        payment_instructions?: string;
        payment_link?: string;
      };

      if (!body.customer_name || !body.customer_email || !body.amount) {
        return new Response(JSON.stringify({ error: "customer_name, customer_email, and amount are required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      // Load workspace email config
      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, workspaceId),
        columns: { id: true, name: true, fromName: true, fromEmail: true, replyTo: true, paymentLink: true },
      });

      if (!ws || !ws.fromEmail) {
        return new Response(JSON.stringify({ error: "Workspace email not configured. Set up your email in Admin Settings first." }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      // Resolve payment link: per-invoice first, fall back to workspace default
      const paymentLink = body.payment_link?.trim() || ws.paymentLink || null;

      // 1. Generate invoice data via AI
      const invoiceData = await generateInvoice(
        {
          customerName: body.customer_name,
          serviceDescription: body.service_description || "Services",
          amount: body.amount,
        },
        workspaceId,
      );

      // 2. Generate PDF
      const { generateInvoicePdf } = await import("./src/lib/pdf-invoice");
      const businessName = ws.fromName || ws.name || "FlowPilot AI";
      const pdfBuffer = await generateInvoicePdf({
        invoice: invoiceData,
        businessName,
        customerName: body.customer_name,
        customerEmail: body.customer_email,
        dueDate: body.due_date,
        paymentInstructions: body.payment_instructions,
        paymentLink: paymentLink || undefined,
      });

      // 3. Send email with PDF attachment
      const fromAddress = ws.fromName
        ? `${ws.fromName} <${ws.fromEmail}>`
        : ws.fromEmail;

      const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");

      // Build email body — include Pay Now button when a payment link exists
      let emailHtml = `<html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">`;
      emailHtml += invoiceData.emailBody.replace(/\n/g, "<br>");
      if (paymentLink) {
        emailHtml += `
<br><br>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0">
  <tr>
    <td style="border-radius:6px;background:#4338ca;padding:12px 28px">
      <a href="${paymentLink}" style="display:inline-block;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">Pay Now</a>
    </td>
  </tr>
</table>
<p style="font-size:13px;color:#6b7280">If the button doesn't work, copy and paste this link into your browser:<br><a href="${paymentLink}" style="color:#4338ca">${paymentLink}</a></p>`;
      }
      emailHtml += `</body></html>`;

      const emailResult = await sendEmail({
        from: fromAddress,
        to: body.customer_email,
        subject: `Invoice ${invoiceData.invoiceNumber} from ${businessName}`,
        body: emailHtml,
        replyTo: ws.replyTo || ws.fromEmail,
        attachments: [
          {
            content: pdfBase64,
            filename: `Invoice-${invoiceData.invoiceNumber}.pdf`,
            type: "application/pdf",
            disposition: "attachment",
          },
        ],
      });

      // 4. Store invoice record
      const invoiceId = crypto.randomUUID();
      const now = new Date();
      await db.insert(invoices).values({
        id: invoiceId,
        workspaceId,
        customerName: body.customer_name,
        customerEmail: body.customer_email,
        amountCents: Math.round(body.amount * 100),
        status: "sent",
        dueDate: body.due_date ? new Date(body.due_date) : null,
        createdAt: now,
      });

      // 5. Log activity
      await db.insert(activityLog).values({
        id: crypto.randomUUID(),
        workspaceId,
        type: "invoice_sent",
        description: `Invoice ${invoiceData.invoiceNumber} sent to ${body.customer_name} (${body.customer_email})`,
        metadata: {
          invoiceId,
          invoiceNumber: invoiceData.invoiceNumber,
          customerName: body.customer_name,
          customerEmail: body.customer_email,
          amount: body.amount,
          messageId: emailResult.messageId,
          paymentLink,
        },
        createdAt: now,
      });

      return new Response(JSON.stringify({
        success: true,
        invoice: {
          id: invoiceId,
          invoiceNumber: invoiceData.invoiceNumber,
          customerName: body.customer_name,
          customerEmail: body.customer_email,
          amountCents: Math.round(body.amount * 100),
          status: "sent",
          dueDate: body.due_date || null,
          createdAt: now.toISOString(),
        },
        messageId: emailResult.messageId,
      }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // ── DELETE /api/workspace/invoices ──────────────────────────
    if (pathname === "/api/workspace/invoices" && method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) {
        return new Response(JSON.stringify({ error: "id query param is required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      // Verify invoice belongs to workspace
      const existing = await db.query.invoices.findFirst({
        where: (cols, { and }) => and(eq(cols.id, id), eq(cols.workspaceId, workspaceId)),
      });
      if (!existing) {
        return new Response(JSON.stringify({ error: "Invoice not found" }), {
          status: 404, headers: { "Content-Type": "application/json" },
        });
      }

      await db
        .delete(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.workspaceId, workspaceId)));

      await db.insert(activityLog).values({
        id: crypto.randomUUID(),
        workspaceId,
        type: "invoice_deleted",
        description: `Deleted invoice for ${existing.customerName} (${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(existing.amountCents / 100)})`,
        metadata: { invoiceId: id, customerName: existing.customerName, amountCents: existing.amountCents },
        createdAt: new Date(),
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // ── DELETE /api/workspace/leads ─────────────────────────────
    if (pathname === "/api/workspace/leads" && method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) {
        return new Response(JSON.stringify({ error: "id query param is required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      // Verify lead belongs to workspace
      const existing = await db.query.leads.findFirst({
        where: (cols, { and }) => and(eq(cols.id, id), eq(cols.workspaceId, workspaceId)),
      });
      if (!existing) {
        return new Response(JSON.stringify({ error: "Lead not found" }), {
          status: 404, headers: { "Content-Type": "application/json" },
        });
      }

      // Clear FK references before deleting the lead
      await db.update(appointments).set({ leadId: null }).where(eq(appointments.leadId, id));
      await db.update(proposals).set({ leadId: null }).where(eq(proposals.leadId, id));
      await db.update(calls).set({ leadId: null }).where(eq(calls.leadId, id));

      await db
        .delete(leads)
        .where(and(eq(leads.id, id), eq(leads.workspaceId, workspaceId)));

      await db.insert(activityLog).values({
        id: crypto.randomUUID(),
        workspaceId,
        type: "lead_deleted",
        description: `Deleted lead: ${existing.name}`,
        metadata: { leadId: id, name: existing.name, email: existing.email },
        createdAt: new Date(),
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // ── DELETE /api/workspace/appointments ──────────────────────
    if (pathname === "/api/workspace/appointments" && method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) {
        return new Response(JSON.stringify({ error: "id query param is required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      // Verify appointment belongs to workspace
      const existing = await db.query.appointments.findFirst({
        where: (cols, { and }) => and(eq(cols.id, id), eq(cols.workspaceId, workspaceId)),
      });
      if (!existing) {
        return new Response(JSON.stringify({ error: "Appointment not found" }), {
          status: 404, headers: { "Content-Type": "application/json" },
        });
      }

      // Clear FK references before deleting the appointment
      await db.update(calls).set({ appointmentId: null }).where(eq(calls.appointmentId, id));

      await db
        .delete(appointments)
        .where(and(eq(appointments.id, id), eq(appointments.workspaceId, workspaceId)));

      await db.insert(activityLog).values({
        id: crypto.randomUUID(),
        workspaceId,
        type: "appointment_deleted",
        description: `Deleted appointment: ${existing.title}`,
        metadata: { appointmentId: id, title: existing.title, scheduledAt: existing.scheduledAt?.toISOString() },
        createdAt: new Date(),
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // ── DELETE /api/workspace/documents ─────────────────────────
    if (pathname === "/api/workspace/documents" && method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) {
        return new Response(JSON.stringify({ error: "id query param is required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      // Verify document belongs to workspace
      const existing = await db.query.documents.findFirst({
        where: (cols, { and }) => and(eq(cols.id, id), eq(cols.workspaceId, workspaceId)),
      });
      if (!existing) {
        return new Response(JSON.stringify({ error: "Document not found" }), {
          status: 404, headers: { "Content-Type": "application/json" },
        });
      }

      // Remove the file on disk if we know where it lives (ignore missing file)
      const meta = existing.metadata as Record<string, unknown> | null;
      const originalPath = typeof meta?.originalPath === "string" ? meta.originalPath : null;
      if (originalPath) {
        try {
          const { unlink } = await import("node:fs/promises");
          await unlink(originalPath);
        } catch (err) {
          if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
            console.error("Failed to delete document file:", err);
          }
        }
      }

      await db
        .delete(documents)
        .where(and(eq(documents.id, id), eq(documents.workspaceId, workspaceId)));

      await db.insert(activityLog).values({
        id: crypto.randomUUID(),
        workspaceId,
        type: "document_deleted",
        description: `Deleted document: ${existing.filename}`,
        metadata: { documentId: id, filename: existing.filename, fileType: existing.fileType },
        createdAt: new Date(),
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // ── POST /api/send-invite ────────────────────────────────────
    if (pathname === "/api/send-invite" && method === "POST") {
      const body = await request.json() as { email?: string; inviteLink?: string; workspaceId?: string };
      if (!body.email || !body.inviteLink) {
        return new Response(JSON.stringify({ error: "email and inviteLink are required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      // Log the invite to activity_log
      const activityId = crypto.randomUUID();
      const now = new Date();
      await db.insert(activityLog).values({
        id: activityId,
        workspaceId: workspaceId,
        type: "invite_sent",
        description: `Invite sent to ${body.email}`,
        metadata: { inviteLink: body.inviteLink, email: body.email },
        createdAt: now,
      });

      // Write to pending queue for email delivery
      const queueEntry = JSON.stringify({
        email: body.email,
        inviteLink: body.inviteLink,
        queuedAt: now.toISOString(),
      });
      console.log(`📧 Invite queued for ${body.email}: ${body.inviteLink}`);

      // Send the invite email via SendGrid
      try {
        // Use the workspace's branded sender if configured, else FlowPilot default
        let fromAddress = "FlowPilot AI <connorj.elsasser@gmail.com>";
        if (body.workspaceId) {
          const ws = await db.query.workspaces.findFirst({
            where: eq(workspaces.id, body.workspaceId),
            columns: { fromName: true, fromEmail: true },
          });
          if (ws?.fromEmail) {
            fromAddress = ws.fromName
              ? `${ws.fromName} <${ws.fromEmail}>`
              : ws.fromEmail;
          }
        }
        const emailBody = `Hi,\n\nYou've been invited to join FlowPilot AI — your team of AI employees is ready to go.\n\nClick here to get started: ${body.inviteLink}\n\nYou'll set up your AI employees, upload your knowledge base, and start automating in minutes.\n\n— The FlowPilot AI Team`;
        await sendEmail({
          from: fromAddress,
          to: body.email,
          subject: "You're invited to FlowPilot AI 🚀",
          body: emailBody.replace(/\n/g, "<br>"),
        });
        console.log(`✅ Invite email sent to ${body.email}`);
      } catch (err) {
        console.error(`❌ Failed to send invite email to ${body.email}:`, err);
        // Still return success — the link is available for copy/paste in the UI
      }

      return new Response(JSON.stringify({ success: true, id: activityId }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── DELETE /api/workspace ────────────────────────────────────────
    // Cascades delete all child rows (activity_log, calls, leads, appointments,
    // proposals, invoices, automations, automation_runs, documents,
    // ai_employees, users) then removes the workspace itself.
    if (pathname === "/api/workspace" && method === "DELETE") {
      // Verify workspace exists
      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, workspaceId),
      });
      if (!ws) {
        return new Response(JSON.stringify({ error: "Workspace not found" }), {
          status: 404, headers: { "Content-Type": "application/json" },
        });
      }

      // FK-safe deletion order (child rows first, then parents):
      // 1. activity_log (no FK references TO this table)
      // 2. automation_runs (refs automations + workspaces)
      // 3. calls (refs leads + appointments + workspaces)
      // 4. proposals (refs leads + workspaces)
      // 5. appointments (refs leads + workspaces)
      // 6. invoices (refs workspaces only)
      // 7. documents (refs workspaces only)
      // 8. automations (refs ai_employees + workspaces)
      // 9. leads (refs workspaces only)
      // 10. ai_employees (refs workspaces only)
      // 11. users (refs workspaces only)
      // 12. workspaces (the workspace row itself)

      await db.delete(activityLog).where(eq(activityLog.workspaceId, workspaceId));
      await db.delete(automationRuns).where(eq(automationRuns.workspaceId, workspaceId));
      await db.delete(calls).where(eq(calls.workspaceId, workspaceId));
      await db.delete(proposals).where(eq(proposals.workspaceId, workspaceId));
      await db.delete(appointments).where(eq(appointments.workspaceId, workspaceId));
      await db.delete(invoices).where(eq(invoices.workspaceId, workspaceId));
      await db.delete(documents).where(eq(documents.workspaceId, workspaceId));
      await db.delete(automations).where(eq(automations.workspaceId, workspaceId));
      await db.delete(leads).where(eq(leads.workspaceId, workspaceId));
      await db.delete(aiEmployees).where(eq(aiEmployees.workspaceId, workspaceId));
      await db.delete(users).where(eq(users.workspaceId, workspaceId));
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));

      // Clear the session cookie so the client redirects to sign-in
      const headers = new Headers({ "Content-Type": "application/json" });
      clearSessionCookie(headers);

      return new Response(JSON.stringify({ success: true, deleted: workspaceId }), {
        status: 200, headers,
      });
    }

    return null; // Not an API route we handle
  } catch (error) {
    console.error(`API error ${method} ${pathname}:`, error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
