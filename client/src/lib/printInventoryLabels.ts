import QRCode from "qrcode";

export type PrintableInventoryLabel = {
  trackingToken?: string;
  lotCode?: string;
  manufacturerBarcode?: string;
  internalCode?: string;
  itemName: string;
  quantity?: number;
  unit?: string;
  sourceType?: string;
};
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));

/** The print document contains labels only; app layout and global print CSS cannot add pages. */
export function inventoryLabelsHtml(labels: Array<PrintableInventoryLabel & { qrImage: string }>, options?: { hideLotDetails?: boolean }) {
  return `<!doctype html><html lang="ar"><head><meta charset="utf-8"><title>ملصقات المخزون</title><style>
    @page { size: 58mm 38mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: 58mm; font-family: Arial, sans-serif; color: #000; background: #fff; }
    .label { width: 58mm; height: 38mm; padding: 1mm; display: flex; align-items: center; gap: 1mm; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
    .label + .label { break-before: page; page-break-before: always; }
    img { width: 28mm; height: 28mm; flex: 0 0 28mm; }
    .text { min-width: 0; flex: 1; text-align: right; direction: rtl; overflow-wrap: anywhere; }
    .code { font-family: monospace; font-weight: bold; font-size: 10px; direction: ltr; }
    .name { font-size: 10px; line-height: 1.3; max-height: 18mm; overflow: hidden; margin-top: 2px; }
    .meta { font-size: 8px; margin-top: 3px; }
  </style></head><body>${labels.map(label => `<section class="label"><img src="${escape(label.qrImage)}" alt="QR"><div class="text"><div class="code">${escape(label.lotCode || label.manufacturerBarcode || label.internalCode)}</div><div class="name">${escape(label.itemName)}</div>${label.trackingToken && !options?.hideLotDetails ? `<div class="meta">${label.sourceType === "opening_balance" ? "رصيد افتتاحي" : "دفعة استلام"} — ${escape(label.quantity)} ${escape(label.unit)}</div>` : ""}</div></section>`).join("")}</body></html>`;
}

export async function printInventoryLabels(items: PrintableInventoryLabel[], options?: { hideLotDetails?: boolean }) {
  if (items.length === 0) return;
  // Open synchronously from the user's click, before asynchronous QR generation.
  const target = window.open("", "_blank");
  if (!target) throw Error("يرجى السماح بالنوافذ المنبثقة لطباعة الملصقات");
  target.opener = null;
  try {
    const labels = await Promise.all(items.map(async (item, index) => ({ ...item, qrImage: await QRCode.toDataURL(item.trackingToken || item.manufacturerBarcode || item.internalCode || String(index), { width: 240, margin: 1, errorCorrectionLevel: "M" }) })));
    target.document.open(); target.document.write(inventoryLabelsHtml(labels, options)); target.document.close();
    await Promise.all(Array.from(target.document.images).map(image => image.decode()));
    target.addEventListener("afterprint", () => target.close(), { once: true });
    target.focus(); target.print();
  } catch (error) { target.close(); throw error; }
}
