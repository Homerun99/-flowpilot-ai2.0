import OpenAI from "openai";
import { db } from "~/db/index";
import { activityLog, documents } from "~/db/schema";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { chunkText, parseDocument } from "~/lib/document-parser";

// ── OpenAI client singleton ──────────────────────────────────────────────

let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }
    _openai = new OpenAI({ apiKey });
  }
  return _openai;
}

const MODEL = "gpt-4o-mini";

// ── Interfaces ───────────────────────────────────────────────────────────

export interface EmployeeConfig {
  name: string;
  personality: string;
  temperature: number;
  instructions: string;
}

export interface LeadReplyInput {
  leadName: string;
  inquiryText: string;
  businessContext?: string;
  /** Optional abort signal — the voice/email paths cap AI calls at ~6s. */
  signal?: AbortSignal;
}

export interface LeadReplyOutput {
  subject: string;
  body: string;
}

export interface LeadScoreInput {
  name: string;
  source?: string;
  message: string;
  /** Optional abort signal — caps the call at ~6s on time-sensitive paths. */
  signal?: AbortSignal;
}

export interface LeadScoreOutput {
  score: number;
  reasoning: string;
  suggestedAction: string;
}

export interface InvoiceInput {
  customerName: string;
  serviceDescription: string;
  amount: number;
}

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InvoiceOutput {
  invoiceNumber: string;
  emailBody: string;
  lineItems: LineItem[];
}

export interface SchedulingIntentInput {
  message: string;
}

export interface SchedulingIntentOutput {
  wantsAppointment: boolean;
  preferredDates: string[];
  notes: string;
}

export interface ProposalInput {
  leadName: string;
  companyName?: string;
  serviceType: string;
  additionalNotes?: string;
}

export interface ProposalSection {
  heading: string;
  body: string;
}

export interface ProposalOutput {
  title: string;
  sections: ProposalSection[];
}

// ── Knowledge Base types ─────────────────────────────────────────────────

export interface KnowledgeBaseSearchResult {
  docId: string;
  title: string;
  filename: string;
  snippet: string;
  relevanceScore: number;
}

// ── Activity logging helper ──────────────────────────────────────────────

async function logActivity(
  workspaceId: string,
  type: string,
  description: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(activityLog).values({
      id: randomUUID(),
      workspaceId,
      type,
      description,
      metadata: metadata ?? null,
    });
  } catch (err) {
    console.error("[ai-employees] Failed to log activity:", err);
  }
}

// ── 1. Email Agent: processLeadReply ─────────────────────────────────────

export async function processLeadReply(
  input: LeadReplyInput,
  workspaceId: string,
  employeeConfig?: EmployeeConfig,
): Promise<LeadReplyOutput> {
  const openai = getOpenAI();
  const businessNote = input.businessContext
    ? `\nBusiness context: ${input.businessContext}`
    : "";

  const baseSystemPrompt =
    "You are a professional email agent for a small business. " +
    "Write helpful, concise, and warm email replies to customer inquiries. " +
    "Always return a JSON object with exactly two fields: " +
    '"subject" (a short email subject line) and "body" (the full email body).';

  const systemPrompt = employeeConfig
    ? `${baseSystemPrompt}\n\nYour name is ${employeeConfig.name}. Personality: ${employeeConfig.personality}. ${employeeConfig.instructions}`
    : baseSystemPrompt;

  const temperature = employeeConfig?.temperature ?? 0.7;

  const userPrompt =
    `Lead name: ${input.leadName}\n` +
    `Inquiry: ${input.inquiryText}` +
    businessNote +
    "\n\nGenerate a professional reply email in JSON format.";

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature,
    },
    { signal: input.signal });

    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error("OpenAI returned empty response");

    const parsed = JSON.parse(raw) as LeadReplyOutput;
    if (!parsed.subject || !parsed.body) {
      throw new Error("OpenAI response missing subject or body");
    }

    await logActivity(workspaceId, "email_agent", `Generated reply for ${input.leadName}`, {
      leadName: input.leadName,
      subject: parsed.subject,
    });

    return parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse OpenAI JSON response: ${(err as Error).message}`);
    }
    throw err;
  }
}

// ── 2. Lead Scorer: scoreLead ────────────────────────────────────────────

export async function scoreLead(
  input: LeadScoreInput,
  workspaceId: string,
  employeeConfig?: EmployeeConfig,
): Promise<LeadScoreOutput> {
  const openai = getOpenAI();

  const baseSystemPrompt =
    "You are a lead scoring expert for a small business. " +
    "Evaluate leads based on their inquiry quality, specificity, budget signals, " +
    "urgency, and fit. Score from 1 (low quality / spam) to 100 (ready to buy). " +
    "Always return a JSON object with exactly three fields: " +
    '"score" (integer 1-100), "reasoning" (2-3 sentence explanation), ' +
    'and "suggestedAction" (one of: "contact_immediately", "follow_up", "nurture", "ignore").';

  const systemPrompt = employeeConfig
    ? `${baseSystemPrompt}\n\nYour name is ${employeeConfig.name}. Personality: ${employeeConfig.personality}. ${employeeConfig.instructions}`
    : baseSystemPrompt;

  const temperature = employeeConfig?.temperature ?? 0.3;

  const userPrompt =
    `Lead name: ${input.name}\n` +
    `Source: ${input.source || "unknown"}\n` +
    `Message: ${input.message}\n\n` +
    "Score this lead and return JSON.";

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature,
    },
    { signal: input.signal });

    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error("OpenAI returned empty response");

    const parsed = JSON.parse(raw) as LeadScoreOutput;
    if (typeof parsed.score !== "number" || !parsed.reasoning || !parsed.suggestedAction) {
      throw new Error("OpenAI response missing required fields (score, reasoning, suggestedAction)");
    }

    // Clamp score to 1-100 range
    parsed.score = Math.max(1, Math.min(100, Math.round(parsed.score)));

    await logActivity(workspaceId, "lead_scorer", `Scored lead ${input.name}: ${parsed.score}/100`, {
      leadName: input.name,
      score: parsed.score,
      suggestedAction: parsed.suggestedAction,
    });

    return parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse OpenAI JSON response: ${(err as Error).message}`);
    }
    throw err;
  }
}

// ── 2b. Email Summarizer: summarizeEmail ────────────────────────────
/**
 * Plain-English 1-3 sentence summary of an inbound customer email: what they
 * want + any action items. Used by the email-inbox pipeline; hard 6s timeout
 * like the rest of the time-sensitive AI paths.
 */
export async function summarizeEmail(
  input: { text: string; subject?: string },
  workspaceId: string,
  signal?: AbortSignal,
): Promise<{ summary: string }> {
  const openai = getOpenAI();
  const systemPrompt =
    "You are a sharp administrative assistant for a small business. " +
    "Read the inbound customer email and produce a 1-3 sentence plain-English " +
    "summary of what the customer wants plus any action items the business needs " +
    'to take. Return a JSON object with exactly one field: "summary".'
  const userPrompt =
    `Subject: ${input.subject || "(none)"}\n\nEmail body:\n${input.text}\n\n` +
    "Summarize this email in JSON format.";
  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    },
    { signal });
    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error("OpenAI returned empty response");
    const parsed = JSON.parse(raw) as { summary?: string };
    if (!parsed.summary) throw new Error("OpenAI response missing summary field");
    await logActivity(workspaceId, "email_agent", "Summarized inbound customer email", {
      summary: parsed.summary.slice(0, 200),
    });
    return { summary: parsed.summary };
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse OpenAI JSON response: ${(err as Error).message}`);
    }
    throw err;
  }
}

// ── 3. Invoice Clerk: generateInvoice ────────────────────────────────────

export async function generateInvoice(
  input: InvoiceInput,
  workspaceId: string,
  employeeConfig?: EmployeeConfig,
): Promise<InvoiceOutput> {
  const openai = getOpenAI();

  const baseSystemPrompt =
    "You are an invoice clerk for a small business. " +
    "Generate professional invoice summaries and email bodies. " +
    "Always return a JSON object with exactly three fields: " +
    '"invoiceNumber" (a formatted invoice number like INV-2026-XXXX), ' +
    '"emailBody" (a professional email body requesting payment), ' +
    'and "lineItems" (an array of objects with description, quantity, unitPrice, and total). ' +
    "Use the service description and amount provided to create at least one line item. " +
    "The line items should total to the provided amount.";

  const systemPrompt = employeeConfig
    ? `${baseSystemPrompt}\n\nYour name is ${employeeConfig.name}. Personality: ${employeeConfig.personality}. ${employeeConfig.instructions}`
    : baseSystemPrompt;

  const temperature = employeeConfig?.temperature ?? 0.5;

  const userPrompt =
    `Customer: ${input.customerName}\n` +
    `Service: ${input.serviceDescription}\n` +
    `Amount: $${input.amount.toFixed(2)}\n\n` +
    "Generate an invoice with email body in JSON format.";

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature,
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error("OpenAI returned empty response");

    const parsed = JSON.parse(raw) as InvoiceOutput;
    if (!parsed.invoiceNumber || !parsed.emailBody || !Array.isArray(parsed.lineItems)) {
      throw new Error("OpenAI response missing required fields (invoiceNumber, emailBody, lineItems)");
    }

    await logActivity(workspaceId, "invoice_clerk", `Generated invoice ${parsed.invoiceNumber} for ${input.customerName}`, {
      customerName: input.customerName,
      invoiceNumber: parsed.invoiceNumber,
      amount: input.amount,
    });

    return parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse OpenAI JSON response: ${(err as Error).message}`);
    }
    throw err;
  }
}

// ── 4. Scheduler: detectSchedulingIntent ─────────────────────────────────

export async function detectSchedulingIntent(
  input: SchedulingIntentInput,
  workspaceId: string,
  employeeConfig?: EmployeeConfig,
): Promise<SchedulingIntentOutput> {
  const openai = getOpenAI();

  const baseSystemPrompt =
    "You are a scheduling assistant for a small business. " +
    "Analyze incoming messages to detect if the sender wants to schedule an appointment. " +
    "Always return a JSON object with exactly three fields: " +
    '"wantsAppointment" (boolean), ' +
    '"preferredDates" (array of strings — dates/times the person mentioned, empty if none), ' +
    'and "notes" (a brief summary of the scheduling request or reason for non-scheduling).';

  const systemPrompt = employeeConfig
    ? `${baseSystemPrompt}\n\nYour name is ${employeeConfig.name}. Personality: ${employeeConfig.personality}. ${employeeConfig.instructions}`
    : baseSystemPrompt;

  const temperature = employeeConfig?.temperature ?? 0.2;

  const userPrompt =
    `Message: ${input.message}\n\n` +
    "Analyze for scheduling intent and return JSON.";

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature,
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error("OpenAI returned empty response");

    const parsed = JSON.parse(raw) as SchedulingIntentOutput;
    if (typeof parsed.wantsAppointment !== "boolean") {
      throw new Error("OpenAI response missing required field: wantsAppointment");
    }
    if (!Array.isArray(parsed.preferredDates)) {
      parsed.preferredDates = [];
    }
    if (!parsed.notes) {
      parsed.notes = "";
    }

    await logActivity(workspaceId, "scheduler", parsed.wantsAppointment
      ? `Detected scheduling intent with ${parsed.preferredDates.length} preferred date(s)`
      : "No scheduling intent detected",
      { wantsAppointment: parsed.wantsAppointment, preferredDates: parsed.preferredDates },
    );

    return parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse OpenAI JSON response: ${(err as Error).message}`);
    }
    throw err;
  }
}

// ── 5. Proposal Generator: generateProposal ──────────────────────────────

export async function generateProposal(
  input: ProposalInput,
  workspaceId: string,
): Promise<ProposalOutput> {
  const openai = getOpenAI();

  const systemPrompt =
    "You are a proposal writer for a small business. " +
    "Generate professional business proposals. " +
    "Always return a JSON object with exactly two fields: " +
    '"title" (a compelling proposal title) and ' +
    '"sections" (an array of objects, each with "heading" and "body" fields). ' +
    "Include these standard sections: Executive Summary, Scope of Work, Timeline, " +
    "Pricing Overview, and Next Steps. Tailor content to the specific service type and lead.";

  const companyNote = input.companyName ? `\nCompany: ${input.companyName}` : "";
  const extraNote = input.additionalNotes ? `\nAdditional notes: ${input.additionalNotes}` : "";

  const userPrompt =
    `Lead: ${input.leadName}` +
    companyNote +
    `\nService type: ${input.serviceType}` +
    extraNote +
    "\n\nGenerate a proposal in JSON format.";

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.6,
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error("OpenAI returned empty response");

    const parsed = JSON.parse(raw) as ProposalOutput;
    if (!parsed.title || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
      throw new Error("OpenAI response missing required fields (title, sections)");
    }

    await logActivity(workspaceId, "proposal_generator", `Generated proposal "${parsed.title}" for ${input.leadName}`, {
      leadName: input.leadName,
      serviceType: input.serviceType,
      sectionCount: parsed.sections.length,
    });

    return parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse OpenAI JSON response: ${(err as Error).message}`);
    }
    throw err;
  }
}

// ── 6. Knowledge Base RAG: searchKnowledgeBase ───────────────────────────

const MAX_CHUNKS_TO_EMBED = 20;

/**
 * Compute cosine similarity between two vectors of equal dimension.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Basic keyword-matching scorer used as fallback when embeddings aren't available.
 * Returns a relevance score for each chunk.
 */
function keywordScore(query: string, chunks: { text: string }[]): number[] {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return chunks.map((chunk) => {
    const lower = chunk.text.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      score += lower.split(term).length - 1;
    }
    return score;
  });
}

/** Extract a short snippet from text around the query terms */
function extractSnippet(text: string, query: string, maxLen = 200): string {
  const lower = text.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  let firstMatch = text.length;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && idx < firstMatch) firstMatch = idx;
  }
  if (firstMatch === text.length) return text.slice(0, maxLen) + (text.length > maxLen ? "…" : "");
  const start = Math.max(0, firstMatch - Math.floor(maxLen / 2));
  const end = Math.min(text.length, firstMatch + Math.floor(maxLen / 2));
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet += "…";
  return snippet;
}

/**
 * Search the knowledge base for documents relevant to the query.
 *
 * Queries the `documents` table for the workspace. Uses OpenAI embeddings +
 * cosine similarity for semantic search when OPENAI_API_KEY is available,
 * falling back to keyword matching otherwise. Returns the top 3 most
 * relevant chunks with their source filenames.
 */
export async function searchKnowledgeBase(
  query: string,
  workspaceId: string,
): Promise<KnowledgeBaseSearchResult[]> {
  if (!query.trim()) return [];

  // 1. Fetch all documents for the workspace from the database
  const docs = await db
    .select()
    .from(documents)
    .where(eq(documents.workspaceId, workspaceId));

  if (docs.length === 0) {
    await logActivity(workspaceId, "knowledge_search", `No documents in KB — query: "${query.slice(0, 100)}"`, {
      query,
      resultCount: 0,
    }).catch(() => {});
    return [];
  }

  // 2. Chunk each document
  interface ChunkWithMeta {
    docId: string;
    title: string;
    filename: string;
    text: string;
  }
  const allChunks: ChunkWithMeta[] = [];

  for (const doc of docs) {
    const content = doc.content || "";
    if (!content.trim()) continue;
    const chunks = chunkText(content);
    for (const chunk of chunks) {
      allChunks.push({
        docId: doc.id,
        title: doc.filename,
        filename: doc.filename,
        text: chunk.text,
      });
    }
  }

  if (allChunks.length === 0) return [];

  // 3. Search: embeddings if available, otherwise keyword
  let scored: KnowledgeBaseSearchResult[];

  const hasApiKey = !!process.env.OPENAI_API_KEY;
  if (hasApiKey) {
    try {
      scored = await semanticSearch(query, allChunks);
    } catch (err) {
      console.warn("[searchKnowledgeBase] Embedding search failed, falling back to keyword:", err);
      scored = keywordSearch(query, allChunks);
    }
  } else {
    scored = keywordSearch(query, allChunks);
  }

  // 4. Return top 3
  const top3 = scored.slice(0, 3);

  await logActivity(workspaceId, "knowledge_search", `Searched KB for: "${query.slice(0, 100)}"`, {
    query,
    resultCount: top3.length,
    topResult: top3[0]?.title ?? null,
    method: hasApiKey ? "embeddings" : "keyword",
  }).catch(() => {});

  return top3;
}

async function semanticSearch(
  query: string,
  chunks: { docId: string; title: string; filename: string; text: string }[],
): Promise<KnowledgeBaseSearchResult[]> {
  const openai = getOpenAI();
  const targetChunks = chunks.slice(0, MAX_CHUNKS_TO_EMBED);

  // Generate query embedding
  const queryEmbedResp = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });
  const queryEmbedding = queryEmbedResp.data[0].embedding;

  // Generate chunk embeddings in one batch
  const chunkEmbedResp = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: targetChunks.map((c) => c.text),
  });

  const results: KnowledgeBaseSearchResult[] = targetChunks.map((chunk, i) => {
    const similarity = cosineSimilarity(queryEmbedding, chunkEmbedResp.data[i].embedding);
    return {
      docId: chunk.docId,
      title: chunk.title,
      filename: chunk.filename,
      snippet: extractSnippet(chunk.text, query),
      relevanceScore: Math.round(similarity * 100),
    };
  });

  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return results;
}

function keywordSearch(
  query: string,
  chunks: { docId: string; title: string; filename: string; text: string }[],
): KnowledgeBaseSearchResult[] {
  const scores = keywordScore(query, chunks);
  const results: KnowledgeBaseSearchResult[] = chunks.map((chunk, i) => ({
    docId: chunk.docId,
    title: chunk.title,
    filename: chunk.filename,
    snippet: extractSnippet(chunk.text, query),
    relevanceScore: scores[i],
  }));
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return results.filter((r) => r.relevanceScore > 0);
}

// ── 7. Document Ingestion ─────────────────────────────────────────────────

/**
 * Ingest a document: parse its file from disk and update the `content`
 * field in the `documents` table.
 *
 * Called by the upload API after a file is saved to disk and a document
 * record is created. Reads the file, parses it with the appropriate parser
 * based on its `fileType`, and writes the extracted text back to the DB.
 *
 * @param documentId The ID of the document record in the database
 * @param workspaceId The workspace the document belongs to
 */
export async function ingestDocument(
  documentId: string,
  workspaceId: string,
): Promise<void> {
  // Look up the document record to get the file path and type
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId));

  if (!doc) {
    throw new Error(`Document "${documentId}" not found`);
  }

  // The file path can be stored in metadata or derived from a convention.
  // Platform Architect / upload API should store the file path in metadata.filePath.
  const filePath = (doc.metadata as Record<string, unknown> | null)?.filePath as string | undefined;
  if (!filePath) {
    throw new Error(`Document "${documentId}" has no filePath in metadata`);
  }

  // Parse the document
  const extractedText = await parseDocument(filePath, doc.fileType);

  // Update the content field
  await db
    .update(documents)
    .set({ content: extractedText })
    .where(eq(documents.id, documentId));

  await logActivity(workspaceId, "document_ingest", `Ingested document "${doc.filename}" (${doc.fileType})`, {
    documentId,
    filename: doc.filename,
    fileType: doc.fileType,
    contentLength: extractedText.length,
  }).catch(() => {});
}

/**
 * Compute an embedding vector for a text string using OpenAI's text-embedding-3-small.
 * Returns a number[] suitable for storage in a vector column (e.g., pgvector).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const openai = getOpenAI();
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}
