// GET /api/activity — Recent activity log for the workspace
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { db } from "@/db";
import { activityLog } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

const DEMO_WORKSPACE = "ws_demo";

export const APIRoute = createAPIFileRoute("/api/activity")({
  GET: async ({ request }) => {
    try {
      const url = new URL(request.url);
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
      const offset = parseInt(url.searchParams.get("offset") || "0");

      const result = await db.query.activityLog.findMany({
        where: eq(activityLog.workspaceId, DEMO_WORKSPACE),
        orderBy: desc(activityLog.createdAt),
        limit,
        offset,
      });

      return new Response(JSON.stringify({ activities: result }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("GET /api/activity error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch activity log" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
});
