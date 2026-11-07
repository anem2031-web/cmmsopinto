import { z } from "zod";
import { warehouseProcedure, router } from "../_shared/procedures";
import { WAREHOUSE_DOCUMENT_SOURCES } from "../../../shared/warehouse-request-documents";
import type { createWarehouseRequestDocumentService } from "../../services/warehouse-request-documents";

const source = z.enum(WAREHOUSE_DOCUMENT_SOURCES);
const selection = z.object({ source, kind: z.enum(["delivery", "warehouse_issue", "return"]), id: z.number().int().positive() }).strict();
export function createWarehouseRequestDocumentsRouter(service: ReturnType<typeof createWarehouseRequestDocumentService>) {
  return router({
    list: warehouseProcedure.input(z.object({ source, search: z.string().max(200).default(""), sort: z.enum(["newest", "oldest"]).default("newest"),
      page: z.number().int().positive().default(1), pageSize: z.number().int().min(1).max(50).default(20) }).strict())
      .query(({ ctx, input }) => service.page(ctx.authenticatedUser ?? ctx.user, input)),
    detail: warehouseProcedure.input(selection).query(({ ctx, input }) => service.detail(ctx.authenticatedUser ?? ctx.user, input)),
    recordPrint: warehouseProcedure.input(selection).mutation(({ ctx, input }) => service.recordPrint(ctx.authenticatedUser ?? ctx.user, input)),
  });
}
