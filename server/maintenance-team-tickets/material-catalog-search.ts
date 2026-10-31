import {
  normalizeCatalogItemText,
  rankCatalogItemMatches,
  type CatalogItemCandidateInput,
} from "../_core/catalog-item-matching";
import type { MaterialIdentityCandidate } from "../../shared/catalog-material-identity";

type Candidate = Omit<MaterialIdentityCandidate, "teamAvailability" | "mainWarehouseAvailability">;

export async function readTicketMaterialUnits(): Promise<Array<{ id: number; nameAr: string; nameEn: string | null }>> {
  const [{ getDb }, { catalogUnits }, { asc, eq }] = await Promise.all([
    import("../_core/db/client"), import("../../drizzle/schema"), import("drizzle-orm"),
  ]);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.select({ id: catalogUnits.id, nameAr: catalogUnits.nameAr, nameEn: catalogUnits.nameEn })
    .from(catalogUnits).where(eq(catalogUnits.isActive, 1)).orderBy(asc(catalogUnits.nameAr));
}

/** Local name/measurement suggestions only; packaging units never filter identities. */
export function rankTicketMaterialCandidates(items: CatalogItemCandidateInput[], search: string, limit = 30): Candidate[] {
  const term = search.trim();
  const size = Math.min(30, Math.max(1, Math.trunc(limit) || 30));
  const byId = new Map(items.map(item => [item.id, item]));
  // Only the item descriptions participate in measurement comparisons, not the stock unit.
  const matches = rankCatalogItemMatches({
    query: { itemName: term },
    catalogItems: items.map(({ unit: _unit, ...item }) => item),
    limit: items.length,
  });
  const ranked = new Map(matches.map(match => [match.catalogItemId, {
    id: match.catalogItemId,
    score: match.score,
    measurementStatus: match.measurementStatus,
  }]));
  const normalized = normalizeCatalogItemText(term);
  for (const item of items) {
    const code = normalizeCatalogItemText(item.code ?? "");
    if (normalized && code.includes(normalized)) {
      const previous = ranked.get(item.id);
      ranked.set(item.id, { id: item.id, score: code === normalized ? 100 : 90,
        measurementStatus: previous?.measurementStatus ?? "unknown" });
    }
  }
  return Array.from(ranked.values()).sort((a, b) => b.score - a.score || a.id - b.id).slice(0, size).map(match => {
    const item = byId.get(match.id)!;
    return { id: item.id, code: item.code ?? null, nameAr: item.nameAr, nameEn: item.nameEn,
      unit: item.unit ?? null, measurementStatus: match.measurementStatus };
  });
}

/** One metadata read; shortlist before the two batched stock reads. No global snapshot/cache. */
export async function searchTicketMaterialCatalog(search: string, limit: number, catalogItemId?: number): Promise<Candidate[]> {
  const [{ getDb }, { catalogItems }, { asc, eq, and }] = await Promise.all([
    import("../_core/db/client"), import("../../drizzle/schema"), import("drizzle-orm"),
  ]);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const query = db.select({ id: catalogItems.id, code: catalogItems.code,
    nameAr: catalogItems.nameAr, nameEn: catalogItems.nameEn, unit: catalogItems.unit,
    manufacturer: catalogItems.manufacturer,
  }).from(catalogItems).where(and(eq(catalogItems.isActive, 1), catalogItemId == null ? undefined : eq(catalogItems.id, catalogItemId))).orderBy(asc(catalogItems.nameAr), asc(catalogItems.id));
  if (catalogItemId != null) return query.limit(1);
  const size = Math.min(30, Math.max(1, Math.trunc(limit) || 30));
  if (!search.trim()) return query.limit(size);
  return rankTicketMaterialCandidates(await query, search, size);
}
