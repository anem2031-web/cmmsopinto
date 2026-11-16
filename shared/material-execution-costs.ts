/** Operational material cost only. Never posts or revalues inventory. */
export const MATERIAL_COST_SOURCES = ["ticket_named", "ticket_team", "pmv2", "independent", "operational"] as const;
export type MaterialCostSource = typeof MATERIAL_COST_SOURCES[number];
/** Monetary execution details are restricted to the two system-supervision roles. */
export const canViewMaterialCostDocument = (role?: string | null): boolean => role === "owner" || role === "admin";
export type MaterialCostReturn = {
  id: number; number: string; quantity: number | string; createdAt: string;
  financialValue: number | string | null;
};
export type MaterialCostIssue = {
  id: number; transactionId: number; deliveryId: number; deliveryNumber: string;
  source: MaterialCostSource; sourceId: number | null; sourceItemId: number | null; sourceNumber: string | null;
  siteId: number; siteName: string; sectionId: number | null; sectionName: string;
  assetId: number | null; assetName: string; itemName: string; unit: string;
  lotCode: string; quantity: number | string; lotUnitCost: number | string | null;
  allocatedValue: number | string | null; financialValue: number | string | null;
  createdAt: string; receiverName: string; returns: MaterialCostReturn[];
};
export type MaterialCostEvent = Omit<MaterialCostIssue, "returns"> & {
  eventKey: string; eventType: "issue" | "return"; eventNumber: string;
  eventDate: string; issued: number; returned: number; net: number;
  financialNet: number | null; difference: number | null; incomplete: boolean;
};

function scaled(value: number | string | null, precision: number): bigint | null {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) < 0) return null;
  const text = Number(value).toFixed(precision);
  return BigInt(text.replace(".", ""));
}
function roundedDivide(value: bigint, divisor: bigint): bigint {
  return (value + divisor / BigInt(2)) / divisor;
}
const money = (cents: bigint) => Number(cents) / 100;

function cumulativeReturnCost(returnedQuantity: bigint, quantity: bigint, price: bigint, allocated: bigint) {
  // A full return absorbs the fractional-cent remainder of the recorded allocation.
  return returnedQuantity === quantity ? allocated : roundedDivide(returnedQuantity * price, BigInt(100000));
}

export function materialAllocationCents(snapshot: {
  quantity: number | string;
  allocations: { quantity: number | string; lotUnitCost: number | string | null; allocatedValue: number | string | null }[];
  returnedQuantity: number | string;
}) {
  const quantity = scaled(snapshot.quantity, 3);
  const returned = scaled(snapshot.returnedQuantity, 3);
  const zero = BigInt(0);
  if (quantity == null || quantity <= zero || returned == null || returned > quantity) return null;
  let allocated = zero;
  let allocatedQuantity = zero;
  let price: bigint | null = null;
  for (const allocation of snapshot.allocations) {
    const amount = scaled(allocation.allocatedValue, 2);
    const allocatedUnits = scaled(allocation.quantity, 3);
    const unitPrice = scaled(allocation.lotUnitCost, 4);
    if (amount == null || allocatedUnits == null || allocatedUnits <= zero || unitPrice == null ||
      (price != null && unitPrice !== price)) return null;
    price = unitPrice;
    allocatedQuantity += allocatedUnits;
    allocated += amount;
  }
  if (price == null || allocatedQuantity !== quantity) return null;
  const credit = cumulativeReturnCost(returned, quantity, price, allocated);
  const issuedCents = Number(allocated);
  if (!Number.isSafeInteger(issuedCents) || credit > allocated) return null;
  return { issuedCents, returnedCents: Number(credit) };
}

/** One movement is counted once even if multiple workflow references return it.
 * Returns use the ORIGINAL allocation snapshot, not today's lot/average cost.
 * Period filters apply to each physical event, never to the PO or ticket date.
 */
export function materialCostEvents(issues: MaterialCostIssue[], period: { from?: string; to?: string } = {}): MaterialCostEvent[] {
  const result: MaterialCostEvent[] = [];
  const seen = new Set<number>();
  const inPeriod = (date: string) => (!period.from || date.slice(0, 10) >= period.from) && (!period.to || date.slice(0, 10) <= period.to);
  for (const issue of issues) {
    if (seen.has(issue.transactionId)) continue;
    seen.add(issue.transactionId);
    const quantity = scaled(issue.quantity, 3);
    const price = scaled(issue.lotUnitCost, 4);
    const allocated = scaled(issue.allocatedValue, 2);
    const financial = scaled(issue.financialValue, 2);
    const valid = quantity != null && quantity > BigInt(0) && price != null && allocated != null;
    const base = { ...issue, returns: undefined };
    if (inPeriod(issue.createdAt)) {
      result.push({ ...base, eventKey: `issue:${issue.transactionId}`, eventType: "issue", eventNumber: issue.deliveryNumber,
        eventDate: issue.createdAt, issued: valid ? money(allocated!) : 0, returned: 0, net: valid ? money(allocated!) : 0,
        financialNet: financial == null ? null : money(financial),
        difference: valid && financial != null ? money(allocated! - financial) : null, incomplete: !valid || financial == null });
    }
    let returnedQuantity = BigInt(0), returnedValue = BigInt(0);
    const returnIds = new Set<number>();
    for (const receipt of [...issue.returns].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)) {
      if (returnIds.has(receipt.id)) continue;
      returnIds.add(receipt.id);
      const qty = scaled(receipt.quantity, 3);
      const returnFinancial = scaled(receipt.financialValue, 2);
      const validReturn = valid && qty != null && qty > BigInt(0) && returnedQuantity + qty <= quantity!;
      let delta = BigInt(0);
      if (validReturn) {
        returnedQuantity += qty!;
        const cumulativeValue = cumulativeReturnCost(returnedQuantity, quantity!, price!, allocated!);
        delta = cumulativeValue - returnedValue;
        returnedValue = cumulativeValue;
      }
      if (inPeriod(receipt.createdAt)) {
        result.push({ ...base, eventKey: `return:${receipt.id}`, eventType: "return", eventNumber: receipt.number,
          eventDate: receipt.createdAt, quantity: receipt.quantity, issued: 0, returned: money(delta), net: -money(delta),
          financialNet: returnFinancial == null ? null : -money(returnFinancial),
          difference: validReturn && returnFinancial != null ? money(returnFinancial - delta) : null,
          incomplete: !validReturn || returnFinancial == null });
      }
    }
  }
  return result.sort((a, b) => b.eventDate.localeCompare(a.eventDate) || b.transactionId - a.transactionId);
}

export function summarizeMaterialCosts(events: MaterialCostEvent[]) {
  const cents = (value: number) => BigInt(Math.round(value * 100));
  const sum = (values: number[]) => money(values.reduce((total, value) => total + cents(value), BigInt(0)));
  const financialComplete = events.every(event => event.financialNet != null);
  return {
    issued: sum(events.map(event => event.issued)), returned: sum(events.map(event => event.returned)),
    net: sum(events.map(event => event.net)),
    financialNet: financialComplete ? sum(events.map(event => event.financialNet!)) : null,
    difference: events.every(event => event.difference != null) ? sum(events.map(event => event.difference!)) : null,
    incomplete: events.filter(event => event.incomplete).length, events: events.length,
  };
}

export function groupMaterialCosts(events: MaterialCostEvent[], by: "site" | "section" | "asset" | "document") {
  const groups = new Map<string, { id: string; name: string; siteName: string; sectionName: string; rows: MaterialCostEvent[] }>();
  for (const event of events) {
    const id = by === "site" ? String(event.siteId) : by === "section" ? `${event.siteId}:${event.sectionId ?? "none"}`
      : by === "asset" ? `${event.siteId}:${event.sectionId ?? "none"}:${event.assetId ?? "none"}`
      : event.source === "independent" ? `independent:${event.deliveryId}` : `${event.source.startsWith("ticket_") ? "ticket" : event.source}:${event.sourceId}`;
    const name = by === "site" ? event.siteName : by === "section" ? event.sectionName || "دون قسم محدد"
      : by === "asset" ? event.assetName || "دون أصل محدد" : event.sourceNumber || `صرف مستقل — ${event.deliveryNumber}`;
    const group = groups.get(id) ?? { id, name, siteName: event.siteName, sectionName: event.sectionName, rows: [] };
    group.rows.push(event); groups.set(id, group);
  }
  return Array.from(groups.values()).map(({ rows, ...group }) => ({ ...group,
    siteName: Array.from(new Set(rows.map(row => row.siteName))).join("، "),
    sectionName: Array.from(new Set(rows.map(row => row.sectionName || "دون قسم محدد"))).join("، "),
    ...summarizeMaterialCosts(rows),
  })).sort((a, b) => b.net - a.net);
}
