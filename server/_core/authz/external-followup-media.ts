import { TRPCError } from "@trpc/server";
import { isDelegateRole } from "../../../shared/delegate-role";
import { loadExternalDelegateScopes, isExternalDelegateJob } from "./external-delegate-access";
import { assertCurrentExternalFollowupActor, externalDelegateFollowupMediaSources, type ExternalFollowupDatabase, type ExternalFollowupActor } from "../../services/external-maintenance-followup";

type Reference = { id: number; parentId?: number | null };
const denied = () => new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لصور أصل الصيانة الخارجية" });
export const externalFollowupMediaPort = {
  async database(): Promise<ExternalFollowupDatabase> {
    const { getDb } = await import("../db");
    const database = await getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر التحقق من صورة الأصل" });
    return database;
  },
  prepurchase: loadExternalDelegateScopes,
};

/** Do not fall back to general ticket/PO visibility for an external asset key.
 * Multiple references may share a real image; one current own source suffices. */
export async function assertDelegateExternalAssetKey(actor: ExternalFollowupActor, references: Reference[], key: string,
  keyOf: (value: unknown) => string | null, port = externalFollowupMediaPort): Promise<void> {
  if (!isDelegateRole(actor.role) || actor.isActive !== 1 || !references.length) throw denied();
  const ids = Array.from(new Set(references.map(reference => Number(reference.id))));
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw denied();
  const database = await port.database();
  await assertCurrentExternalFollowupActor(database, actor);
  const scopes = await port.prepurchase(ids);
  const matchesParent = (jobId: number, ticketId: number) => references.some(reference => Number(reference.id) === jobId && Number(reference.parentId) === ticketId);
  for (const scope of Array.from(scopes.values())) {
    if (matchesParent(Number(scope.id), Number(scope.ticketId)) && isExternalDelegateJob(actor, scope) && keyOf(scope.assetBeforePhotoUrl) === key) return;
  }
  const postIds = ids.filter(id => scopes.get(id)?.purchaseOrderId != null);
  const sources = await externalDelegateFollowupMediaSources(database, actor, postIds);
  for (const source of sources) {
    if (!matchesParent(Number(source.jobId), Number(source.ticketId))) continue;
    if (keyOf(source.assetBeforePhotoUrl) === key || Number(source.followupApproved) === 1
      && (keyOf(source.assetAfterReturnPhotoUrl) === key || keyOf(source.workshopReportUrl) === key)) return;
  }
  throw denied();
}
