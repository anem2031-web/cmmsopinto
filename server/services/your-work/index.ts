import type { TrpcContext } from "../../_core/context";
import { TRPCError } from "@trpc/server";
import { canReadYourWork, splitYourWork, type YourWorkItem } from "../../../shared/your-work";
import { readYourWorkPurchases } from "./purchases";
import { readYourWorkOperations } from "./operations";

export type YourWorkSource = (ctx: TrpcContext) => Promise<YourWorkItem[]>;
/** Each source uses the actual request identity and existing action/record guards. No shared permission cache. */
export async function readYourWork(ctx: TrpcContext, sources: readonly YourWorkSource[] = [readYourWorkPurchases, readYourWorkOperations], now = Date.now()) {
  const actor = ctx.authenticatedUser ?? ctx.user;
  if (!canReadYourWork(actor)) throw new TRPCError({ code: "FORBIDDEN", message: "صفحة أعمالك غير متاحة لهذا الحساب" });
  const actualContext = { ...ctx, user: actor, authenticatedUser: actor } as TrpcContext;
  const groups = await Promise.all(sources.map(source => source(actualContext)));
  return splitYourWork(groups.flat(), now);
}
