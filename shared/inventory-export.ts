import { z } from "zod";

// The export accepts filters, never client-supplied balances or partial book pages.
export const inventoryBookExportFilterSchema = z.object({
  warehouseId: z.number().int().positive(),
  search: z.string().max(300).optional(),
  includeZero: z.boolean().optional(),
  nodeIds: z.array(z.number().int().positive()).max(500).optional(),
  sort: z.enum(["name", "recent", "quantity"]).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

export type InventoryBookExportFilters = z.infer<typeof inventoryBookExportFilterSchema>;
