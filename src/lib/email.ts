/**
 * SendGrid email sending utility — powers client-branded email for AI employees.
 *
 * Each workspace configures its own From Name/Email via /api/workspace/email-config.
 * SendGrid handles delivery from the verified sender identity.
 */
import sgMail from "@sendgrid/mail";

// Initialize SendGrid when API key is available
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

export interface Attachment {
  /** Base64-encoded file content */
  content: string;
  /** Display filename for the attachment */
  filename: string;
  /** MIME type, e.g. "application/pdf" */
  type: string;
  /** Content disposition, defaults to "attachment" */
  disposition?: string;
}

export interface SendEmailOptions {
  /** Full sender string, e.g. "Sarah from Apex Roofing <office@apexroofing.com>" */
  from: string;
  to: string;
  subject: string;
  /** HTML supported */
  body: string;
  replyTo?: string;
  /** Optional attachments (PDFs, images, etc.) */
  attachments?: Attachment[];
}

export interface SendEmailResult {
  messageId: string;
}

/**
 * Send an email via SendGrid.
 *
 * Falls back gracefully when SENDGRID_API_KEY is missing (dev/demo mode):
 * logs the email to console instead of failing.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  if (!process.env.SENDGRID_API_KEY) {
    console.log("📧 [SendGrid disabled — no API key] Would send:");
    console.log(`   From: ${opts.from}`);
    console.log(`   To: ${opts.to}`);
    console.log(`   Subject: ${opts.subject}`);
    console.log(`   Body: ${opts.body.slice(0, 200)}...`);
    return { messageId: `demo-${crypto.randomUUID()}` };
  }

  const mail: Record<string, unknown> = {
    from: opts.from,
    to: opts.to,
    subject: opts.subject,
    html: opts.body,
    text: opts.body.replace(/<[^>]*>/g, ""),
    replyTo: opts.replyTo,
  };

  if (opts.attachments?.length) {
    mail.attachments = opts.attachments.map((att) => ({
      content: att.content,
      filename: att.filename,
      type: att.type,
      disposition: att.disposition || "attachment",
    }));
  }

  const [result] = await sgMail.send(mail as sgMail.MailDataRequired);

  return { messageId: result?.headers?.["x-message-id"] || crypto.randomUUID() };
}
