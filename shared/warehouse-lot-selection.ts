import { z } from "zod";

export const warehouseLotSelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("fifo") }).strict(),
  z
    .object({
      mode: z.literal("manual"),
      lots: z
        .array(
          z
            .object({
              lotId: z.number().int().positive(),
              quantity: z.number().int().positive(),
            })
            .strict()
        )
        .min(1)
        .max(100),
    })
    .strict(),
]);
export type WarehouseLotSelection = z.infer<typeof warehouseLotSelectionSchema>;
export type WarehouseLotOption = {
  lotId: number;
  quantity: number;
  unit: string;
  lotCode?: string;
  inventoryId?: number;
  createdAt?: string;
  receivedAt?: string;
  originalPerUnit?: number;
  coverageKey?: string;
  coverageLimit?: number;
};

/** Fresh server-owned options are mandatory. Never trust a client's unit, ratio or balance. */
export function selectFullIssueLots<T extends WarehouseLotOption>(
  options: T[],
  required: number,
  unit: string,
  raw: WarehouseLotSelection = { mode: "fifo" }
): Array<T & { quantity: number }> {
  const selection = warehouseLotSelectionSchema.parse(raw);
  if (!Number.isFinite(required) || required <= 0)
    throw Error("الاحتياج غير صالح للصرف");
  if (new Set(options.map(lot => lot.lotId)).size !== options.length)
    throw Error("لوت مكرر في مصادر الصرف؛ راجع المخزون");
  const byId = new Map(options.map(lot => [lot.lotId, lot]));
  const budgets = new Map<string, number>();
  const result: Array<T & { quantity: number }> = [];
  let covered = 0;
  const add = (lot: T, quantity: number) => {
    const ratio = lot.originalPerUnit ?? 1;
    if (
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      quantity > lot.quantity ||
      !Number.isFinite(ratio) ||
      ratio <= 0 ||
      (!lot.coverageKey && lot.unit.trim() !== unit.trim())
    )
      throw Error("كمية اللوت أو وحدته لا تطابق الاحتياج أو الرصيد المتاح");
    const original = quantity * ratio;
    if (Math.abs(original * 1000 - Math.round(original * 1000)) > 0.000001)
      throw Error(
        "كمية اللوت لا تحقق نسبة البديل المعتمدة بدقة؛ راجع توزيع الكميات"
      );
    if (lot.coverageKey) {
      const used = (budgets.get(lot.coverageKey) || 0) + original;
      if (lot.coverageLimit == null || used > lot.coverageLimit + 0.0005)
        throw Error("الكمية تتجاوز حصة البديل المعتمدة لهذا الاحتياج");
      budgets.set(lot.coverageKey, used);
    }
    covered += original;
    result.push({ ...lot, quantity });
  };
  if (selection.mode === "manual") {
    if (
      new Set(selection.lots.map(lot => lot.lotId)).size !==
      selection.lots.length
    )
      throw Error("اختر كل لوت مرة واحدة فقط");
    for (const chosen of selection.lots) {
      const lot = byId.get(chosen.lotId);
      if (!lot)
        throw Error("اللوت المختار لا يتبع المخزن والصنف والاحتياج الحالي");
      add(lot, chosen.quantity);
    }
  } else {
    for (const lot of [...options].sort(
      (a, b) =>
        String(a.createdAt || a.receivedAt || "").localeCompare(
          String(b.createdAt || b.receivedAt || "")
        ) ||
        a.lotId - b.lotId ||
        (a.inventoryId || 0) - (b.inventoryId || 0)
    )) {
      const ratio = lot.originalPerUnit ?? 1;
      const left = Math.max(0, required - covered);
      const budget = lot.coverageKey
        ? Math.max(
            0,
            (lot.coverageLimit ?? 0) - (budgets.get(lot.coverageKey) || 0)
          )
        : left;
      const quantity = Math.min(
        Math.floor(lot.quantity),
        Math.floor((Math.min(left, budget) + 0.0000001) / ratio)
      );
      if (quantity > 0) add(lot, quantity);
      if (Math.abs(covered - required) <= 0.0005) break;
    }
  }
  if (!result.length || Math.abs(covered - required) > 0.0005)
    throw Error(
      `يجب تغطية كامل الاحتياج (${required} ${unit}) دون زيادة أو صرف جزئي`
    );
  return result;
}
