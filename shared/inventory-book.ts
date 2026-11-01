/** FIFO allocates physical lot quantities; it never converts or combines different units. */
export function planBookFifo(
  lots: any[],
  quantity: number,
  unit: string,
  reserved: Record<string, number> = {}
) {
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw Error("أدخل كمية أكبر من صفر");
  if (Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.000001)
    throw Error("الكمية تدعم ثلاث منازل عشرية كحد أقصى");
  let remaining = Math.round(quantity * 1000);
  const plan: any[] = [];
  const sorted = lots
    .filter(
      lot =>
        !Number(lot.isFrozen) &&
        String(lot.issueUnit || lot.inventoryUnit || "").trim() === unit.trim()
    )
    .slice()
    .sort(
      (a, b) =>
        String(a.createdAt).localeCompare(String(b.createdAt)) ||
        Number(a.lotId) - Number(b.lotId) ||
        Number(a.inventoryId) - Number(b.inventoryId)
    );
  for (const lot of sorted) {
    const key = `${lot.inventoryId}:${lot.lotId}`;
    const available = Math.max(
      0,
      Math.round(
        (Number(lot.balanceQuantity) - Number(reserved[key] || 0)) * 1000
      )
    );
    const taken = Math.min(remaining, available);
    if (taken) plan.push({ ...lot, quantity: taken / 1000 });
    remaining -= taken;
    if (!remaining) break;
  }
  if (remaining)
    throw Error(
      "الرصيد المتاح بالوحدة المختارة لا يكفي؛ راجع اللوتات والكميات"
    );
  return plan;
}
