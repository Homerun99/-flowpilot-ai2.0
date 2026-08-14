// POST /api/ai/run — Sandbox runtime: trigger AI automations
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { db } from "@/db";
import { automations, aiEmployees, automationRuns } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  scoreLead,
  processLeadReply,
  generateInvoice,
  detectSchedulingIntent,
  type EmployeeConfig,
} from "~/lib/ai-employees";

export const APIRoute = createAPIFileRoute("/api/ai/run")({
  POST: async ({ request }) => {
    try {
      const body = (await request.json()) as {
        trigger_type: string;
        workspace_id: string;
        payload: Record<string, unknown>;
      };

      const { trigger_type, workspace_id, payload } = body;

      if (!trigger_type || !workspace_id) {
        return new Response(
          JSON.stringify({ error: "trigger_type and workspace_id are required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // 1. Find all automations for this workspace + trigger type
      const matchingAutomations = await db.query.automations.findMany({
        where: (cols) =>
          and(
            eq(cols.workspaceId, workspace_id),
            eq(cols.triggerType, trigger_type),
            eq(cols.enabled, true)
          ),
        with: { aiEmployee: true },
      });

      if (matchingAutomations.length === 0) {
        return new Response(
          JSON.stringify({ results: {}, message: "No matching automations found" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 2. Process each automation
      const results: Record<string, unknown> = {};

      for (const auto of matchingAutomations) {
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
        const startTime = Date.now();

        try {
          const output = await dispatchAction(auto.actionType, payload, workspace_id, employeeConfig);

          // Record successful run
          await db.insert(automationRuns).values({
            id: runId,
            automationId: auto.id,
            workspaceId: workspace_id,
            status: "success",
            input: { trigger_type, payload },
            output: output as Record<string, unknown>,
            createdAt: new Date(),
          });

          results[auto.id] = {
            automationName: auto.name,
            status: "success",
            output,
            executionMs: Date.now() - startTime,
          };
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error(`[ai/run] Automation "${auto.name}" failed:`, errorMessage);

          // Record failed run
          await db.insert(automationRuns).values({
            id: runId,
            automationId: auto.id,
            workspaceId: workspace_id,
            status: "failure",
            input: { trigger_type, payload },
            output: { error: errorMessage },
            createdAt: new Date(),
          });

          results[auto.id] = {
            automationName: auto.name,
            status: "failure",
            error: errorMessage,
            executionMs: Date.now() - startTime,
          };
        }
      }

      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("POST /api/ai/run error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to run AI automations" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
});

/**
 * Route an action type to the correct AI function with payload extraction.
 */
async function dispatchAction(
  actionType: string,
  payload: Record<string, unknown>,
  workspaceId: string,
  employeeConfig?: EmployeeConfig,
): Promise<unknown> {
  switch (actionType) {
    case "score_lead":
      return scoreLead(
        {
          name: (payload.name as string) || (payload.lead?.name as string) || "Unknown",
          source: (payload.source as string) || (payload.lead?.source as string),
          message: (payload.message as string) || (payload.notes as string) || (payload.lead?.notes as string) || "",
        },
        workspaceId,
        employeeConfig,
      );

    case "generate_reply":
      return processLeadReply(
        {
          leadName: (payload.name as string) || (payload.lead?.name as string) || "Customer",
          inquiryText: (payload.message as string) || (payload.inquiryText as string) || "",
          businessContext: (payload.businessContext as string),
        },
        workspaceId,
        employeeConfig,
      );

    case "generate_invoice":
      return generateInvoice(
        {
          customerName: (payload.customerName as string) || (payload.name as string) || "Customer",
          serviceDescription: (payload.serviceDescription as string) || "",
          amount: (payload.amount as number) || 0,
        },
        workspaceId,
        employeeConfig,
      );

    case "detect_scheduling":
      return detectSchedulingIntent(
        {
          message: (payload.message as string) || "",
        },
        workspaceId,
        employeeConfig,
      );

    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }
}
