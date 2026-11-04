import { z } from "zod";
import { router, catalogImportExportProcedure } from "../_shared/procedures";
import { getDb } from "../../_core/db";

import {
  exportCatalogExcel,
  exportCatalogItemsExcel,
  exportCatalogTaxonomyTreeExcel,
} from "../../services/catalog/catalogExport.service";
import { parseCatalogImportFile, commitCatalogImport } from "../../services/catalog/catalogImport.service";
import { validateCatalogImport }                       from "../../services/catalog/catalogValidation.service";
import { catalogAuditRequestMeta } from "../../_core/catalog-audit";

export const catalogImportExportRouter = router({

  exportExcel: catalogImportExportProcedure
    .mutation(async () => {

      const db     = await getDb();   // ← await
      const buffer = await exportCatalogExcel(db);

      return {
        fileName: `catalog-export-${Date.now()}.xlsx`,
        buffer:   buffer.toString("base64"),
      };
    }),


  exportItemsExcel: catalogImportExportProcedure
    .input(z.object({
      search: z.string().optional(),
      nodeIds: z.array(z.number()).optional(),
      includeInactive: z.boolean().optional(),
    }).optional())
    .mutation(async ({ input }) => {
      const db = await getDb();
      const buffer = await exportCatalogItemsExcel(db, input || {});

      return {
        fileName: `catalog-items-${Date.now()}.xlsx`,
        buffer: buffer.toString("base64"),
      };
    }),

  exportTaxonomyTreeExcel: catalogImportExportProcedure
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .mutation(async ({ input }) => {
      const db = await getDb();
      const buffer = await exportCatalogTaxonomyTreeExcel(db, input?.includeInactive ?? true);

      return {
        fileName: `catalog-taxonomy-tree-${Date.now()}.xlsx`,
        buffer: buffer.toString("base64"),
      };
    }),

  importPreview: catalogImportExportProcedure
    .input(z.object({ fileBase64: z.string() }))
    .mutation(async ({ input }) => {

      const db         = await getDb();   // ← await
      const parsed     = await parseCatalogImportFile(input.fileBase64);
      const validation = await validateCatalogImport(db, parsed);

      return { parsed, validation };
    }),

  importCommit: catalogImportExportProcedure
    .input(z.object({ parsed: z.any() }))
    .mutation(async ({ input, ctx }) => {

      const db         = await getDb();   // ← await
      const validation = await validateCatalogImport(db, input.parsed);

      if (!validation.valid) {
        throw new Error(
          `فشل التحقق: ${validation.errors.map((e: any) => e.message).join(" | ")}`
        );
      }

      return await commitCatalogImport(db, input.parsed, {
        userId: ctx.user.id,
        ...catalogAuditRequestMeta(ctx),
      });
    }),
});
