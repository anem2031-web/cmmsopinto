import { router } from "../_shared/procedures";
import { ticketsRouter } from "./tickets.router";
import { ticketsWorkflowRouter } from "./tickets.workflow";
import { ticketsApprovalsRouter } from "./tickets.approvals";
import { ticketsClosureRouter } from "./tickets.closure";
import { ticketsExternalRouter } from "./tickets.external";
import { ticketsPurchaseRouter } from "./tickets.purchase";
import { ticketsHistoryRouter } from "./tickets.history";

export const ticketsMergedRouter = router({
  ...ticketsRouter._def.procedures,
  ...ticketsWorkflowRouter._def.procedures,
  ...ticketsApprovalsRouter._def.procedures,
  ...ticketsClosureRouter._def.procedures,
  ...ticketsExternalRouter._def.procedures,
  ...ticketsPurchaseRouter._def.procedures,
  ...ticketsHistoryRouter._def.procedures,
});