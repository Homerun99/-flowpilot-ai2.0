/**
 * PDF Invoice Generator — produces a professional PDF invoice using pdfkit.
 *
 * Takes AI-generated invoice data (InvoiceOutput from ai-employees) plus
 * workspace configuration and returns a Buffer ready for email attachment.
 */
import PDFDocument from "pdfkit";
import type { InvoiceOutput } from "./ai-employees";

export interface PdfInvoiceOptions {
  invoice: InvoiceOutput;
  businessName: string;
  customerName: string;
  customerEmail?: string;
  dueDate?: string;
  paymentInstructions?: string;
  paymentLink?: string;
}

/**
 * Generate a professional PDF invoice and return it as a Buffer.
 */
export function generateInvoicePdf(opts: PdfInvoiceOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const { invoice, businessName, customerName, customerEmail, dueDate, paymentInstructions, paymentLink } = opts;

      const buffers: Buffer[] = [];
      const doc = new PDFDocument({
        size: "A4",
        margin: 60,
        bufferPages: true,
      });

      doc.on("data", (chunk: Buffer) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);

      // ── Colors ──────────────────────────────────────────────
      const primary = "#4338ca"; // indigo-700
      const dark = "#1f2937"; // gray-800
      const medium = "#6b7280"; // gray-500
      const light = "#f3f4f6"; // gray-100
      const border = "#e5e7eb"; // gray-200

      // ── Header ──────────────────────────────────────────────
      doc
        .fontSize(22)
        .font("Helvetica-Bold")
        .fillColor(primary)
        .text(businessName, { continued: false });

      doc.moveDown(0.3);

      // Colored accent line
      doc
        .moveTo(60, doc.y + 4)
        .lineTo(535, doc.y + 4)
        .strokeColor(primary)
        .lineWidth(2)
        .stroke();

      doc.moveDown(1.2);

      // ── INVOICE title + metadata ────────────────────────────
      doc
        .fontSize(28)
        .font("Helvetica-Bold")
        .fillColor(dark)
        .text("INVOICE", { continued: false });

      doc.moveDown(0.5);

      const today = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      const dueStr = dueDate
        ? new Date(dueDate).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : "Upon receipt";

      // Invoice metadata: number + dates in a clean two-column layout
      const metaY = doc.y;
      doc.fontSize(11).font("Helvetica").fillColor(medium);
      doc.text("Invoice Number:", 60, metaY, { width: 130 });
      doc.font("Helvetica-Bold").fillColor(dark).text(invoice.invoiceNumber, 195, metaY, { width: 120 });
      doc.font("Helvetica").fillColor(medium).text("Date:", 330, metaY, { width: 40 });
      doc.font("Helvetica-Bold").fillColor(dark).text(today, 375, metaY, { width: 120 });

      doc.font("Helvetica").fillColor(medium).text("Due Date:", 330, metaY + 18, { width: 60 });
      doc.font("Helvetica-Bold").fillColor(dark).text(dueStr, 395, metaY + 18, { width: 140 });

      doc.moveDown(3);

      // ── Bill To ─────────────────────────────────────────────
      let currentY = doc.y;
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .fillColor(medium)
        .text("BILL TO", 60, currentY);

      doc
        .fontSize(13)
        .font("Helvetica-Bold")
        .fillColor(dark)
        .text(customerName, 60, currentY + 18);

      if (customerEmail) {
        doc
          .fontSize(10)
          .font("Helvetica")
          .fillColor(medium)
          .text(customerEmail, 60, currentY + 36);
      }

      doc.moveDown(4);

      // ── Line Items Table ────────────────────────────────────
      const tableTop = doc.y;
      const colX = { desc: 60, qty: 340, price: 395, total: 470 };
      const colW = { desc: 270, qty: 45, price: 65, total: 80 };

      // Table header background
      doc
        .rect(55, tableTop - 6, 485, 22)
        .fillColor(primary)
        .fill();

      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor("#ffffff");
      doc.text("Description", colX.desc, tableTop - 2, { width: colW.desc });
      doc.text("Qty", colX.qty, tableTop - 2, { width: colW.qty, align: "right" });
      doc.text("Unit Price", colX.price, tableTop - 2, { width: colW.price, align: "right" });
      doc.text("Total", colX.total, tableTop - 2, { width: colW.total, align: "right" });

      // Table rows
      let rowY = tableTop + 24;
      let subtotal = 0;

      const items = invoice.lineItems?.length
        ? invoice.lineItems
        : [{ description: opts.customerName || "Services", quantity: 1, unitPrice: 0, total: 0 }];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Alternating row background
        if (i % 2 === 0) {
          doc
            .rect(55, rowY - 4, 485, 20)
            .fillColor(light)
            .fill();
        }

        doc
          .fontSize(10)
          .font("Helvetica")
          .fillColor(dark);
        doc.text(item.description || "Services", colX.desc, rowY, { width: colW.desc });
        doc.text(String(item.quantity || 1), colX.qty, rowY, { width: colW.qty, align: "right" });
        doc.text(
          new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(item.unitPrice || 0),
          colX.price,
          rowY,
          { width: colW.price, align: "right" },
        );
        doc.font("Helvetica-Bold").text(
          new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(item.total || 0),
          colX.total,
          rowY,
          { width: colW.total, align: "right" },
        );

        subtotal += item.total || 0;
        rowY += 22;
      }

      // ── Totals Section ──────────────────────────────────────
      const totalsX = colX.total;
      const totalsW = colW.total;

      // Divider line
      doc
        .moveTo(350, rowY + 10)
        .lineTo(535, rowY + 10)
        .strokeColor(border)
        .lineWidth(1)
        .stroke();

      rowY += 20;

      doc
        .fontSize(10)
        .font("Helvetica")
        .fillColor(medium);
      doc.text("Subtotal", 350, rowY, { width: 110, align: "right" });
      doc.font("Helvetica").fillColor(dark).text(
        new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(subtotal),
        totalsX,
        rowY,
        { width: totalsW, align: "right" },
      );

      rowY += 20;

      // Simple 10% tax (adjustable)
      const taxRate = 0;
      const tax = subtotal * taxRate;
      doc.font("Helvetica").fillColor(medium);
      doc.text(`Tax (${(taxRate * 100).toFixed(0)}%)`, 350, rowY, { width: 110, align: "right" });
      doc.fillColor(dark).text(
        new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(tax),
        totalsX,
        rowY,
        { width: totalsW, align: "right" },
      );

      rowY += 20;

      const total = subtotal + tax;

      // Total with colored background
      doc
        .rect(340, rowY - 4, 200, 24)
        .fillColor(primary)
        .fill();

      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .fillColor("#ffffff");
      doc.text("TOTAL", 350, rowY + 2, { width: 110, align: "right" });
      doc.text(
        new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(total),
        totalsX,
        rowY + 2,
        { width: totalsW, align: "right" },
      );

      doc.moveDown(5);

      // ── Payment Instructions Footer ─────────────────────────
      const footerY = Math.max(doc.y, rowY + 80);

      doc
        .moveTo(60, footerY - 4)
        .lineTo(535, footerY - 4)
        .strokeColor(border)
        .lineWidth(0.5)
        .stroke();

      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .fillColor(dark)
        .text("Payment Instructions", 60, footerY + 10);

      doc
        .fontSize(10)
        .font("Helvetica")
        .fillColor(medium)
        .text(
          paymentInstructions || "Please remit payment at your earliest convenience.",
          60,
          footerY + 30,
          { width: 475 },
        );

      // Pay online line — only when a payment link exists
      if (paymentLink) {
        doc
          .fontSize(10)
          .font("Helvetica-Bold")
          .fillColor(primary)
          .text("Pay online:", 60, footerY + 50, { width: 90 });

        doc
          .fontSize(10)
          .font("Helvetica")
          .fillColor(primary)
          .text(paymentLink, 155, footerY + 50, { width: 380 });
      }

      // ── Footer ──────────────────────────────────────────────
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor("#9ca3af")
        .text(
          `Generated by FlowPilot AI • ${new Date().toLocaleDateString()}`,
          60,
          doc.page.height - 50,
          { align: "center", width: 475 },
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
