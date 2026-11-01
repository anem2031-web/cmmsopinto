import type { UnifiedApprovalPorts } from "./unified-approval";
/** Reuses the existing return writers. DPB's free custody balance never funds a replacement twice. */
export function createBundleReplacementAdapter(deps: {
  returnToDelegate: (...args: any[]) => Promise<boolean>;
  management: (...args: any[]) => Promise<boolean>;
  funding: (...args: any[]) => Promise<{ additionalFunding: string } | null>;
  accounting: (...args: any[]) => Promise<boolean>;
}): UnifiedApprovalPorts["replacement"] {
  return async (tx, actor, stage, batch, rejection, notes, signature) => {
    if (rejection)
      return deps.returnToDelegate(
        tx,
        actor.id,
        actor.role,
        stage,
        Number(batch.id),
        rejection.itemId,
        rejection.reason
      );
    if (stage === "management")
      return deps.management(tx, actor.id, Number(batch.id), notes);
    const funding = await deps.funding(tx, Number(batch.id));
    if (!funding) return false;
    return deps.accounting(
      tx,
      actor.id,
      Number(batch.id),
      String(funding.additionalFunding),
      notes,
      signature
    );
  };
}
