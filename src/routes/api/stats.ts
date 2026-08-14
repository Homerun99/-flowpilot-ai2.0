// GET /api/stats — Aggregate workspace stats
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { db } from "@/db";
import { leads, invoices, appointments, automations, automationRuns } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

const DEMO_WORKSPACE = "ws_demo";

export const APIRoute = createAPIFileRoute("/api/stats")({
  GET: async () => {
    try {
      const [
        totalLeads,
        totalInvoices,
        totalAppointments,
        totalAutomations,
        totalRuns,
        leadsByStatus,
      ] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(leads)
          .where(eq(leads.workspaceId, DEMO_WORKSPACE))
          .then((r) => r[0]?.count ?? 0),

        db
          .select({ count: sql<number>`count(*)::int` })
          .from(invoices)
          .where(eq(invoices.workspaceId, DEMO_WORKSPACE))
          .then((r) => r[0]?.count ?? 0),

        db
          .select({ count: sql<number>`count(*)::int` })
          .from(appointments)
          .where(eq(appointments.workspaceId, DEMO_WORKSPACE))
          .then((r) => r[0]?.count ?? 0),

        db
          .select({ count: sql<number>`count(*)::int` })
          .from(automations)
          .where(eq(automations.workspaceId, DEMO_WORKSPACE))
          .then((r) => r[0]?.count ?? 0),

        db
          .select({ count: sql<number>`count(*)::int` })
          .from(automationRuns)
          .where(eq(automationRuns.workspaceId, DEMO_WORKSPACE))
          .then((r) => r[0]?.count ?? 0),

        // Leads grouped by status
        db
          .select({
            status: sql<string>`${leads.status}`,
            count: sql<number>`count(*)::int`,
          })
          .from(leads)
          .where(eq(leads.workspaceId, DEMO_WORKSPACE))
          .groupBy(leads.status),
      ]);

      const stats = {
        totalLeads,
        totalInvoices,
        totalAppointments,
        totalAutomations,
        totalAutomationRuns: totalRuns,
        leadsByStatus: Object.fromEntries(
          leadsByStatus.map((r) => [r.status, r.count])
        ),
      };

      return new Response(JSON.stringify({ stats }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("GET /api/stats error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch stats" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
});
