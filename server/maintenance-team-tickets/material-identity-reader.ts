import { TeamTicketError } from "../../shared/maintenance-team-tickets/model";
import type { IdentityAvailability, MaterialIdentityCandidate, TicketIdentityContext } from "../../shared/catalog-material-identity";
import { searchTicketMaterialCatalog } from "./material-catalog-search";

export interface IdentityReaders {
  searchCatalog(search: string, limit: number, catalogItemId?: number): Promise<Array<Omit<MaterialIdentityCandidate, "teamAvailability" | "mainWarehouseAvailability">>>;
  requireWarehouse(id: number): Promise<{ id: number }>;
  mainWarehouse(): Promise<{ id: number }>;
  balances(ids: number[], warehouseId: number): Promise<IdentityAvailability[]>;
}
async function existingReaders(): Promise<IdentityReaders> {
  // These are the existing catalog/inventory read adapters used by PMV2, without its task/request services.
  const { currentInventoryAdapter, currentWarehouseAdapter } = await import("../pmv2/adapters/current-system");
  return {
    searchCatalog: searchTicketMaterialCatalog,
    requireWarehouse: id => currentWarehouseAdapter.requireActiveWarehouse(id),
    mainWarehouse: () => currentWarehouseAdapter.requireSingleActiveMainWarehouse(),
    balances: (ids, warehouseId) => currentInventoryAdapter.getCatalogAvailabilities(ids, warehouseId),
  };
}
/** Context must come from the authenticated, assignment-scoped service; never client warehouse IDs. */
export async function searchTicketIdentityCandidates(context: TicketIdentityContext, search: string, injected?: IdentityReaders) {
  const readers = injected ?? await existingReaders();
  try {
    const [team, main] = await Promise.all([readers.requireWarehouse(context.warehouseId), readers.mainWarehouse()]);
    const found = await readers.searchCatalog(context.catalogItemId == null ? search.trim() : "", context.catalogItemId == null ? 30 : 1, context.catalogItemId);
    const items = context.catalogItemId == null ? found : found.filter(item => item.id === context.catalogItemId);
    const ids = items.map(item => item.id);
    const [teamBalances, mainBalances] = ids.length ? await Promise.all([readers.balances(ids, team.id), readers.balances(ids, main.id)]) : [[], []];
    const teamById = new Map(teamBalances.map(item => [item.catalogItemId, item]));
    const mainById = new Map(mainBalances.map(item => [item.catalogItemId, item]));
    const empty = (catalogItemId: number, warehouseId: number): IdentityAvailability => ({ catalogItemId, warehouseId, inventoryId: null, availableQuantity: 0, unit: null, ambiguous: false, lotsRequired: false });
    return { request: context, items: items.map(item => ({ ...item, teamAvailability: teamById.get(item.id) ?? empty(item.id, team.id), mainWarehouseAvailability: mainById.get(item.id) ?? empty(item.id, main.id) })) };
  } catch (error) {
    if (error instanceof Error && error.name === "Pmv2ExternalReferenceError") throw new TeamTicketError("INVALID", error.message);
    throw error;
  }
}
