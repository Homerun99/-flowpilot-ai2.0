// GET/POST /api/leads — Lead management for a workspace
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { db } from "@/db";
import { leads, automations, automationRuns, aiEmployees } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { scoreLead, type EmployeeConfig } from "~/lib/ai-employees";

const DEMO_WORKSPACE = "ws_demo_001";

export const APIRoute = createAPIFileRoute("/api/leads")({
  // GET /api/leads — list all leads for the demo workspace
  GET: async ({ request }) => {
    try {
      const url = new URL(request.url);
      const status = url.searchParams.get("status");
      const search = url.searchParams.get("search");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
      const offset = parseInt(url.searchParams.get("offset") || "0");

      const result = await db.query.leads.findMany({
        where: (leads, { eq, and, like, or }) => {
          const conditions = [eq(leads.workspaceId, DEMO_WORKSPACE)];
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
    } catch (error) {
      console.error("GET /api/leads error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch leads" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },

  // POST /api/leads — create a new lead
  POST: async ({ request }) => {
    try {
      const body = await request.json() as {
        name?: string;
        email?: string;
        phone?: string;
        source?: string;
        notes?: string;
      };

      if (!body.name) {
        return new Response(
          JSON.stringify({ error: "name is required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const id = crypto.randomUUID();
      const now = new Date();

      await db.insert(leads).values({
        id,
        workspaceId: DEMO_WORKSPACE,
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

      // ── Trigger sandbox: run "new_lead" automations ──
      try {
        const matching = await db.query.automations.findMany({
          where: (cols) =>
            and(
              eq(cols.workspaceId, DEMO_WORKSPACE),
              eq(cols.triggerType, "new_lead"),
              eq(cols.enabled, true)
            ),
          with: { aiEmployee: true },
        });

        for (const auto of matching) {
          const employee = auto.aiEmployee;
          const employeeConfig: EmployeeConfig | undefined = employee
            ? {
                name: employee.name,
                personality: (employee.config as Record<string, unknown>)?.personality as string || "professional",
                temperature: (employee.config as Record<string, unknown>)?.temperature as number || 0.5,
                instructions: (employee.config as Record<string, unknown>)?.instructions as string || "",
              }
            : undefined;

          const runId = crypto.randomUUID();
          try {
            const scoreResult = await scoreLead(
              { name: created!.name, source: created!.source || undefined, message: created!.notes || "" },
              DEMO_WORKSPACE,
              employeeConfig,
            );

            // Update lead score in DB
            await db.update(leads).set({ score: scoreResult.score }).where(eq(leads.id, id));

            await db.insert(automationRuns).values({
              id: runId,
              automationId: auto.id,
              workspaceId: DEMO_WORKSPACE,
              status: "success",
              input: { trigger_type: "new_lead", payload: { name: created!.name, email: created!.email } },
              output: scoreResult as unknown as Record<string, unknown>,
              createdAt: new Date(),
            });
          } catch (runErr) {
            await db.insert(automationRuns).values({
              id: runId,
              automationId: auto.id,
              workspaceId: DEMO_WORKSPACE,
              status: "failure",
              input: { trigger_type: "new_lead", payload: { name: created!.name, email: created!.email } },
              output: { error: runErr instanceof Error ? runErr.message : String(runErr) },
              createdAt: new Date(),
            });
          }
        }
      } catch (sandboxErr) {
        console.error("Sandbox trigger failed (non-fatal):", sandboxErr);
      }

      return new Response(JSON.stringify({ lead: created }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("POST /api/leads error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to create lead" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
});
