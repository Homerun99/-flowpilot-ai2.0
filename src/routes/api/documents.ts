// GET /api/documents — List uploaded documents for the workspace
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

const DEMO_WORKSPACE = "ws_demo_001";

export const APIRoute = createAPIFileRoute("/api/documents")({
  GET: async ({ request }) => {
    try {
      const url = new URL(request.url);
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
      const offset = parseInt(url.searchParams.get("offset") || "0");

      const result = await db.query.documents.findMany({
        where: eq(documents.workspaceId, DEMO_WORKSPACE),
        orderBy: desc(documents.createdAt),
        limit,
        offset,
      });

      return new Response(JSON.stringify({ documents: result }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("GET /api/documents error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch documents" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
});
