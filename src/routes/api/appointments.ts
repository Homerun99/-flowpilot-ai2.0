// GET/POST /api/appointments — List and book appointments
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { db } from "@/db";
import { appointments } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { fireAutomationTrigger } from "~/lib/automation-trigger";

const DEMO_WORKSPACE = "ws_demo_001";

export const APIRoute = createAPIFileRoute("/api/appointments")({
  // GET /api/appointments — list appointments for the workspace
  GET: async ({ request }) => {
    try {
      const url = new URL(request.url);
      const status = url.searchParams.get("status");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
      const offset = parseInt(url.searchParams.get("offset") || "0");

      const result = await db.query.appointments.findMany({
        where: (cols, { eq, and }) => {
          const conditions = [eq(cols.workspaceId, DEMO_WORKSPACE)];
          if (status) conditions.push(eq(cols.status, status));
          return and(...conditions);
        },
        orderBy: desc(appointments.scheduledAt),
        with: {
          lead: true,
        },
        limit,
        offset,
      });

      return new Response(JSON.stringify({ appointments: result }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("GET /api/appointments error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch appointments" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },

  // POST /api/appointments — book a new appointment
  POST: async ({ request }) => {
    try {
      const body = await request.json() as {
        title?: string;
        leadId?: string;
        scheduledAt?: string;
        notes?: string;
      };

      if (!body.title || !body.scheduledAt) {
        return new Response(
          JSON.stringify({ error: "title and scheduledAt are required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const id = crypto.randomUUID();

      await db.insert(appointments).values({
        id,
        workspaceId: DEMO_WORKSPACE,
        leadId: body.leadId || null,
        title: body.title,
        scheduledAt: new Date(body.scheduledAt),
        status: "scheduled",
        notes: body.notes || null,
        createdAt: new Date(),
      });

      const created = await db.query.appointments.findFirst({
        where: eq(appointments.id, id),
        with: {
          lead: true,
        },
      });

      // ── Fire appointment_request automations (non-blocking) ──
      fireAutomationTrigger(DEMO_WORKSPACE, "appointment_request", {
        title: body.title,
        scheduledAt: body.scheduledAt,
        notes: body.notes || "",
        lead: created?.lead ? { id: created.lead.id, name: created.lead.name } : undefined,
      }).catch((err) => console.error("appointment_request trigger failed:", err));

      return new Response(JSON.stringify({ appointment: created }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("POST /api/appointments error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to book appointment" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
});
