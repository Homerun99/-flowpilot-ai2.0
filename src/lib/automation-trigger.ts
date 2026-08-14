/**
 * Shared automation trigger helper — finds matching automations and dispatches
 * AI actions, recording the results in automation_runs.
 *
 * Use this pattern everywhere an event should fire automations:
 *   POST /api/leads → new_lead
 *   POST /api/webhooks/email/inbound → new_email
 *   POST /api/web-chat → web_chat
 *   POST /api/appointments → appointment_request
 *   Twilio voice webhook → incoming_call
 */
import { db } from "~/db/index";
import { automations, aiEmployees, automationRuns } from "~/db/schema";
import { eq, and } from "drizzle-orm";
import {
  scoreLead,
  processLeadReply,
  generateInvoice,
  detectSchedulingIntent,
  type EmployeeConfig,
} from "~/lib/ai-employees";

export interface TriggerResult {
  automationId: string;
  automationName: string;
  status: "success" | "failure";
  output?: unknown;
  error?: string;
  executionMs: number;
}

/**
 * Fire all enabled automations matching the given trigger type for a workspace.
 * Builds employee config from the DB, dispatches to the right AI function,
 * and records a run in automation_runs.
 */
export async function fireAutomationTrigger(
  workspaceId: string,
  triggerType: string,
  payload: Record<string, unknown>,
): Promise<TriggerResult[]> {
  const matching = await db.query.automations.findMany({
    where: and(
      eq(automations.workspaceId, workspaceId),
      eq(automations.triggerType, triggerType),
      eq(automations.enabled, true),
    ),
  });

  if (matching.length === 0) return [];

  const results: TriggerResult[] = [];

  for (const auto of matching) {
    // Load the AI employee manually to avoid Drizzle relational query issues
    const employee = auto.aiEmployeeId
      ? await db.query.aiEmployees.findFirst({
          where: eq(aiEmployees.id, auto.aiEmployeeId),
        })
      : null;
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
      const output = await dispatchAction(auto.actionType, payload, workspaceId, employeeConfig);

      await db.insert(automationRuns).values({
        id: runId,
        automationId: auto.id,
        workspaceId,
        status: "success",
        input: { trigger_type: triggerType, payload },
        output: output as Record<string, unknown>,
        createdAt: new Date(),
      });

      results.push({
        automationId: auto.id,
        automationName: auto.name,
        status: "success",
        output,
        executionMs: Date.now() - startTime,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[automation-trigger] "${auto.name}" failed:`, errorMessage);

      await db.insert(automationRuns).values({
        id: runId,
        automationId: auto.id,
        workspaceId,
        status: "failure",
        input: { trigger_type: triggerType, payload },
        output: { error: errorMessage },
        createdAt: new Date(),
      });

      results.push({
        automationId: auto.id,
        automationName: auto.name,
        status: "failure",
        error: errorMessage,
        executionMs: Date.now() - startTime,
      });
    }
  }

  return results;
}

/**
 * Route an automation action type to the correct AI function.
 */
async function dispatchAction(
  actionType: string,
  payload: Record<string, unknown>,
  workspaceId: string,
  employeeConfig?: EmployeeConfig,
): Promise<unknown> {
  const p = payload as Record<string, string | number | undefined>;
  switch (actionType) {
    case "score_lead":
      return scoreLead(
        {
          name: (p.name as string) || "Unknown",
          source: p.source as string | undefined,
          message: (p.message as string) || (p.notes as string) || "",
        },
        workspaceId,
        employeeConfig,
      );

    case "generate_reply":
      return processLeadReply(
        {
          leadName: (p.name as string) || "Customer",
          inquiryText: (p.message as string) || (p.inquiryText as string) || "",
          businessContext: p.businessContext as string | undefined,
        },
        workspaceId,
        employeeConfig,
      );

    case "generate_invoice":
      return generateInvoice(
        {
          customerName: (p.customerName as string) || (p.name as string) || "Customer",
          serviceDescription: (p.serviceDescription as string) || "",
          amount: (p.amount as number) || 0,
        },
        workspaceId,
        employeeConfig,
      );

    case "detect_scheduling":
      return detectSchedulingIntent(
        {
          message: (p.message as string) || "",
        },
        workspaceId,
        employeeConfig,
      );

    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }
}
