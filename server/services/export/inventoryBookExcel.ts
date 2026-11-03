import type ExcelJS from "exceljs";
import type { InventoryBookExportFilters } from "../../../shared/inventory-export";

type Book = {
  id: number; code?: string | null; nameAr?: string | null; nameEn?: string | null; unit?: string | null; pageCount: number;
  totals: Array<{ unit?: string | null; isFrozen?: number | string; quantity?: number | string; incoming?: number | string; outgoing?: number | string }>;
};
type ReadPage = (filters: InventoryBookExportFilters & { afterId: number; limit: number }) => Promise<{ books: Book[]; nextId: number | null }>;

/** Same master selection, order and unit summaries as the warehouse table. */
export async function appendInventoryBookSheet(workbook: ExcelJS.Workbook, filters: InventoryBookExportFilters, readPage: ReadPage) {
  const sheet = workbook.addWorksheet("المخزون");
  sheet.columns = [
    { header: "الصنف", key: "name", width: 38 },
    { header: "الكود", key: "code", width: 20 },
    { header: "الرصيد", key: "quantity", width: 16 },
    { header: "الوحدة", key: "unit", width: 28 },
    { header: "الوارد", key: "incoming", width: 16 },
    { header: "المنصرف", key: "outgoing", width: 16 },
    { header: "السجلات", key: "pageCount", width: 14 },
  ];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B7A4A" } };
  header.height = 30;
  sheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "G1" };

  let afterId = 0;
  const seen = new Set<number>();
  for (;;) {
    const result = await readPage({ ...filters, afterId, limit: 50 });
    for (const book of result.books) {
      // Refuse a shifting/overlapping page instead of silently double-counting it.
      if (seen.has(Number(book.id))) throw Error("تغير ترتيب المخزون أثناء التصدير؛ أعد المحاولة");
      seen.add(Number(book.id));
      const totals = book.totals.length ? book.totals : [{ unit: book.unit, quantity: 0, incoming: 0, outgoing: 0, isFrozen: 0 }];
      for (const total of totals) sheet.addRow({
        name: book.nameAr || book.nameEn || "—", code: book.code || "—",
        quantity: Number(total.quantity || 0),
        unit: `${total.unit || "وحدة غير محددة"}${Number(total.isFrozen) ? " — تاريخ مجمّد" : ""}`,
        incoming: Number(total.incoming || 0), outgoing: Number(total.outgoing || 0), pageCount: Number(book.pageCount || 0),
      });
    }
    if (result.nextId == null) break;
    if (!result.books.length || result.nextId <= afterId) throw Error("تعذر تحميل بقية المخزون للتصدير");
    afterId = result.nextId;
  }
  sheet.eachRow((row, index) => {
    row.alignment = { vertical: "middle", horizontal: index === 1 ? "center" : "right", wrapText: true };
    if (index > 1) row.height = 24;
  });
  for (const key of ["quantity", "incoming", "outgoing"]) sheet.getColumn(key).eachCell((cell, rowNumber) => {
    if (rowNumber > 1 && typeof cell.value === "number") {
      cell.numFmt = Number.isInteger(cell.value) ? "#,##0" : "#,##0.###";
    }
  });
}
