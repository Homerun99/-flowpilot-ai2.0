// GET/POST /api/invoices — List and create invoices
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

const DEMO_WORKSPACE = "ws_demo";

export const APIRoute = createAPIFileRoute("/api/invoices")({
  // GET /api/invoices — list invoices for the workspace
  GET: async ({ request }) => {
    try {
      const url = new URL(request.url);
      const status = url.searchParams.get("status");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
      const offset = parseInt(url.searchParams.get("offset") || "0");

      const result = await db.query.invoices.findMany({
        where: (cols, { eq, and }) => {
          const conditions = [eq(cols.workspaceId, DEMO_WORKSPACE)];
          if (status) conditions.push(eq(cols.status, status));
          return and(...conditions);
        },
        orderBy: desc(invoices.createdAt),
        limit,
        offset,
      });

      return new Response(JSON.stringify({ invoices: result }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("GET /api/invoices error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch invoices" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },

  // POST /api/invoices — create a new invoice
  POST: async ({ request }) => {
    try {
      const body = await request.json() as {
        customerName?: string;
        customerEmail?: string;
        amountCents?: number;
        dueDate?: string;
        notes?: string;
      };

      if (!body.customerName || body.amountCents == null) {
        return new Response(
          JSON.stringify({ error: "customerName and amountCents are required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const id = crypto.randomUUID();

      await db.insert(invoices).values({
        id,
        workspaceId: DEMO_WORKSPACE,
        customerName: body.customerName,
        customerEmail: body.customerEmail || null,
        amountCents: body.amountCents,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        status: "draft",
        createdAt: new Date(),
      });

      const created = await db.query.invoices.findFirst({
        where: eq(invoices.id, id),
      });

      return new Response(JSON.stringify({ invoice: created }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("POST /api/invoices error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to create invoice" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
});
