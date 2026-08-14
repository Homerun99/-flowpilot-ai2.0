/**
 * Orchestrator AI Backend — powers the client's main chat AI with OpenAI function calling.
 *
 * Uses dynamic imports for all DB/AI dependencies to avoid build-time coupling.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface WorkspaceContext {
  businessName: string;
  businessType?: string;
  fromEmail?: string;
  fromName?: string;
  paymentLink?: string;
}

export interface ToolCallResult {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export interface OrchestratorResponse {
  reply: string;
  toolCalls: ToolCallResult[];
}

// ── OpenAI Tool Definitions ──────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "search_knowledge",
      description:
        "Search the business's knowledge base (uploaded documents, policies, pricing, FAQs) for relevant information. Use this to answer questions about company policies, services, or stored data.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query to find relevant knowledge" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_leads",
      description: "List leads for the business, optionally filtered by status. Returns a summary of each lead (name, score, status, date).",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["new", "contacted", "qualified", "proposal", "won", "lost"],
            description: "Optional status filter. If omitted, returns all leads.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "score_lead",
      description: "Score and qualify a lead based on their name and inquiry message. Returns a score (1-100), reasoning, and suggested action.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The lead's name" },
          message: { type: "string", description: "The lead's inquiry or message content" },
        },
        required: ["name", "message"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generate_invoice",
      description: "Generate a draft invoice for a customer. Returns the invoice number, email body, and line items.",
      parameters: {
        type: "object",
        properties: {
          customerName: { type: "string", description: "Customer name for the invoice" },
          serviceDescription: { type: "string", description: "Description of the service provided" },
          amount: { type: "number", description: "Total amount in dollars (e.g. 500 for $500)" },
        },
        required: ["customerName", "serviceDescription", "amount"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_email",
      description:
        "Send an email from the business's branded address. Use this for follow-ups, introductions, thank-yous, or general communication. The email will come from the business's configured email.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Complete, ready-to-send email body. Write the full email as the business owner — include a proper greeting, the message, and a signature with the business name. Do NOT use placeholder brackets like [Your Name] or [Company] — use the actual business name you know from context." },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_invoice_pdf",
      description:
        "Generate an invoice, create a PDF, and email it to the customer. Use this when the customer needs to receive the invoice by email. Returns a confirmation message.",
      parameters: {
        type: "object",
        properties: {
          customerName: { type: "string", description: "Customer name" },
          customerEmail: { type: "string", description: "Customer email address to send the PDF to" },
          serviceDescription: { type: "string", description: "Description of the service" },
          amount: { type: "number", description: "Total amount in dollars" },
          paymentLink: { type: "string", description: "Optional payment link (Stripe Payment Link, PayPal.Me, Venmo) to include as a Pay Now button in the invoice email and PDF. If omitted, the workspace's default payment link is used." },
        },
        required: ["customerName", "customerEmail", "serviceDescription", "amount"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_invoices",
      description: "List invoices for the business, optionally filtered by status. Returns invoice summaries (customer, amount, status, date).",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["draft", "sent", "paid", "overdue", "cancelled"],
            description: "Optional status filter",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_appointments",
      description: "List upcoming appointments. Optionally filter by date.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Optional date filter in YYYY-MM-DD format" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generate_proposal",
      description: "Generate a professional business proposal for a lead. Returns the proposal title and sections.",
      parameters: {
        type: "object",
        properties: {
          leadName: { type: "string", description: "The lead or client name" },
          serviceType: { type: "string", description: "Type of service being proposed (e.g. 'roof replacement', 'legal consultation')" },
        },
        required: ["leadName", "serviceType"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_dashboard_stats",
      description:
        "Get a snapshot of the business dashboard: total leads, invoices, appointments, automations, and leads by status. Use for 'how are we doing' or 'give me an overview' questions.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_automations",
      description: "List the enabled AI automations for the workspace. Returns each automation's name, trigger, and action.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "add_to_knowledge",
      description:
        "Store new information in the business's knowledge base. Use when the owner says things like 'remember that...', 'note this down...', or shares information they want saved.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "A short title for the knowledge entry" },
          content: { type: "string", description: "The content to store" },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_recent_activity",
      description: "List the most recent activity log entries for the workspace. Use for 'what happened recently' or 'show me the activity' questions.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of entries to return (default 10, max 50)" },
        },
      },
    },
  },
];

// ── System Prompt Builder ────────────────────────────────────────────────────

function buildSystemPrompt(ctx: WorkspaceContext): string {
  const name = ctx.businessName || "your business";
  const type = ctx.businessType || "business";
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `You are the AI operations manager for ${name}, a ${type}. Your job is to help the business owner run their company efficiently. You can:
- Answer questions using their knowledge base (uploaded documents, policies, pricing)
- Check on leads, invoices, appointments, and automations
- Create invoices, score leads, generate proposals
- Store new information in their knowledge base when asked
- Give honest status updates — never fabricate data

Be concise and professional. When you don't know something, say so and suggest what information you'd need.
The current date is ${today}.`;
}

// ── Function Dispatcher ──────────────────────────────────────────────────────

async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  workspaceId: string,
  ctx: WorkspaceContext,
): Promise<unknown> {
  switch (name) {
    case "search_knowledge": {
      const { searchKnowledgeBase } = await import("./ai-employees");
      const results = await searchKnowledgeBase(args.query as string, workspaceId);
      return results.slice(0, 3);
    }

    case "list_leads": {
      const { db } = await import("~/db/index");
      const { leads } = await import("~/db/schema");
      const { eq, and, desc } = await import("drizzle-orm");

      const conditions = [eq(leads.workspaceId, workspaceId)];
      if (args.status) {
        conditions.push(eq(leads.status, args.status as string));
      }

      const result = await db.query.leads.findMany({
        where: and(...conditions),
        columns: { id: true, name: true, email: true, status: true, score: true, createdAt: true },
        orderBy: desc(leads.createdAt),
        limit: 50,
      });

      return {
        count: result.length,
        leads: result.map((l) => ({
          name: l.name,
          email: l.email,
          status: l.status,
          score: l.score,
          created: l.createdAt?.toISOString().split("T")[0],
        })),
      };
    }

    case "score_lead": {
      const { scoreLead } = await import("./ai-employees");
      return scoreLead(
        { name: args.name as string, message: args.message as string },
        workspaceId,
      );
    }

    case "generate_invoice": {
      const { generateInvoice } = await import("./ai-employees");
      return generateInvoice(
        {
          customerName: args.customerName as string,
          serviceDescription: args.serviceDescription as string,
          amount: args.amount as number,
        },
        workspaceId,
      );
    }

    case "send_invoice_pdf": {
      const { generateInvoice } = await import("./ai-employees");
      const { generateInvoicePdf } = await import("./pdf-invoice");
      const { sendEmail } = await import("./email");

      const inv = await generateInvoice(
        {
          customerName: args.customerName as string,
          serviceDescription: args.serviceDescription as string,
          amount: args.amount as number,
        },
        workspaceId,
      );

      // Resolve payment link: per-call first, fall back to workspace default
      const paymentLink = (args.paymentLink as string)?.trim() || ctx.paymentLink || undefined;

      const businessName = ctx.businessName || ctx.fromName || "FlowPilot AI";
      const pdfBuffer = await generateInvoicePdf({
        invoice: inv,
        businessName,
        customerName: args.customerName as string,
        paymentInstructions: undefined,
        paymentLink,
      });

      const fromEmail = ctx.fromEmail || "noreply@klerkitai.com";
      const fromAddress = ctx.fromName
        ? `${ctx.fromName} <${fromEmail}>`
        : fromEmail;

      // Build email body — include Pay Now button when a payment link exists
      let emailHtml = `<html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">`;
      emailHtml += inv.emailBody.replace(/\n/g, "<br>");
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

      await sendEmail({
        to: args.customerEmail as string,
        from: fromAddress,
        subject: `Invoice ${inv.invoiceNumber} from ${businessName}`,
        body: emailHtml,
        attachments: [
          {
            content: pdfBuffer.toString("base64"),
            filename: `Invoice-${inv.invoiceNumber}.pdf`,
            type: "application/pdf",
            disposition: "attachment",
          },
        ],
      });

      return { success: true, invoiceNumber: inv.invoiceNumber, message: `Invoice ${inv.invoiceNumber} sent to ${args.customerEmail}` };
    }

    case "send_email": {
      if (!ctx.fromEmail) {
        return { error: "No email configured for this workspace. Please set up your email in Admin Settings first." };
      }

      const { sendEmail } = await import("./email");

      const senderName = ctx.fromName || ctx.businessName;
      const from = `${senderName} <${ctx.fromEmail}>`;
      const result = await sendEmail({
        to: args.to as string,
        from,
        subject: args.subject as string,
        body: args.body as string,
      });

      return { success: true, messageId: result.messageId, message: `Email sent to ${args.to} from ${ctx.fromEmail}` };
    }

    case "list_invoices": {
      const { db } = await import("~/db/index");
      const { invoices } = await import("~/db/schema");
      const { eq, and, desc } = await import("drizzle-orm");

      const conditions = [eq(invoices.workspaceId, workspaceId)];
      if (args.status) {
        conditions.push(eq(invoices.status, args.status as string));
      }

      const result = await db.query.invoices.findMany({
        where: and(...conditions),
        columns: { id: true, customerName: true, amountCents: true, status: true, dueDate: true, createdAt: true },
        orderBy: desc(invoices.createdAt),
        limit: 50,
      });

      return {
        count: result.length,
        invoices: result.map((inv) => ({
          customerName: inv.customerName,
          amount: `$${(inv.amountCents / 100).toFixed(2)}`,
          status: inv.status,
          dueDate: inv.dueDate?.toISOString().split("T")[0] || null,
          created: inv.createdAt?.toISOString().split("T")[0],
        })),
      };
    }

    case "list_appointments": {
      const { db } = await import("~/db/index");
      const { appointments } = await import("~/db/schema");
      const { eq, and, desc, gte, lte } = await import("drizzle-orm");

      const conditions = [eq(appointments.workspaceId, workspaceId)];
      if (args.date) {
        const dayStart = new Date(args.date as string);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);
        conditions.push(gte(appointments.scheduledAt, dayStart));
        conditions.push(lte(appointments.scheduledAt, dayEnd));
      }

      const result = await db.query.appointments.findMany({
        where: and(...conditions),
        columns: { id: true, title: true, scheduledAt: true, status: true, notes: true },
        orderBy: desc(appointments.scheduledAt),
        limit: 50,
      });

      return {
        count: result.length,
        appointments: result.map((a) => ({
          title: a.title,
          scheduledAt: a.scheduledAt?.toISOString(),
          status: a.status,
          notes: a.notes,
        })),
      };
    }

    case "generate_proposal": {
      const { generateProposal } = await import("./ai-employees");
      return generateProposal(
        { leadName: args.leadName as string, serviceType: args.serviceType as string },
        workspaceId,
      );
    }

    case "get_dashboard_stats": {
      const { db } = await import("~/db/index");
      const { leads, invoices, appointments, automations, automationRuns } = await import("~/db/schema");
      const { eq, sql } = await import("drizzle-orm");

      const [totalLeads, totalInvoices, totalAppointments, totalAutomations, totalRuns, leadsByStatus] =
        await Promise.all([
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(leads)
            .where(eq(leads.workspaceId, workspaceId))
            .then((r) => r[0]?.count ?? 0),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(invoices)
            .where(eq(invoices.workspaceId, workspaceId))
            .then((r) => r[0]?.count ?? 0),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(appointments)
            .where(eq(appointments.workspaceId, workspaceId))
            .then((r) => r[0]?.count ?? 0),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(automations)
            .where(eq(automations.workspaceId, workspaceId))
            .then((r) => r[0]?.count ?? 0),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(automationRuns)
            .where(eq(automationRuns.workspaceId, workspaceId))
            .then((r) => r[0]?.count ?? 0),
          db
            .select({ status: sql<string>`${leads.status}`, count: sql<number>`count(*)::int` })
            .from(leads)
            .where(eq(leads.workspaceId, workspaceId))
            .groupBy(leads.status),
        ]);

      return {
        totalLeads,
        totalInvoices,
        totalAppointments,
        totalAutomations,
        totalAutomationRuns: totalRuns,
        leadsByStatus: Object.fromEntries(leadsByStatus.map((r) => [r.status, r.count])),
      };
    }

    case "list_automations": {
      const { db } = await import("~/db/index");
      const { automations } = await import("~/db/schema");
      const { eq, and } = await import("drizzle-orm");

      const result = await db.query.automations.findMany({
        where: and(eq(automations.workspaceId, workspaceId), eq(automations.enabled, true)),
        columns: { id: true, name: true, triggerType: true, actionType: true },
        limit: 50,
      });

      return {
        count: result.length,
        automations: result.map((a) => ({
          name: a.name,
          trigger: a.triggerType,
          action: a.actionType,
        })),
      };
    }

    case "add_to_knowledge": {
      const { db } = await import("~/db/index");
      const { documents, activityLog } = await import("~/db/schema");

      const docId = crypto.randomUUID();
      const now = new Date();

      await db.insert(documents).values({
        id: docId,
        workspaceId,
        filename: `${args.title as string}.txt`,
        fileType: "text/plain",
        fileSize: (args.content as string).length,
        content: args.content as string,
        metadata: { source: "orchestrator_chat", createdAt: now.toISOString() },
        createdAt: now,
      });

      await db.insert(activityLog).values({
        id: crypto.randomUUID(),
        workspaceId,
        type: "knowledge_added",
        description: `Added to knowledge base: ${args.title}`,
        metadata: { documentId: docId, title: args.title },
        createdAt: now,
      });

      return { success: true, title: args.title, message: `"${args.title}" has been saved to the knowledge base.` };
    }

    case "list_recent_activity": {
      const { db } = await import("~/db/index");
      const { activityLog } = await import("~/db/schema");
      const { eq, desc } = await import("drizzle-orm");

      const limit = Math.min(args.limit as number || 10, 50);

      const result = await db.query.activityLog.findMany({
        where: eq(activityLog.workspaceId, workspaceId),
        columns: { id: true, type: true, description: true, createdAt: true },
        orderBy: desc(activityLog.createdAt),
        limit,
      });

      return {
        count: result.length,
        activities: result.map((a) => ({
          type: a.type,
          description: a.description,
          timestamp: a.createdAt?.toISOString(),
        })),
      };
    }

    default:
      return { error: `Unknown function: ${name}` };
  }
}

// ── Core Orchestrator ────────────────────────────────────────────────────────

export async function chatWithOrchestrator(
  workspaceId: string,
  message: string,
  history: ChatMessage[],
  workspaceContext: WorkspaceContext,
): Promise<OrchestratorResponse> {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    return {
      reply: "I'm currently unavailable — the AI service isn't configured. Please try again later or contact support.",
      toolCalls: [],
    };
  }

  const systemPrompt = buildSystemPrompt(workspaceContext);

  // Build message array for OpenAI
  const messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; name?: string; tool_calls?: unknown }> = [
    { role: "system", content: systemPrompt },
    ...history.slice(-20).map((h) => {
      const msg: { role: "user" | "assistant" | "tool"; content: string; tool_call_id?: string; name?: string } = {
        role: h.role,
        content: h.content,
      };
      if (h.toolCallId) msg.tool_call_id = h.toolCallId;
      if (h.name) msg.name = h.name;
      return msg;
    }),
    { role: "user", content: message },
  ];

  const toolCalls: ToolCallResult[] = [];

  // Loop: up to 5 tool call rounds before requiring a final response
  for (let round = 0; round < 5; round++) {
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages,
          tools: TOOL_DEFINITIONS,
          temperature: 0.3,
          max_tokens: 600,
        }),
      });

      const data = (await resp.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
          finish_reason?: string;
        }>;
      };

      const choice = data.choices?.[0];
      if (!choice) return { reply: "I couldn't process that request. Please try again.", toolCalls: [] };

      const msg = choice.message;

      // If AI returns a text response (no tool calls), return it
      if (!msg?.tool_calls || msg.tool_calls.length === 0) {
        return {
          reply: msg?.content?.trim() || "I'm not sure how to help with that. Could you rephrase?",
          toolCalls,
        };
      }

      // Execute tool calls
      const assistantMsg = {
        role: "assistant" as const,
        content: msg.content || "",
        tool_calls: msg.tool_calls,
      };
      messages.push(assistantMsg as unknown as { role: "system" | "user" | "assistant" | "tool"; content: string });

      for (const tc of msg.tool_calls) {
        const args = JSON.parse(tc.function.arguments);
        let result: unknown;

        try {
          result = await executeToolCall(tc.function.name, args, workspaceId, workspaceContext);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
        }

        toolCalls.push({ name: tc.function.name, args, result });

        messages.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: tc.id,
        });
      }
    } catch (err) {
      console.error("Orchestrator API error:", err);
      return {
        reply: "Sorry, I ran into a technical issue. Please try again.",
        toolCalls,
      };
    }
  }

  // If we've done 5 rounds without a final text response, force one
  try {
    messages.push({ role: "system", content: "Please provide a brief summary of what you've done based on the tool results above." });

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.3,
        max_tokens: 300,
      }),
    });

    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return {
      reply: data.choices?.[0]?.message?.content?.trim() || "Done. Let me know if you need anything else.",
      toolCalls,
    };
  } catch {
    return { reply: "Done. Let me know if you need anything else.", toolCalls };
  }
}
