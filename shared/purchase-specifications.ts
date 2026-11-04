import { z } from "zod";

export const CONSTRUCTION_SPECIFICATION_ROLE = "construction_procurement_manager";
export type SpecificationActor = { id: number; role: string; isActive?: number | boolean };
const active = (actor?: SpecificationActor | null) => !!actor && Number.isSafeInteger(actor.id) && actor.id > 0 && (actor.isActive === 1 || actor.isActive === true);
export function canReviewPurchaseSpecifications(actor?: SpecificationActor | null): boolean {
  return active(actor) && ["owner", "admin", CONSTRUCTION_SPECIFICATION_ROLE].includes(actor!.role);
}
export function canReadSpecificationReturns(actor?: SpecificationActor | null): boolean {
  return active(actor) && ["owner", "admin", "warehouse"].includes(actor!.role);
}
export const specificationListInput = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(50).default(20),
  search: z.string().trim().max(200).optional(),
}).default({ page: 1, pageSize: 20 });
export const specificationDecisionInput = z.object({
  id: z.number().int().positive(), revision: z.number().int().nonnegative(),
  decision: z.enum(["approved", "rejected"]), notes: z.string().trim().max(2000).optional(),
});
