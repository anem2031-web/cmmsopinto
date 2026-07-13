import ExcelJS from "exceljs";
import * as db from "../../_core/db";
import { htmlToPdf } from "../pdf/htmlToPdfService";

// ============================================================
// EXCEL EXPORT HELPERS
// ============================================================

function styleHeader(worksheet: ExcelJS.Worksheet) {
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B7A4A" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };
  headerRow.height = 30;
  worksheet.columns.forEach(col => {
    col.width = Math.max(col.width || 15, 15);
  });
}

function addRtlSupport(worksheet: ExcelJS.Worksheet) {
  worksheet.views = [{ rightToLeft: true }];
}

// ============================================================
// TICKETS EXPORT
// ============================================================
export async function exportTicketsToExcel(): Promise<Buffer> {
  const tickets = await db.getTickets();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CMMS";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("البلاغات");
  addRtlSupport(ws);

  ws.columns = [
    { header: "رقم البلاغ", key: "id", width: 12 },
    { header: "العنوان", key: "title", width: 35 },
    { header: "الوصف", key: "description", width: 45 },
    { header: "الحالة", key: "status", width: 18 },
    { header: "الأولوية", key: "priority", width: 15 },
    { header: "الفئة", key: "category", width: 18 },
    { header: "الموقع", key: "siteId", width: 12 },
    { header: "تاريخ الإنشاء", key: "createdAt", width: 22 },
  ];
  styleHeader(ws);

  const statusMap: Record<string, string> = {
    open: "مفتوح", in_progress: "قيد التنفيذ", pending_approval: "بانتظار الاعتماد",
    pending_quote: "بانتظار التسعير", pending_po: "بانتظار طلب شراء",
    pending_funding: "بانتظار التمويل", closed: "مغلق", rejected: "مرفوض",
  };
  const priorityMap: Record<string, string> = {
    low: "منخفضة", medium: "متوسطة", high: "عالية", critical: "حرجة",
  };
  const categoryMap: Record<string, string> = {
    electrical: "كهرباء", plumbing: "سباكة", hvac: "تكييف", structural: "إنشائي",
    elevator: "مصاعد", fire_safety: "سلامة", cleaning: "نظافة", other: "أخرى",
  };

  tickets.forEach(t => {
    ws.addRow({
      id: t.id,
      title: t.title,
      description: t.description,
      status: statusMap[t.status] || t.status,
      priority: priorityMap[t.priority] || t.priority,
      category: categoryMap[t.category] || t.category,
      siteId: t.siteId,
      createdAt: new Date(t.createdAt).toLocaleString("ar-SA"),
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================
// PURCHASE ORDERS EXPORT
// ============================================================
export async function exportPurchaseOrdersToExcel(): Promise<Buffer> {
  const pos = await db.getPurchaseOrders();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CMMS";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("طلبات الشراء");
  addRtlSupport(ws);

  ws.columns = [
    { header: "رقم الطلب", key: "poNumber", width: 18 },
    { header: "الملاحظات", key: "notes", width: 40 },
    { header: "الحالة", key: "status", width: 18 },
    { header: "التكلفة المقدرة", key: "estimated", width: 18 },
    { header: "التكلفة الفعلية", key: "actual", width: 18 },
    { header: "تاريخ الإنشاء", key: "createdAt", width: 22 },
  ];
  styleHeader(ws);

  const poStatusMap: Record<string, string> = {
    draft: "مسودة", pending_approval: "بانتظار الاعتماد", approved: "معتمد",
    quoted: "تم التسعير", funded: "تم التمويل", purchased: "تم الشراء",
    received: "تم الاستلام", rejected: "مرفوض", cancelled: "ملغي",
  };

  pos.forEach(po => {
    ws.addRow({
      poNumber: po.poNumber,
      notes: po.notes || "-",
      status: poStatusMap[po.status] || po.status,
      estimated: parseFloat(po.totalEstimatedCost || "0"),
      actual: parseFloat(po.totalActualCost || "0"),
      createdAt: new Date(po.createdAt).toLocaleString("ar-SA"),
    });
  });

  // Format currency columns
  ws.getColumn("estimated").numFmt = '#,##0.00 "ر.س"';
  ws.getColumn("actual").numFmt = '#,##0.00 "ر.س"';

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================
// TECHNICIAN PERFORMANCE EXPORT
// ============================================================
export async function exportTechnicianPerformanceToExcel(filters?: { dateFrom?: Date; dateTo?: Date }): Promise<Buffer> {
  const data = await db.getTechnicianPerformance(filters);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CMMS";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("أداء الفنيين");
  addRtlSupport(ws);

  ws.columns = [
    { header: "اسم الفني", key: "name", width: 25 },
    { header: "البلاغات المسندة", key: "assigned", width: 18 },
    { header: "المكتملة", key: "completed", width: 15 },
    { header: "نسبة الإنجاز", key: "completionRate", width: 18 },
    { header: "متوسط وقت الحل (ساعة)", key: "avgTime", width: 25 },
    { header: "درجة الأداء", key: "score", width: 18 },
  ];
  styleHeader(ws);

  data.forEach((t: any) => {
    ws.addRow({
      name: t.name,
      assigned: t.assignedTickets,
      completed: t.completedTickets,
      completionRate: `${t.completionRate}%`,
      avgTime: t.avgResolutionTime,
      score: t.performanceScore,
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================
// AUDIT LOG EXPORT
// ============================================================
export async function exportAuditLogToExcel(filters?: any): Promise<Buffer> {
  const logs = await db.getAuditLogsEnhanced(filters);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CMMS";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("سجل التدقيق");
  addRtlSupport(ws);

  ws.columns = [
    { header: "التاريخ", key: "date", width: 22 },
    { header: "المستخدم", key: "user", width: 20 },
    { header: "الإجراء", key: "action", width: 18 },
    { header: "نوع الكيان", key: "entityType", width: 18 },
    { header: "رقم الكيان", key: "entityId", width: 12 },
    { header: "الوصف", key: "description", width: 45 },
    { header: "القيم القديمة", key: "oldValues", width: 40 },
    { header: "القيم الجديدة", key: "newValues", width: 40 },
  ];
  styleHeader(ws);

  const actionMap: Record<string, string> = {
    create: "إنشاء", update: "تعديل", delete: "حذف",
    status_change: "تغيير حالة", approve: "اعتماد", reject: "رفض",
    assign: "إسناد", purchase: "شراء", deliver: "توريد",
  };
  const entityMap: Record<string, string> = {
    ticket: "بلاغ", purchase_order: "طلب شراء", po_item: "صنف شراء",
    inventory: "مخزون", site: "موقع", user: "مستخدم",
  };

  logs.forEach((log: any) => {
    ws.addRow({
      date: new Date(log.createdAt).toLocaleString("ar-SA"),
      user: log.userName || `مستخدم #${log.userId}`,
      action: actionMap[log.action] || log.action,
      entityType: entityMap[log.entityType] || log.entityType,
      entityId: log.entityId,
      description: log.description,
      oldValues: log.oldValues ? JSON.stringify(log.oldValues, null, 0) : "",
      newValues: log.newValues ? JSON.stringify(log.newValues, null, 0) : "",
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================
// INVENTORY EXPORT
// ============================================================
export async function exportInventoryToExcel(): Promise<Buffer> {
  const items = await db.getInventoryItems();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CMMS";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("المخزون");
  addRtlSupport(ws);

  ws.columns = [
    { header: "اسم الصنف", key: "name", width: 30 },
    { header: "رقم القطعة", key: "partNumber", width: 18 },
    { header: "الكمية", key: "quantity", width: 12 },
    { header: "الحد الأدنى", key: "minQuantity", width: 15 },
    { header: "الوحدة", key: "unit", width: 12 },
    { header: "الموقع", key: "location", width: 20 },
    { header: "تاريخ الإضافة", key: "createdAt", width: 22 },
  ];
  styleHeader(ws);

  items.forEach((item: any) => {
    ws.addRow({
      name: item.itemName,
      partNumber: item.partNumber || "-",
      quantity: item.quantity,
      minQuantity: item.minQuantity,
      unit: item.unit,
      location: item.location || "-",
      createdAt: new Date(item.createdAt).toLocaleString("ar-SA"),
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================
// PREVENTIVE MAINTENANCE EXPORT - تصدير الصيانة الوقائية
// ============================================================
export async function exportPreventivePlansToExcel(): Promise<Buffer> {
  const plans = await db.listPreventivePlans();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CMMS";
  workbook.created = new Date();
  const ws = workbook.addWorksheet("خطط الصيانة الوقائية");
  addRtlSupport(ws);
  ws.columns = [
    { header: "رقم الخطة", key: "planNumber", width: 15 },
    { header: "العنوان", key: "title", width: 35 },
    { header: "التكرار", key: "frequency", width: 15 },
    { header: "الحالة", key: "isActive", width: 12 },
    { header: "موعد التنفيذ القادم", key: "nextDueDate", width: 22 },
    { header: "المدة التقديرية (دقيقة)", key: "estimatedDuration", width: 22 },
    { header: "عدد بنود التحقق", key: "checklistCount", width: 18 },
    { header: "تاريخ الإنشاء", key: "createdAt", width: 22 },
  ];
  styleHeader(ws);
  const freqMap: Record<string, string> = {
    daily: "يومي", weekly: "أسبوعي", monthly: "شهري",
    quarterly: "ربع سنوي", biannual: "نصف سنوي", annual: "سنوي",
  };
  plans.forEach((p: any) => {
    ws.addRow({
      planNumber: p.planNumber,
      title: p.title,
      frequency: freqMap[p.frequency] || p.frequency,
      isActive: p.isActive !== false ? "نشط" : "متوقف",
      nextDueDate: p.nextDueDate ? new Date(p.nextDueDate).toLocaleDateString("ar-SA") : "-",
      estimatedDuration: p.estimatedDurationMinutes || "-",
      checklistCount: Array.isArray(p.checklist) ? p.checklist.length : 0,
      createdAt: new Date(p.createdAt).toLocaleString("ar-SA"),
    });
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function exportPMWorkOrdersToExcel(): Promise<Buffer> {
  const workOrders = await db.listPMWorkOrders();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CMMS";
  workbook.created = new Date();
  const ws = workbook.addWorksheet("أوامر العمل الوقائية");
  addRtlSupport(ws);
  ws.columns = [
    { header: "رقم أمر العمل", key: "workOrderNumber", width: 18 },
    { header: "العنوان", key: "title", width: 35 },
    { header: "الحالة", key: "status", width: 15 },
    { header: "تاريخ الجدولة", key: "scheduledDate", width: 20 },
    { header: "تاريخ الإنجاز", key: "completedDate", width: 20 },
    { header: "ملاحظات الفني", key: "technicianNotes", width: 40 },
    { header: "صورة إتمام العمل", key: "completionPhoto", width: 18 },
    { header: "تاريخ الإنشاء", key: "createdAt", width: 22 },
  ];
  styleHeader(ws);
  const statusMap: Record<string, string> = {
    scheduled: "مجدول", in_progress: "جاري", completed: "مكتمل",
    overdue: "متأخر", cancelled: "ملغي",
  };
  workOrders.forEach((wo: any) => {
    ws.addRow({
      workOrderNumber: wo.workOrderNumber,
      title: wo.title,
      status: statusMap[wo.status] || wo.status,
      scheduledDate: wo.scheduledDate ? new Date(wo.scheduledDate).toLocaleDateString("ar-SA") : "-",
      completedDate: wo.completedDate ? new Date(wo.completedDate).toLocaleDateString("ar-SA") : "-",
      technicianNotes: wo.technicianNotes || "-",
      completionPhoto: wo.completionPhotoUrl ? "مرفوعة" : "-",
      createdAt: new Date(wo.createdAt).toLocaleString("ar-SA"),
    });
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================
// DELEGATE PURCHASING ITEMS — PDF EXPORT (ACTIVE ITEMS ONLY)
// Rendering engine: Puppeteer (Chromium) via htmlToPdfService
// Active statuses: pending, estimated, approved, purchased
// Excluded: delivered_to_warehouse, delivered_to_requester, rejected, funded
// Security: scoped strictly to the logged-in delegate's own items
// ============================================================
const DELEGATE_ACTIVE_STATUSES = new Set(["pending", "estimated", "approved", "purchased"]);

export async function generateDelegateItemsPDF(delegateId: number): Promise<Buffer> {
  const allItems = await db.getPOItemsByDelegate(delegateId);

  // STRICT FILTER: active items only for this delegate
  const activeItems = (allItems as any[]).filter((item: any) =>
    DELEGATE_ACTIVE_STATUSES.has(item.status)
  );

  // Enrich each item with PO number and requesting department
  const enriched = await Promise.all(
    activeItems.map(async (item: any) => {
      const po = item.purchaseOrderId ? await db.getPurchaseOrderById(item.purchaseOrderId) : null;
      let department = "-";
      if (po?.requestedById) {
        const requester = await db.getUserById(po.requestedById);
        department = requester?.department || "-";
      }
      return { ...item, poNumber: po?.poNumber ?? "-", department };
    })
  );

  // Calculate grand total
  let grandTotal = 0;
  const rows = enriched.map((item: any) => {
    const unitCost = parseFloat(item.estimatedUnitCost || item.actualUnitCost || "0");
    const qty = item.quantity || 1;
    const rowTotal = unitCost * qty;
    grandTotal += rowTotal;
    return {
      poNumber:   item.poNumber,
      itemName:   item.itemName  || "-",
      qty:        String(qty),
      unit:       item.unit      || "-",
      department: item.department,
      unitCost:   unitCost > 0 ? unitCost.toLocaleString("en-SA", { minimumFractionDigits: 2 }) : "-",
      rowTotal:   rowTotal > 0  ? rowTotal.toLocaleString("en-SA",  { minimumFractionDigits: 2 }) : "-",
    };
  });

  const generatedDate = new Date().toLocaleDateString("en-GB");
  const totalFormatted = grandTotal.toLocaleString("en-SA", { minimumFractionDigits: 2 });

  // Build HTML — Chromium handles Arabic, English, RTL/LTR, and mixed text natively
  const rowsHtml = rows.map((r, i) => `
    <tr class="${i % 2 === 0 ? "even" : "odd"}">
      <td>${escapeHtml(r.poNumber)}</td>
      <td class="item-name">${escapeHtml(r.itemName)}</td>
      <td>${escapeHtml(r.qty)}</td>
      <td class="item-name">${escapeHtml(r.unit)}</td>
      <td class="item-name">${escapeHtml(r.department)}</td>
      <td>${escapeHtml(r.unitCost)}</td>
      <td>${escapeHtml(r.rowTotal)}</td>
    </tr>
  `).join("");

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Active Purchasing Items</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;700&family=Noto+Sans:wght@400;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Noto Sans Arabic', 'Noto Sans', Arial, sans-serif;
      font-size: 11px;
      color: #1e293b;
      background: #fff;
      padding: 0;
    }
    .header {
      background: #1e40af;
      color: #fff;
      padding: 16px 20px;
      margin-bottom: 16px;
    }
    .header h1 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
    .header p  { font-size: 10px; color: #bfdbfe; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }
    thead tr {
      background: #1e40af;
      color: #fff;
    }
    thead th {
      padding: 7px 6px;
      text-align: center;
      font-weight: 700;
      border: 1px solid #1e3a8a;
    }
    tbody tr.even { background: #f8fafc; }
    tbody tr.odd  { background: #fff; }
    tbody td {
      padding: 6px 6px;
      border: 1px solid #e2e8f0;
      text-align: center;
      vertical-align: middle;
    }
    /* Item name, unit, department: preserve unicode direction automatically */
    .item-name {
      text-align: start;
      unicode-bidi: plaintext;
      direction: auto;
    }
    .total-row {
      background: #1e40af;
      color: #fff;
      font-weight: 700;
      font-size: 11px;
    }
    .total-row td {
      padding: 8px 6px;
      border: 1px solid #1e3a8a;
    }
    .footer {
      margin-top: 12px;
      font-size: 9px;
      color: #64748b;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Active Purchasing Items Report</h1>
    <p>Active items only &nbsp;|&nbsp; Generated: ${generatedDate} &nbsp;|&nbsp; Items: ${rows.length}</p>
  </div>
  <table>
    <thead>
      <tr>
        <th>PO #</th>
        <th>Item Name</th>
        <th>Qty</th>
        <th>Unit</th>
        <th>Department</th>
        <th>Unit Cost (SAR)</th>
        <th>Total (SAR)</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr class="total-row">
        <td colspan="6" style="text-align:end; padding-inline-end:12px;">Total</td>
        <td>${escapeHtml(totalFormatted)} SAR</td>
      </tr>
    </tbody>
  </table>
  <div class="footer">
    Excluded: completed, delivered to warehouse, delivered to requester, rejected
  </div>
</body>
</html>`;

  return htmlToPdf(html);
}

/** Escape HTML special characters to prevent XSS in generated report */
function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


// ============================================================
// PURCHASE REQUEST PDF EXPORT (SINGLE REQUEST)
// Rendering engine: Puppeteer (Chromium) via htmlToPdfService
// Security: scoped to authenticated delegate's own request
// ============================================================

// ============================================================
// تفقيط: تحويل مبلغ رقمي إلى صيغة مكتوبة بالعربي (لمستند طلب العهدة)
// ============================================================
const AR_ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
const AR_TEENS = ["عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const AR_TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const AR_HUNDREDS = ["", "مائة", "مئتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

function threeDigitsToArabicWords(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h > 0) parts.push(AR_HUNDREDS[h]);
  if (rem > 0) {
    if (rem < 10) parts.push(AR_ONES[rem]);
    else if (rem < 20) parts.push(AR_TEENS[rem - 10]);
    else {
      const t = Math.floor(rem / 10);
      const o = rem % 10;
      parts.push(o > 0 ? `${AR_ONES[o]} و${AR_TENS[t]}` : AR_TENS[t]);
    }
  }
  return parts.join(" و");
}

// كلمة المقياس (ألف/آلاف، مليون/ملايين...) بصيغتها المفردة/المثنى/الجمع المناسبة للعدد
function arabicScaleWord(n: number, singular: string, dual: string, plural: string): string {
  if (n === 1) return singular;
  if (n === 2) return dual;
  if (n >= 3 && n <= 10) return `${threeDigitsToArabicWords(n)} ${plural}`;
  return `${threeDigitsToArabicWords(n)} ${singular}`;
}

/** تحويل رقم صحيح إلى كتابة عربية كاملة (يدعم حتى المليارات) */
export function numberToArabicWords(amount: number): string {
  const intPart = Math.floor(Math.abs(amount));
  if (intPart === 0) return "صفر";

  const billions = Math.floor(intPart / 1_000_000_000);
  const millions = Math.floor((intPart % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((intPart % 1_000_000) / 1000);
  const rest = intPart % 1000;

  const segments: string[] = [];
  if (billions > 0) segments.push(arabicScaleWord(billions, "مليار", "ملياران", "مليارات"));
  if (millions > 0) segments.push(arabicScaleWord(millions, "مليون", "مليونان", "ملايين"));
  if (thousands > 0) segments.push(arabicScaleWord(thousands, "ألف", "ألفان", "آلاف"));
  if (rest > 0) segments.push(threeDigitsToArabicWords(rest));

  return segments.join(" و");
}

/** جملة كاملة جاهزة للطباعة: "(ألفان وثمانمائة ريال فقط لا غير)" */
export function amountToArabicCurrencyPhrase(amount: number): string {
  const abs = Math.abs(amount);
  const intPart = Math.floor(abs);
  const halalas = Math.round((abs - intPart) * 100);
  let phrase = `${numberToArabicWords(intPart)} ريال`;
  if (halalas > 0) {
    phrase += ` و${threeDigitsToArabicWords(halalas)} هللة`;
  }
  return `(${phrase} فقط لا غير)`;
}

/** تنسيق رقم بصيغة "1,400.00" (أرقام لاتينية + فاصلة آلاف + خانتين عشريتين) */
function fmtSAR(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ============================================================
// PURCHASE REQUEST PDF EXPORT (SINGLE REQUEST)
// Rendering engine: Puppeteer (Chromium) via htmlToPdfService
// Security: scoped to authenticated delegate's own request
// تصميم: "طلب مشتريات وصرف عهدة مالية" — شركة تولان الدولية
// ============================================================

export async function generatePurchaseRequestPDF(
  purchaseOrderId: number,
  delegateId: number,
  batchId?: number
): Promise<Buffer> {
  // Fetch PO and items
  const po = await db.getPurchaseOrderById(purchaseOrderId);
  if (!po) throw new Error("Purchase Request not found");

  const allItemsRaw = await db.getPOItems(purchaseOrderId);
  if (!allItemsRaw || allItemsRaw.length === 0) throw new Error("No items found for this request");

  // ── لو تم تحديد دفعة معينة، اقتصر على أصنافها فقط (لطلب عهدة مرتبط بدفعة محددة) ──
  // ولو لم تُحدَّد دفعة، يشمل المستند كل أصناف الطلب (حالة تسعير الطلب كاملاً دفعة واحدة)
  let batch: any = null;
  let allItems = allItemsRaw as any[];
  if (batchId) {
    batch = await db.getPOPricingBatchById(batchId);
    if (!batch || batch.purchaseOrderId !== purchaseOrderId) throw new Error("Pricing batch not found for this request");
    allItems = (allItemsRaw as any[]).filter((item: any) => item.batchId === batchId);
    if (allItems.length === 0) throw new Error("No items found for this batch");
  }

  // Verify delegate owns at least one item in this PO
  const delegateItems = (allItems as any[]).filter((item: any) => item.delegateId === delegateId);
  const requestingUser = await db.getUserById(delegateId);
  const canViewAll = ["admin", "owner", "maintenance_manager", "purchase_manager", "accountant"].includes(requestingUser?.role || "");
  if (delegateItems.length === 0 && !canViewAll) throw new Error("Access denied: not your request");

  // المندوب لا يحتاج يشوف صفوف اعتماد الحسابات/الرئيس التنفيذي ولا قسم الشؤون المالية
  // بنسخته من المستند — هذي أقسام داخلية خاصة بدورة الاعتماد المحاسبي فقط
  const isDelegateViewer = requestingUser?.role === "delegate";

  // تقليل ارتفاع صفوف الجداول بنسبة 10% للنسخة الكاملة (دور الحسابات وما بعده) —
  // نسخة المندوب تبقى بالارتفاع الأصلي.
  const rowPad = (isDelegateViewer ? 4 : 3.6) * 0.9 * 0.95;
  const sigPadH = isDelegateViewer ? 8 : 7.2;
  const sigRowHeight = (isDelegateViewer ? 24 : 21.6) * 0.9 * 0.95;
  // تكبير حجم الخط بنسبة 20% لنسخة الحسابات وما بعدها فقط — بدون أي تأثير على ارتفاع الصفوف
  const FS = (basePt: number) => isDelegateViewer ? basePt : +(basePt * 1.2).toFixed(2);
  // تخصيصات صف "الرئيس التنفيذي" بس (بدون تأثير على صف "رئيس الحسابات" جنبه)
  const ceoFontSize = +(FS(8.55) * 1.2).toFixed(2);      // +20% فوق حجم خط باقي الجدول
  const ceoRowHeight = +(sigRowHeight * 1.2).toFixed(2); // +20% فوق ارتفاع باقي صفوف الجدول
  const ceoTableMarginBottom = +(8.55 * 0.65).toFixed(2); // تخفيض 35% من الهامش المعياري

  // "مستلم العهدة" لازم يكون دايماً اسم المندوب اللي سعّر فعلياً — مش اسم اللي بيحمّل
  // الملف حاليًا (قد يكون الحسابات أو مدير يفتح نفس المستند لاحقاً). لو الدفعة محددة،
  // مصدر الحقيقة هو submittedById بالدفعة نفسها. لو مفيش دفعة (تسعير الطلب كاملاً)،
  // نستخدم المندوب لو كل الأصناف بنفس المندوب، وإلا نرجع لسلوك سابق كحل احتياطي.
  let pricingDelegateId: number | null = null;
  if (batch?.submittedById) {
    pricingDelegateId = batch.submittedById;
  } else {
    const distinctDelegateIds = Array.from(new Set(
      (allItems as any[]).map((item: any) => item.delegateId).filter((id: any) => !!id)
    ));
    if (distinctDelegateIds.length === 1) pricingDelegateId = distinctDelegateIds[0];
  }

  // Get delegate user info — نفس المندوب هو "مستلم العهدة" بهذا المستند
  const delegate = pricingDelegateId
    ? await db.getUserById(pricingDelegateId)
    : await db.getUserById(delegateId); // احتياطي: طلب بأصناف من عدة مندوبين بلا دفعة محددة
  const delegateName = delegate?.name || "-";

  const requester = po.requestedById ? await db.getUserById(po.requestedById) : null;
  const reviewer = po.reviewedById ? await db.getUserById(po.reviewedById) : null;
  // اسم موظف الحسابات اللي اعتمد فعلياً — من الدفعة لو محددة، وإلا من الطلب كامل
  const accountingApproverId = batch?.accountingApprovedById || po.accountingApprovedById;
  const accountingApprover = accountingApproverId ? await db.getUserById(accountingApproverId) : null;

  const requesterName = requester?.name || "-";
  const reviewerName = reviewer?.name || "-";
  const accountingApproverName = accountingApprover?.name || "";

  // Calculate totals + بناء صفوف الجدول
  let grandTotal = 0;
  const rows = (allItems as any[]).map((item: any, idx: number) => {
    const unitCost = parseFloat(item.estimatedUnitCost || item.actualUnitCost || "0");
    const qty = item.quantity || 1;
    const rowTotal = unitCost * qty;
    grandTotal += rowTotal;
    return {
      serial: idx + 1,
      itemName: item.itemName || "-",                            // المادة المطلوبة
      qty: String(qty),
      unit: item.unit || "-",
      unitCost,
      rowTotal,
    };
  });

  // مبلغ العهدة المعتمد للدفعة (لو موجود) — وإلا الإجمالي الكلي المحسوب من الأصناف
  // مبلغ العهدة اللي الحسابات كتبته فعلياً وقت الاعتماد — بدون أي قيمة افتراضية بديلة
  // (يبقى null لو الدفعة لسه ما اعتمدتهاش الحسابات، فيفضل الحقل فاضياً للتعبئة اليدوية)
  const accountingCustodyAmount = batch?.custodyAmount ? parseFloat(batch.custodyAmount) : null;

  const docDate = batch?.submittedAt ? new Date(batch.submittedAt) : new Date();
  const dateStr = `${docDate.getFullYear()}-${String(docDate.getMonth() + 1).padStart(2, "0")}-${String(docDate.getDate()).padStart(2, "0")} م`;

  const rowsHtml = rows.map(r => `
      <tr>
        <td>${r.serial}</td>
        <td style="text-align: right;">${escapeHtml(r.itemName)}</td>
        <td>${r.qty}</td>
        <td>${escapeHtml(r.unit)}</td>
        <td>${r.unitCost > 0 ? fmtSAR(r.unitCost) + " ر.س" : "—"}</td>
        <td>${fmtSAR(r.rowTotal)} ر.س</td>
      </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>طلب مشتريات وصرف عهدة مالية - شركة تولان الدولية</title>
    <style>
        *, *::before, *::after { box-sizing: border-box; }
        @page { size: A4; margin: 5mm 12mm; background-color: #fafbfc; }
        body {
            margin: 0; padding: 0;
            font-family: 'Times New Roman', serif;
            color: #2d3748;
            background-color: #fafbfc;
            line-height: 1.154;
            font-size: ${FS(9)}pt;
        }
        .header-container { border-bottom: 2px solid #2b6cb0; padding-bottom: 5.13px; margin-bottom: 8.55px; }
        .company-name { font-size: ${FS(13.5)}pt; font-weight: bold; color: #1a365d; margin: 0 0 1.71px 0; }
        .doc-title {
            font-size: ${FS(10.8)}pt; font-weight: bold; color: #2b6cb0; margin: 0;
            background-color: #ebf8ff; display: inline-block; padding: 1.71px 10px; border-radius: 4px;
        }
        .meta-grid { display: table; width: 100%; margin-bottom: 8.55px; border-collapse: separate; border-spacing: 10px 0; }
        .meta-col { display: table-cell; width: 50%; vertical-align: top; }
        .info-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 5.13px 10px; }
        .info-row { display: table; width: 100%; }
        .info-label { display: table-cell; font-weight: bold; color: #4a5568; width: 30%; font-size: ${FS(8.55)}pt; }
        .info-value { display: table-cell; color: #1a202c; width: 70%; font-size: ${FS(9)}pt; }
        .intro-text {
            background-color: #f7fafc; border-right: 4px solid #2b6cb0; padding: 5.13px 10px; margin-bottom: 8.55px;
            font-size: ${FS(8.55)}pt; color: #2d3748;
        }
        table.items-table { width: 100%; border-collapse: collapse; margin-bottom: 8.55px; background: #ffffff; }
        table.items-table th {
            background-color: #2b6cb0; color: #ffffff; font-weight: bold; text-align: center;
            padding: ${rowPad}px; font-size: ${FS(8.55)}pt; border: 1px solid #2b6cb0;
        }
        table.items-table td { border: 1px solid #cbd5e0; padding: ${rowPad}px; text-align: center; font-size: ${FS(8.55)}pt; }
        table.items-table tr:nth-child(even) { background-color: #f7fafc; }
        .total-row { background-color: #ebf8ff !important; font-weight: bold; }
        .total-row td { border-top: 2px solid #2b6cb0 !important; color: #1a365d; }
        .declaration-box {
            background-color: #f0fff4; border: 1px dashed #38a169; color: #22543d;
            padding: 4.28px 10px; border-radius: 4px; margin-bottom: 8.55px; font-size: ${FS(8.1)}pt; font-weight: bold;
        }
        .section-title {
            font-size: ${FS(9.45)}pt; font-weight: bold; color: #1a365d; border-bottom: 1px solid #cbd5e0;
            padding-bottom: 1.71px; margin-top: 6.84px; margin-bottom: 5.13px;
        }
        table.signatures-table { width: 100%; border-collapse: collapse; margin-bottom: 8.55px; background: #ffffff; }
        table.signatures-table th { background-color: #4a5568; color: #ffffff; font-weight: bold; padding: ${rowPad}px; font-size: ${FS(8.1)}pt; border: 1px solid #4a5568; }
        table.signatures-table td { border: 1px solid #cbd5e0; padding: ${rowPad}px ${sigPadH}px; font-size: ${FS(8.55)}pt; height: ${sigRowHeight}px; }
        .finance-section { background-color: #ffffff; border: 1px solid #cbd5e0; border-radius: 6px; padding: 6.84px; margin-bottom: 6.84px; }
        .line-input { margin-bottom: 5.13px; font-size: ${FS(8.55)}pt; }
        .dotted-line { border-bottom: 1px dotted #718096; display: inline-block; min-width: 150px; }
        table.accounting-table { width: 100%; border-collapse: collapse; margin-top: 3.42px; }
        table.accounting-table td { border: 1px solid #cbd5e0; padding: ${rowPad}px; font-size: ${FS(8.1)}pt; width: 25%; }
        table.accounting-table .label { background-color: #edf2f7; font-weight: bold; color: #4a5568; }
        .footer-note {
            font-size: ${FS(7.2)}pt; color: #e53e3e; background-color: #fff5f5; padding: 3.42px 10px;
            border-radius: 4px; border-right: 3px solid #e53e3e; font-weight: bold;
        }
    </style>
</head>
<body>

    <div class="header-container">
        <div class="company-name">شركة تولان الدولية</div>
        <div class="doc-title">طلب مشتريات وصرف عهدة مالية</div>
    </div>

    <div class="meta-grid">
        <div class="meta-col">
            <div class="info-card">
                <div class="info-row">
                    <div class="info-label">التاريخ:</div>
                    <div class="info-value">${dateStr}</div>
                </div>
            </div>
        </div>
        <div class="meta-col">
            <div class="info-card">
                <div class="info-row">
                    <div class="info-label">المبلغ الإجمالي:</div>
                    <div class="info-value" style="font-weight: bold; color: #2b6cb0;">${fmtSAR(grandTotal)} ر.س</div>
                </div>
            </div>
        </div>
    </div>

    <div class="intro-text">
        الرجاء التكرم بالإيعاز لمن يلزم بصرف عُهدة قدرها <strong>${amountToArabicCurrencyPhrase(grandTotal)}</strong>، لتوريد خدمات / شراء الآتي:
    </div>

    <table class="items-table">
        <thead>
            <tr>
                <th style="width: 5%;">م</th>
                <th style="width: 45%;">المادة المطلوبة</th>
                <th style="width: 8%;">الكمية</th>
                <th style="width: 10%;">الوحدة</th>
                <th style="width: 15%;">السعر التقديري</th>
                <th style="width: 17%;">القيمة التقديرية</th>
            </tr>
        </thead>
        <tbody>
            ${rowsHtml}
            <tr class="total-row">
                <td colspan="5" style="text-align: left; padding-left: 15px;">الإجمالي الكلي</td>
                <td>${fmtSAR(grandTotal)} ر.س</td>
            </tr>
        </tbody>
    </table>

    <div class="declaration-box">
        ☑ نحن الموقعين أدناه نؤكد بأن هذه الأصناف لا توجد بالمستودع (خاص بكادر المشتريات).
    </div>

    <div class="section-title">مسار الاعتماد والتوقيعات</div>
    <table class="signatures-table">
        <thead>
            <tr>
                <th style="width: 25%;">الصفة</th>
                <th style="width: 40%;">الاسم</th>
                <th style="width: 35%;">التوقيع / الاعتماد</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td style="font-weight: bold; background-color: #f7fafc;">مقدّم الطلب</td>
                <td>${escapeHtml(requesterName)}</td>
                <td></td>
            </tr>
            <tr>
                <td style="font-weight: bold; background-color: #f7fafc;">مراجع الطلب</td>
                <td>${escapeHtml(reviewerName)}</td>
                <td></td>
            </tr>
            <tr>
                <td style="font-weight: bold; background-color: #f7fafc;">اسم مستلم العهدة</td>
                <td>${escapeHtml(delegateName)}</td>
                <td></td>
            </tr>
            ${isDelegateViewer ? "" : `
            <tr>
                <td style="font-weight: bold; background-color: #f7fafc;">الحسابات</td>
                <td>${escapeHtml(accountingApproverName)}</td>
                <td></td>
            </tr>`}
        </tbody>
    </table>

    ${isDelegateViewer ? "" : `
    <div class="section-title">الشؤون المالية والإجراءات المحاسبية</div>
    <div class="finance-section">
        <div class="line-input">
            المذكور عليه عهدة بمبلغ ${accountingCustodyAmount !== null ? `<strong>${fmtSAR(accountingCustodyAmount)}</strong>` : `<span class="dotted-line"></span>`} ريال.
        </div>
        <div class="line-input">
            ملاحظات مراجع الحسابات: <span class="dotted-line" style="min-width: 320px;"></span>
        </div>
        <table class="signatures-table" style="margin-top: 5.7px; margin-bottom: ${ceoTableMarginBottom}px;">
            <tbody>
                <tr>
                    <td style="font-weight: bold; background-color: #f7fafc; width: 25%;">رئيس الحسابات</td>
                    <td style="width: 40%;"></td>
                    <td style="width: 35%;"></td>
                </tr>
                <tr style="height: ${ceoRowHeight}px;">
                    <td style="font-weight: bold; background-color: #f7fafc; width: 25%; font-size: ${ceoFontSize}pt; height: ${ceoRowHeight}px;">الرئيس التنفيذي</td>
                    <td style="width: 40%; font-size: ${ceoFontSize}pt; height: ${ceoRowHeight}px;">المهندس / زكري بن عبدالله الزكري</td>
                    <td style="width: 35%; height: ${ceoRowHeight}px;"></td>
                </tr>
            </tbody>
        </table>
        <table class="accounting-table">
            <tr>
                <td class="label">رقم سند الصرف</td>
                <td></td>
                <td class="label">التاريخ</td>
                <td></td>
            </tr>
            <tr>
                <td class="label">المبلغ</td>
                <td></td>
                <td class="label">التوقيع</td>
                <td></td>
            </tr>
        </table>
    </div>`}

    <div class="footer-note">
        ملحوظة: أي شرح أو تعليق خارج حقول النموذج لا يُعتمد إلا بتوقيع الرئيس التنفيذي.
    </div>

</body>
</html>`;

  return htmlToPdf(html);
}
