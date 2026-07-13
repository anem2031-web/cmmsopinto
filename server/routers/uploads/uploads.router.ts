import { z } from "zod";
import { nanoid } from "nanoid";
import { router, protectedProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";

export const uploadsRouter = router({
  getPresignedUrl: protectedProcedure.input(z.object({
    fileName: z.string(),
    contentType: z.string(),
    entityType: z.string(),
    entityId: z.number().optional(),
  })).mutation(async ({ input, ctx }) => {
    const fileKey = `cmms/${input.entityType}/${Date.now()}-${nanoid(8)}-${input.fileName}`;
    return { fileKey, uploadUrl: `/api/upload` };
  }),
});
