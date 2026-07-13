/**
 * ticketPdfService.ts
 * ============================================================
 * Ticket PDF Generator — Single Page A4
 * تقرير بلاغ الصيانة في صفحة واحدة A4
 * ============================================================
 */

import { htmlToPdf } from "./htmlToPdfService";
import { storageGetStream } from "../../_core/storage";
import {
  getTicketById,
  getUserById,
  getSiteById,
  getSections,
  getPurchaseOrders,
  getAttachments,
} from "../../_core/db";

/** جلب الصورة من التخزين وتحويلها إلى base64 */
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

/** استرجاع fileKey الصحيح للمرفقات */
function resolveFileKey(a: any): string {
  if (a.fileKey && a.fileKey.startsWith("cmms/")) return a.fileKey;
  try {
    const url = new URL(a.fileUrl, "http://x");
    const recovered = url.searchParams.get("key");
    if (recovered) return decodeURIComponent(recovered);
  } catch {}
  return a.fileKey;
}

function escapeHtml(text: string | null | undefined): string {
  if (!text) return "—";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

const PRIORITY_COLORS: Record<string, string> = {
  low: "#dcfce7;color:#166534",
  medium: "#fef9c3;color:#854d0e",
  high: "#fee2e2;color:#991b1b",
  critical: "#fce7f3;color:#be185d",
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

export async function generateTicketPDF(ticketId: number): Promise<Buffer> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error("Ticket not found");

  // جلب البيانات المرتبطة
  const reportedBy   = ticket.reportedById ? await getUserById(ticket.reportedById) : null;
  const assignedTo   = ticket.assignedToId ? await getUserById(ticket.assignedToId) : null;
  const site         = ticket.siteId ? await getSiteById(ticket.siteId) : null;
  const allSections  = await getSections(ticket.siteId ?? undefined);
  const section      = allSections?.find((s: any) => s.id === ticket.sectionId) || null;

  // جلب الصور (أول 4 فقط للحفاظ على صفحة واحدة)
  const attachments      = await getAttachments("ticket", ticketId);
  const imageAttachments = attachments
    .filter((a: any) => a.mimeType?.startsWith("image/"))
    .slice(0, 4);

  const imageBase64List = await Promise.all(
    imageAttachments.map((a: any) => fileKeyToBase64(resolveFileKey(a)))
  );
  const validImages = imageBase64List.filter(Boolean) as string[];

  // تنسيق التواريخ
  const fmt = (d: any) =>
    d ? new Date(d).toLocaleDateString("ar-SA", { year: "numeric", month: "long", day: "numeric" }) : "—";

  const createdDate = fmt(ticket.createdAt);
  const closedDate  = fmt(ticket.closedAt);

  const priorityStyle = PRIORITY_COLORS[ticket.priority] || "background:#e2e8f0;color:#334155";
  const statusLabel   = escapeHtml(STATUS_LABELS[ticket.status]   || ticket.status);
  const priorityLabel = escapeHtml(PRIORITY_LABELS[ticket.priority] || ticket.priority);
  const categoryLabel = escapeHtml(CATEGORY_LABELS[ticket.category] || ticket.category);

  // بناء شبكة الصور (صفين × عمودين)
  const photosHtml = validImages.length > 0 ? `
  <div>
    <div class="sec-hdr">
      <div class="sec-num">٢</div>
      <div class="sec-title">صور البلاغ</div>
      <div class="sec-line"></div>
    </div>
    <div class="photos-grid">
      ${validImages.map((img, i) => `
        <div class="photo-item">
          <img src="${img}" />
          <div class="photo-caption">صورة ${i + 1}</div>
        </div>
      `).join("")}
    </div>
  </div>` : "";

  const sectionNum = validImages.length > 0 ? "٣" : "٢";

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  @page { size: A4; margin: 0; }

  body {
    font-family: Arial, sans-serif;
    font-size: 12.5px;
    color: #1e293b;
    background: #fff;
    width: 210mm;
    height: 297mm;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* ── HEADER ── */
  .header {
    background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
    color: #fff;
    padding: 11px 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }
  .header-title { font-size: 15px; font-weight: 900; }
  .header-sub { font-size: 10.6px; color: #bfdbfe; margin-top: 2px; }
  .ticket-number {
    background: rgba(255,255,255,0.15);
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: 6px;
    padding: 5px 13px;
    text-align: center;
  }
  .ticket-number .label { font-size: 9.9px; color: #bfdbfe; }
  .ticket-number .value { font-size: 14px; font-weight: 900; letter-spacing: 1px; }

  /* ── STATUS BAR ── */
  .status-bar {
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    padding: 5px 18px;
    display: flex;
    gap: 14px;
    align-items: center;
    flex-shrink: 0;
  }
  .pill {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 9px; border-radius: 20px;
    font-size: 10.6px; font-weight: 700;
  }
  .pill-status { background: #dbeafe; color: #1e40af; }
  .meta { font-size: 10.6px; color: #64748b; }
  .meta b { color: #334155; }

  /* ── CONTENT ── */
  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 8px 18px 6px;
    gap: 6px;
    overflow: hidden;
  }

  /* ── SECTION HEADER ── */
  .sec-hdr { display: flex; align-items: center; gap: 7px; margin-bottom: 4px; }
  .sec-num {
    width: 20px; height: 20px;
    background: #1e40af; color: #fff;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 10.6px; font-weight: 900; flex-shrink: 0;
  }
  .sec-title { font-size: 13.2px; font-weight: 800; color: #1e3a8a; }
  .sec-line { flex: 1; height: 1px; background: #e2e8f0; }

  /* ── MERGED BLOCK (القسمان 1+2 بدون فراغ) ── */
  .merged-block {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    overflow: hidden;
  }
  .merged-inner { display: grid; grid-template-columns: 1fr 1fr; }
  .info-col { padding: 7px 10px; }
  .info-col:first-child { border-left: 1px solid #e2e8f0; }
  .info-col-title {
    font-size: 11.3px; font-weight: 800; color: #1e40af;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 3px; margin-bottom: 4px;
  }
  .info-row { display: flex; justify-content: space-between; margin-bottom: 2.5px; font-size: 11.3px; }
  .info-label { font-weight: 700; color: #64748b; }
  .info-value { color: #1e293b; }
  .desc-row {
    border-top: 1px solid #e2e8f0;
    padding: 6px 10px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .desc-label { font-size: 10.6px; font-weight: 700; color: #64748b; margin-bottom: 3px; }
  .desc-text {
    background: #fff;
    border-right: 2.5px solid #1e40af;
    border-radius: 3px;
    padding: 4px 8px;
    font-size: 11.3px;
    color: #334155;
    line-height: 1.45;
  }

  /* ── PHOTOS ── */
  .photos-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 5px;
  }
  .photo-item { border: 1px solid #e2e8f0; border-radius: 5px; overflow: hidden; }
  .photo-item img { width: 100%; height: 140px; object-fit: contain; display: block; background: #f8fafc; }
  .photo-caption { font-size: 9.3px; color: #64748b; text-align: center; padding: 2px 0; background: #f8fafc; }

  /* ── FIELD BOX (القسم الميداني) ── */
  .field-box {
    background: #fff;
    border: 1.5px solid #1e40af;
    border-radius: 7px;
    padding: 6px 10px;
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .field-title {
    font-size: 13.2px; font-weight: 900; color: #1e3a8a;
    padding-bottom: 4px;
    border-bottom: 1.5px dashed #cbd5e1;
    margin-bottom: 5px;
  }
  .write-lines { flex: 1; display: flex; flex-direction: column; gap: 0; }
  .write-line { border-bottom: 1px dashed #94a3b8; height: 17.6px; }
  .signatures {
    display: flex; justify-content: space-between;
    margin-top: 6px; padding-top: 5px;
    border-top: 1px solid #e2e8f0; gap: 10px;
  }
  .sig-item { flex: 1; text-align: center; }
  .sig-label { font-size: 9.9px; font-weight: 700; color: #64748b; display: block; margin-bottom: 11px; }
  .sig-line { border-bottom: 1.5px solid #334155; width: 80%; margin: 0 auto; }

  /* ── FOOTER ── */
  .footer {
    background: #f1f5f9;
    border-top: 1px solid #e2e8f0;
    padding: 4px 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }
  .footer-text { font-size: 7px; color: #94a3b8; }
  .footer-logo { font-size: 11.3px; font-weight: 900; color: #1e40af; }
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <div>
    <div class="header-title">تقرير بلاغ الصيانة</div>
    <div class="header-sub">نظام إدارة الصيانة المركزية · CMMS</div>
  </div>
  <div class="ticket-number">
    <div class="label">رقم البلاغ</div>
    <div class="value">${escapeHtml(ticket.ticketNumber)}</div>
  </div>
</div>

<!-- STATUS BAR -->
<div class="status-bar">
  <span class="pill pill-status">● ${statusLabel}</span>
  <span class="pill" style="background:${priorityStyle};">▲ ${priorityLabel}</span>
  <span class="pill" style="background:#f0fdf4;color:#166534;">✦ ${categoryLabel}</span>
  <span class="meta">الإنشاء: <b>${createdDate}</b></span>
  <span class="meta">الإغلاق: <b>${closedDate}</b></span>
</div>

<!-- CONTENT -->
<div class="content">

  <!-- القسم 1: تفاصيل البلاغ + وصف المشكلة (مدمجان) -->
  <div>
    <div class="sec-hdr">
      <div class="sec-num">١</div>
      <div class="sec-title">تفاصيل البلاغ ووصف المشكلة</div>
      <div class="sec-line"></div>
    </div>
    <div class="merged-block">
      <div class="merged-inner">
        <div class="info-col">
          <div class="info-col-title">معلومات عامة</div>
          <div class="info-row"><span class="info-label">الحالة</span><span class="info-value">${statusLabel}</span></div>
          <div class="info-row"><span class="info-label">الأولوية</span><span class="info-value">${priorityLabel}</span></div>
          <div class="info-row"><span class="info-label">الفئة</span><span class="info-value">${categoryLabel}</span></div>
          <div class="info-row"><span class="info-label">تاريخ الإغلاق</span><span class="info-value">${closedDate}</span></div>
        </div>
        <div class="info-col">
          <div class="info-col-title">الموقع والأطراف</div>
          <div class="info-row"><span class="info-label">الموقع</span><span class="info-value">${escapeHtml(site?.name || ticket.locationDetail)}</span></div>
          ${section ? `<div class="info-row"><span class="info-label">القسم</span><span class="info-value">${escapeHtml(section.name)}</span></div>` : ""}
          <div class="info-row"><span class="info-label">مقدم البلاغ</span><span class="info-value">${escapeHtml(reportedBy?.name)}</span></div>
          <div class="info-row"><span class="info-label">الفني المسند</span><span class="info-value">${escapeHtml(assignedTo?.name)}</span></div>
        </div>
      </div>
      <div class="desc-row">
        <div>
          <div class="desc-label">العنوان</div>
          <div class="desc-text">${escapeHtml(ticket.title)}</div>
        </div>
        <div>
          <div class="desc-label">الوصف التفصيلي</div>
          <div class="desc-text">${escapeHtml(ticket.description || "لا يوجد وصف إضافي")}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- القسم 2: صور البلاغ (إن وجدت) -->
  ${photosHtml}

  <!-- القسم الميداني -->
  <div class="sec-hdr">
    <div class="sec-num">${sectionNum}</div>
    <div class="sec-title">تسجيل نتيجة الفحص الميداني</div>
    <div class="sec-line"></div>
  </div>

  <div class="field-box">
    <div class="field-title">📋 ملاحظات الفني — تُكتب بعد الفحص في الموقع</div>
    <div class="write-lines">
      <div class="write-line"></div>
      <div class="write-line"></div>
      <div class="write-line"></div>
      <div class="write-line"></div>
      <div class="write-line"></div>
    </div>
    <div class="signatures">
      <div class="sig-item">
        <span class="sig-label">اسم الفني</span>
        <div class="sig-line"></div>
      </div>
      <div class="sig-item">
        <span class="sig-label">التوقيع</span>
        <div class="sig-line"></div>
      </div>
      <div class="sig-item">
        <span class="sig-label">التاريخ</span>
        <div class="sig-line"></div>
      </div>
      <div class="sig-item">
        <span class="sig-label">توقيع المشرف</span>
        <div class="sig-line"></div>
      </div>
    </div>
  </div>

</div>

<!-- FOOTER -->
<div class="footer">
  <div class="footer-text">تم إنشاؤه آلياً · CMMS · ${new Date().toLocaleDateString("ar-SA")} — ${new Date().toLocaleTimeString("ar-SA")}</div>
  <div class="footer-logo">CMMS ⬡</div>
</div>

</body>
</html>`;

  return htmlToPdf(html);
}
