// GET /api/ai-employees — List AI employees with aggregate stats
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { db } from "@/db";
import { aiEmployees, automationRuns } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

const DEMO_WORKSPACE = "ws_demo";

export const APIRoute = createAPIFileRoute("/api/ai-employees")({
  GET: async () => {
    try {
      const employees = await db.query.aiEmployees.findMany({
        where: eq(aiEmployees.workspaceId, DEMO_WORKSPACE),
        orderBy: (cols, { desc }) => desc(cols.createdAt),
      });

      // Enrich each employee with run counts
      const enriched = await Promise.all(
        employees.map(async (emp) => {
          const runs = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(automationRuns)
            .where(eq(automationRuns.workspaceId, DEMO_WORKSPACE))
            .then((r) => r[0]?.count ?? 0);

          const successfulRuns = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(automationRuns)
            .where(eq(automationRuns.workspaceId, DEMO_WORKSPACE))
            .then((r) => r[0]?.count ?? 0);

          return {
            ...emp,
            stats: {
              totalRuns: runs,
              successfulRuns,
            },
          };
        })
      );

      return new Response(JSON.stringify({ employees: enriched }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("GET /api/ai-employees error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch AI employees" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
});
