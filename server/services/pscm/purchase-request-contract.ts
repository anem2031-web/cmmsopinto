import { z } from "zod";
import { purchaseReviewRoleSchema } from "../../../shared/purchase-item-review";
import { purchaseDateOnly } from "../../../shared/purchaseItemNeedDate";

export const pscmPurchasePath = "/api/v1/pscm/purchase-requests";
export const pscmPurchaseToken = /^cmms_pr_[A-Za-z0-9_-]{43}$/;
export const pscmPurchaseInstance = /^[A-Za-z0-9_-]{1,64}$/;
const id = z.number().int().min(1).max(2_147_483_647);
const name = z.string().trim().min(1).max(255);
const reference = z.string().min(1).max(50);
const unitLabel = z.string().trim().min(1).max(100);
const item = z.strictObject({
  sequence: id,
  itemName: name,
  catalogItemId: z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/)
    .transform(Number)
    .pipe(id)
    .nullable(),
  catalogCode: z.string().max(255),
  quantity: z.string().regex(/^\d{1,9}(?:\.\d{1,9})?$/),
  unit: z.strictObject({
    code: unitLabel,
    nameAr: unitLabel,
    nameEn: unitLabel,
    nameUr: unitLabel,
  }),
  specifications: z.string().max(5000),
  notes: z.string().max(5000),
  needDate: z.string().refine(value => purchaseDateOnly(value) !== null),
  siteId: id,
  sectionId: id,
  assetId: id.nullable(),
  categoryId: id,
  reviewRole: purchaseReviewRoleSchema,
});

export const pscmPurchasePayload = z.strictObject({
  schemaVersion: z.literal(1),
  idempotencyKey: z.string().min(1).max(115),
  source: z.strictObject({
    system: z.literal("PSCM"),
    instanceId: z.string().regex(pscmPurchaseInstance),
    requisitionId: id,
    requisitionNumber: reference.regex(/^MR-\d{2}-\d{2}-\d{4,}$/),
    requesterName: name.optional(),
    approvedAt: z.iso.datetime(),
    project: z.strictObject({ id, number: reference, name }),
    task: z.strictObject({ id, name }).nullable(),
  }),
  items: z
    .array(item)
    .min(1)
    .max(20)
    .refine(
      items => new Set(items.map(item => item.sequence)).size === items.length
    ),
});

export type PscmPurchasePayload = z.infer<typeof pscmPurchasePayload>;
export type PscmPurchaseConfirmation = {
  purchaseRequestId: number;
  purchaseRequestNumber: string;
};
export type PscmPurchaseErrorCode =
  | "source_conflict"
  | "unsupported_quantity"
  | "invalid_location"
  | "invalid_category"
  | "invalid_catalog_item"
  | "invalid_unit"
  | "invalid_need_date"
  | "requester_unavailable";

export class PscmPurchaseError extends Error {
  constructor(readonly code: PscmPurchaseErrorCode) {
    super(code);
  }
}
