import { TRPCError } from "@trpc/server";

const MAX_COST_IN_HALALAS = 999_999_999_999; // DECIMAL(12,2)

export function calculatePurchaseEstimate(unitCost: string, quantity: number) {
  const text = unitCost.trim();
  if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) || !Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "أدخل سعر وحدة صحيحًا وكمية صحيحة" });
  }

  const [whole, fraction = ""] = text.split(".");
  // Round the unit price to the storage scale before multiplying by the quantity.
  const unitHalalas = Number(whole || 0) * 100
    + Number(fraction.slice(0, 2).padEnd(2, "0"))
    + (Number(fraction[2]) >= 5 ? 1 : 0);
  const totalHalalas = unitHalalas * quantity;
  if (!Number.isSafeInteger(totalHalalas) || totalHalalas > MAX_COST_IN_HALALAS) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "قيمة التسعير تتجاوز الحد المسموح" });
  }

  return {
    estimatedUnitCost: (unitHalalas / 100).toFixed(2),
    estimatedTotalCost: (totalHalalas / 100).toFixed(2),
  };
}
