import { z } from "zod";
import { router, protectedProcedure } from "../_shared/procedures";
import { getDb } from "../../_core/db";

import { exportCatalogExcel }                          from "../../services/catalog/catalogExport.service";
import { parseCatalogImportFile, commitCatalogImport } from "../../services/catalog/catalogImport.service";
import { validateCatalogImport }                       from "../../services/catalog/catalogValidation.service";

export const catalogImportExportRouter = router({

  exportExcel: protectedProcedure
    .mutation(async () => {

      const db     = await getDb();   // ← await
      const buffer = await exportCatalogExcel(db);

      return {
        fileName: `catalog-export-${Date.now()}.xlsx`,
        buffer:   buffer.toString("base64"),
      };
    }),

  importPreview: protectedProcedure
    .input(z.object({ fileBase64: z.string() }))
    .mutation(async ({ input }) => {

      const db         = await getDb();   // ← await
      const parsed     = await parseCatalogImportFile(input.fileBase64);
      const validation = await validateCatalogImport(db, parsed);

      return { parsed, validation };
    }),

  importCommit: protectedProcedure
    .input(z.object({ parsed: z.any() }))
    .mutation(async ({ input }) => {

      const db         = await getDb();   // ← await
      const validation = await validateCatalogImport(db, input.parsed);

      if (!validation.valid) {
        throw new Error(
          `فشل التحقق: ${validation.errors.map((e: any) => e.message).join(" | ")}`
        );
      }

      return await commitCatalogImport(db, input.parsed);
    }),
});
