/**
 * ticketPdfService.ts
 * ============================================================
 * Isolated Ticket Report PDF Generator using Puppeteer + HTML.
 *
 * Generates professional, printable PDF reports for maintenance tickets.
 * Supports full Arabic/English mixed content with RTL layout.
 *
 * Architecture: Completely isolated from React UI.
 * Uses htmlToPdfService for rendering.
 * ============================================================
 */

import { htmlToPdf } from "./htmlToPdfService";
import { storageGetStream } from "./storage";
import {
  getTicketById,
  getUserById,
  getSiteById,
  getSections,
  getPurchaseOrders,
  getAttachments
} from "./db";

/**
 * ✅ يجلب الصورة مباشرة من التخزين (iDrive e2) بدل HTTP fetch على الدومين
 * هذا يحل مشكلة عدم ظهور الصور في PDF عند النشر على Railway (دومين خارجي/منفذ مختلف)
 */
async function fileKeyToBase64(fileKey: string): Promise<string | null> {
  try {
    const { stream, contentType } = await storageGetStream(fileKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream as any) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch (error) {
    console.error("Failed to read image from storage:", fileKey, error);
    return null;
  }
}

// Status labels for display
const STATUS_LABELS: Record<string, string> = {
  open: "مفتوح",
  in_progress: "قيد التنفيذ",
  pending_approval: "بانتظار الاعتماد",
  pending_quote: "بانتظار التسعير",
  pending_po: "بانتظار طلب شراء",
  pending_funding: "بانتظار التمويل",
  closed: "مغلق",
  rejected: "مرفوض",
  revision_needed: "يحتاج مراجعة",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "منخفضة",
  medium: "متوسطة",
  high: "عالية",
  critical: "حرجة",
};

const CATEGORY_LABELS: Record<string, string> = {
  electrical: "كهرباء",
  plumbing: "سباكة",
  hvac: "تكييف",
  structural: "إنشائي",
  elevator: "مصاعد",
  fire_safety: "سلامة",
  cleaning: "نظافة",
  other: "أخرى",
};

const PO_STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  pending_approval: "بانتظار الاعتماد",
  approved: "معتمد",
  quoted: "تم التسعير",
  funded: "تم التمويل",
  purchased: "تم الشراء",
  received: "تم الاستلام",
  rejected: "مرفوض",
  cancelled: "ملغي",
  revision_needed: "يحتاج مراجعة",
};

/** Escape HTML special characters to prevent XSS in generated report */
function escapeHtml(text: string | null | undefined): string {
  if (!text) return "-";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function generateTicketPDF(ticketId: number): Promise<Buffer> {
  // Fetch ticket data
  const ticket = await getTicketById(ticketId);

  if (!ticket) throw new Error("Ticket not found");

  console.log("PHOTO URL:", ticket.beforePhotoUrl);

  // Enrich with related data
  const reportedBy = ticket.reportedById ? await getUserById(ticket.reportedById) : null;
  const assignedTo = ticket.assignedToId ? await getUserById(ticket.assignedToId) : null;
  const site = ticket.siteId ? await getSiteById(ticket.siteId) : null;
  const allSections = await getSections(ticket.siteId ?? undefined);
  const section = allSections?.find((s: any) => s.id === ticket.sectionId) || null;
  const allPOs = await getPurchaseOrders();
  const linkedPOs = (allPOs as any[]).filter((po: any) => po.linkedTicketIds?.includes(ticketId)) || [];

  // Format dates
  const createdDate = new Date(ticket.createdAt).toLocaleDateString("ar-SA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const closedDate = ticket.closedAt
    ? new Date(ticket.closedAt).toLocaleDateString("ar-SA", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "-";

  // Build PO table rows if any
  const poRowsHtml =
    linkedPOs.length > 0
      ? linkedPOs
          .map(
            (po: any, i: number) => `
        <tr class="${i % 2 === 0 ? "even" : "odd"}">
          <td>${escapeHtml(po.poNumber)}</td>
          <td>${escapeHtml(PO_STATUS_LABELS[po.status] || po.status)}</td>
          <td>${po.totalEstimatedCost ? Number(po.totalEstimatedCost).toLocaleString("ar-SA") + " ر.س" : "-"}</td>
          <td>${po.totalActualCost ? Number(po.totalActualCost).toLocaleString("ar-SA") + " ر.س" : "-"}</td>
        </tr>
      `
          )
          .join("")
      : '<tr><td colspan="4" style="text-align: center; color: #9ca3af;">لا توجد طلبات شراء مرتبطة</td></tr>';

  // Build HTML document
const attachments = await getAttachments("ticket", ticketId);

const imageAttachments = attachments.filter((a: any) =>
  a.mimeType?.startsWith("image/")
);

const imageBase64List = await Promise.all(
  imageAttachments.map(async (a: any) =>
    // ✅ قراءة مباشرة من التخزين عبر fileKey — لا يعتمد على دومين أو منفذ
    await fileKeyToBase64(a.fileKey)
  )
);
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير البلاغ - ${escapeHtml(ticket.ticketNumber)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;700&family=Noto+Sans:wght@400;700&display=swap');
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Noto Sans Arabic', 'Noto Sans', Arial, sans-serif;
      font-size: 12px;
      color: #1e293b;
      background: #fff;
      padding: 0;
      line-height: 1.6;
      width: 100%;
      max-width: 100%;
      overflow-x: hidden; /* حماية إضافية من قص المحتوى عند الأطراف */
    }
    
    /* Header Banner */
    .header {
      background: linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%);
      color: #fff;
      padding: 20px 24px;
      margin-bottom: 24px;
      border-radius: 4px;
    }
    
    .header-title {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    
    .header-subtitle {
      font-size: 11px;
      color: #bfdbfe;
    }
    
    .header-meta {
      display: flex;
      justify-content: space-between;
      margin-top: 12px;
      font-size: 10px;
      color: #dbeafe;
    }
    
    /* Status Badge */
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-weight: 700;
      font-size: 11px;
      margin-inline-start: 8px;
    }
    
    .status-open { background: #dbeafe; color: #1e40af; }
    .status-in_progress { background: #fed7aa; color: #92400e; }
    .status-closed { background: #dcfce7; color: #166534; }
    .status-pending_approval { background: #fce7f3; color: #be185d; }
    .status-revision_needed { background: #fecaca; color: #991b1b; }
    
    /* Section Header */
    .section-header {
      background: #1e40af;
      color: #fff;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 700;
      margin: 20px 0 12px 0;
      border-radius: 3px;
    }
    
    /* Info Grid */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
    }
    
    .info-box {
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 12px;
      background: #f8fafc;
    }
    
    .info-box h3 {
      font-size: 12px;
      font-weight: 700;
      color: #1e40af;
      margin-bottom: 8px;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 6px;
    }
    
    .info-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 6px;
      font-size: 11px;
    }
    
    .info-label {
      font-weight: 700;
      color: #4b5563;
      min-width: 100px;
    }
    
    .info-value {
      color: #1e293b;
      text-align: start;
      unicode-bidi: plaintext;
      direction: auto;
    }
    
    /* Content Block */
    .content-block {
      margin-bottom: 16px;
    }
    
    .content-label {
      font-weight: 700;
      color: #4b5563;
      font-size: 11px;
      margin-bottom: 6px;
      display: block;
    }
    
    .content-text {
      background: #f1f5f9;
      padding: 10px 12px;
      border-right: 3px solid #1e40af;
      border-radius: 3px;
      font-size: 11px;
      color: #1e293b;
      line-height: 1.5;
      text-align: start;
      unicode-bidi: plaintext;
      direction: auto;
    }
    
    /* Table */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      font-size: 11px;
    }
    
    thead tr {
      background: #1e40af;
      color: #fff;
    }
    
    thead th {
      padding: 8px 6px;
      text-align: center;
      font-weight: 700;
      border: 1px solid #1e3a8a;
    }
    
    tbody tr.even { background: #f8fafc; }
    tbody tr.odd { background: #fff; }
    
    tbody td {
      padding: 7px 6px;
      border: 1px solid #e2e8f0;
      text-align: center;
    }
    
    /* Footer */
    .footer {
      margin-top: 24px;
      padding-top: 12px;
      border-top: 1px solid #e2e8f0;
      font-size: 9px;
      color: #64748b;
      text-align: center;
    }

.photos-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.photo-item {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  overflow: hidden;
  background: #fff;
  padding: 6px;
  page-break-inside: avoid;
}

.photo-item img {
  width: 100%;
  height: 220px;
  object-fit: cover;
  border-radius: 4px;
}

.inspection-box {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 24px;
  min-height: 220px;
}

.inspection-line {
  border-bottom: 1px dashed #94a3b8;
  height: 32px;
}

.inspection-signatures {
  display: flex;
  justify-content: space-between;
  margin-top: 32px;
  gap: 16px;
}

    /* Print-specific adjustments */
@page {
  size: A4;
}

@media print {
  html,
  body {
    width: 100%;
    margin: 0;
    padding: 0;
    background: #fff;
  }

  .header {
    page-break-after: avoid;
  }

  .section-header {
    page-break-after: avoid;
  }

  table,
  .info-box,
  .content-block,
  .inspection-box,
  .photo-item {
    page-break-inside: avoid;
  }

  img {
    max-width: 100%;
    display: block;
  }
}
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="header-title">
      تقرير بلاغ الصيانة
      <span class="status-badge status-${ticket.status}">
        ${escapeHtml(STATUS_LABELS[ticket.status] || ticket.status)}
      </span>
    </div>
    <div class="header-subtitle">نظام إدارة الصيانة المركزية (CMMS)</div>
    <div class="header-meta">
      <span>رقم البلاغ: ${escapeHtml(ticket.ticketNumber)}</span>
      <span>تاريخ الإنشاء: ${createdDate}</span>
    </div>
  </div>

  <!-- Section 1: Ticket Details -->
  <div class="section-header">1. تفاصيل البلاغ</div>
  <div class="info-grid">
    <div class="info-box">
      <h3>معلومات عامة</h3>
      <div class="info-row">
        <span class="info-label">الحالة:</span>
        <span class="info-value">${escapeHtml(STATUS_LABELS[ticket.status] || ticket.status)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">الأولوية:</span>
        <span class="info-value">${escapeHtml(PRIORITY_LABELS[ticket.priority] || ticket.priority)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">الفئة:</span>
        <span class="info-value">${escapeHtml(CATEGORY_LABELS[ticket.category] || ticket.category)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">تاريخ الإغلاق:</span>
        <span class="info-value">${closedDate}</span>
      </div>
    </div>
    
    <div class="info-box">
      <h3>الموقع والأطراف</h3>
      <div class="info-row">
        <span class="info-label">الموقع:</span>
        <span class="info-value">${escapeHtml(site?.name || ticket.locationDetail || "-")}</span>
      </div>
      ${section ? `
      <div class="info-row">
        <span class="info-label">القسم:</span>
        <span class="info-value">${escapeHtml(section.name)}</span>
      </div>
      ` : ""}
      <div class="info-row">
        <span class="info-label">مقدم البلاغ:</span>
        <span class="info-value">${escapeHtml(reportedBy?.name || "-")}</span>
      </div>
      <div class="info-row">
        <span class="info-label">الفني المسند:</span>
        <span class="info-value">${escapeHtml(assignedTo?.name || "-")}</span>
      </div>
    </div>
  </div>

  <!-- Section 2: Problem Description -->
  <div class="section-header">2. وصف المشكلة</div>
  <div class="content-block">
    <span class="content-label">العنوان:</span>
    <div class="content-text">${escapeHtml(ticket.title)}</div>
  </div>
  <div class="content-block">
    <span class="content-label">الوصف التفصيلي:</span>
    <div class="content-text">${escapeHtml(ticket.description || "لا يوجد وصف إضافي")}</div>
  </div>

<!-- Section 3: Ticket Photos -->
${imageBase64List.length > 0 ? `
<div class="section-header">3. صور البلاغ</div>

<div class="photos-grid">
  ${imageBase64List
    .filter(Boolean)
    .map((img) => `
      <div class="photo-item">
        <img src="${img}" />
      </div>
    `)
    .join("")}
</div>
` : ""}

  <!-- Section 4: Inspection Result -->
  <div class="section-header">4. تسجيل نتيجة الفحص</div>

  <div class="inspection-box">
    <div class="inspection-line"></div>
    <div class="inspection-line"></div>
    <div class="inspection-line"></div>
    <div class="inspection-line"></div>
    <div class="inspection-line"></div>

    <div class="inspection-signatures">
      <div>
        <strong>اسم الفني:</strong>
      </div>

      <div>
        <strong>التوقيع:</strong>
      </div>

      <div>
        <strong>التاريخ:</strong>
      </div>
    </div>
  </div>

  <!-- Section 5: Work Execution Details -->
  ${ticket.inspectionNotes || ticket.repairNotes || ticket.materialsUsed ? `
  <div class="section-header">5. تفاصيل التنفيذ</div>

  ${ticket.inspectionNotes ? `
  <div class="content-block">
    <span class="content-label">ملاحظات الفحص:</span>
    <div class="content-text">${escapeHtml(ticket.inspectionNotes)}</div>
  </div>
  ` : ""}

  ${ticket.repairNotes ? `
  <div class="content-block">
    <span class="content-label">ملاحظات الإصلاح:</span>
    <div class="content-text">${escapeHtml(ticket.repairNotes)}</div>
  </div>
  ` : ""}
  ${ticket.materialsUsed ? `
  <div class="content-block">
    <span class="content-label">المواد والمهمات المستخدمة:</span>
    <div class="content-text">${escapeHtml(ticket.materialsUsed)}</div>
  </div>
  ` : ""}
  ` : ""}

  <!-- Section 4: Linked Purchase Orders -->
  ${linkedPOs.length > 0 ? `
  <div class="section-header">4. طلبات الشراء المرتبطة</div>
  <table>
    <thead>
      <tr>
        <th>رقم الطلب</th>
        <th>الحالة</th>
        <th>التكلفة التقديرية</th>
        <th>التكلفة الفعلية</th>
      </tr>
    </thead>
    <tbody>
      ${poRowsHtml}
    </tbody>
  </table>
  ` : ""}

  <!-- Footer -->
  <div class="footer">
    تم إنشاء هذا التقرير آلياً من نظام إدارة الصيانة المركزية (CMMS) بتاريخ ${new Date().toLocaleDateString("ar-SA")} الساعة ${new Date().toLocaleTimeString("ar-SA")}
  </div>
</body>
</html>`;

  return htmlToPdf(html);
}
