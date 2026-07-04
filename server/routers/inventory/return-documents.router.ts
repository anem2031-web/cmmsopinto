import { z } from "zod";
import { protectedProcedure, router } from "../_shared/procedures";
import * as db from "../../db";

export const returnDocumentsRouter = router({

  // جلب كل وثائق المرتجعات — تُنشأ تلقائياً بالخادم مع كل مرتجع (لا حاجة
  // لإجراء "generate" منفصل تستدعيه الواجهة)
  list: protectedProcedure.query(async () => {
    return db.getReturnDocuments();
  }),

  incrementPrint: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const count = await db.incrementReturnDocPrintCount(input.id);
    return { printCount: count };
  }),
});
