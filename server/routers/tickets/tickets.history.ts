import { z } from "zod";
import { router, protectedProcedure } from "../_shared/procedures";
import * as db from "../../db";

export const ticketsHistoryRouter = router({
  history: protectedProcedure.input(z.object({ ticketId: z.number() })).query(async ({ input }) => {
    return db.getTicketHistory(input.ticketId);
  }),
});
