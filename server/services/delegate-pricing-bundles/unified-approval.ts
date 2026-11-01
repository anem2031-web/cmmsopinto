import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { captureDocumentSignature } from "../../../shared/documentSignatureSnapshot";
import type {
  PricingBundleActor,
  PricingBundleSnapshot,
} from "../../../shared/delegate-pricing-bundles";
import { readScopeChunks } from "../../_core/authz/read-batch";

type Stage = "accounting" | "management";
type Actor = PricingBundleActor & { signatureUrl?: string | null };
export type UnifiedApprovalInput = {
  id: number;
  revision: number;
  operationKey: string;
  custodyBalance?: string;
  notes?: string;
  rejections: Array<{ itemId: number; reason: string }>;
};
export interface UnifiedApprovalPorts {
  enabled(): boolean;
  database(): Promise<any>;
  readGuard(actor: Actor): Promise<(po: any) => void>;
  authorizeStage(actor: Actor, stage: Stage, orders: any[]): void;
  updateItem(
    tx: any,
    item: any,
    data: any,
    actor: Actor,
    bundleNumber: string
  ): Promise<void>;
  replacement(
    tx: any,
    actor: Actor,
    stage: Stage,
    batch: any,
    rejection: { itemId: number; reason: string } | undefined,
    notes: string,
    signature: string
  ): Promise<boolean>;
  finish(context: any, actor: Actor, stage: Stage | "send"): Promise<void>;
}
const parse = (value: any) =>
  typeof value === "string" ? JSON.parse(value) : value;
const rejected = (root: any) => [
  ...(parse(root.accountingRejections) || []),
  ...(parse(root.managementRejections) || []),
];
const no = (
  message: string,
  code: "FORBIDDEN" | "CONFLICT" | "NOT_FOUND" | "BAD_REQUEST" = "CONFLICT"
): never => {
  throw new TRPCError({ code, message });
};
async function rows(tx: any, query: any) {
  const result = await tx.execute(query);
  if (!Array.isArray(result?.[0])) throw Error("Invalid DPB database response");
  return result[0] as any[];
}
const ids = (values: number[]) =>
  sql.join(
    values.map(id => sql`${id}`),
    sql`,`
  );
// Frozen DPB rows use an em dash for an absent unit. This is display metadata,
// not a conversion or an authorization to change a real unit.
const quoteUnit = (value: unknown) =>
  value == null || value === "" || value === "—" ? null : value;
export class UnifiedBundleApprovalService {
  constructor(private ports: UnifiedApprovalPorts) {}
  private role(actor: Actor, stage?: Stage) {
    const roles =
      stage === "accounting"
        ? ["owner", "admin", "accountant"]
        : stage === "management"
          ? ["owner", "admin", "senior_management"]
          : ["owner", "admin", "accountant", "senior_management"];
    if (Number(actor.isActive) !== 1 || !roles.includes(actor.role))
      no("ليس لديك صلاحية لاعتماد حزمة التسعير", "FORBIDDEN");
    if (!this.ports.enabled())
      no("اعتماد حزمة التسعير الموحد غير مفعّل", "BAD_REQUEST");
  }
  private async context(tx: any, id: number, actor: Actor, lock = false) {
    const [root] = await rows(
      tx,
      sql`SELECT a.*,b.bundleNumber,b.delegateId,b.snapshotJson FROM delegate_pricing_bundle_approvals a
      JOIN delegate_pricing_bundles b ON b.id=a.bundleId WHERE a.bundleId=${id} ${lock ? sql`FOR UPDATE` : sql``}`
    );
    if (!root)
      no(
        "حزمة الاعتماد غير موجودة؛ الحزم السابقة تبقى بمسارها القديم",
        "NOT_FOUND"
      );
    const snapshot = parse(root.snapshotJson) as PricingBundleSnapshot;
    if (
      snapshot?.number !== root.bundleNumber ||
      Number(snapshot.delegate?.id) !== Number(root.delegateId) ||
      !Array.isArray(snapshot.rows) ||
      !snapshot.rows.length ||
      snapshot.rows.length > 20
    )
      no("لقطة حزمة التسعير غير مكتملة");
    const links = await rows(
      tx,
      sql`SELECT * FROM delegate_pricing_bundle_batches WHERE bundleId=${id} ORDER BY purchaseOrderId`
    );
    const poIds = Array.from(
      new Set(snapshot.rows.map(row => Number(row.purchaseOrderId)))
    ).sort((a, b) => a - b);
    if (
      links.length !== poIds.length ||
      new Set(links.map(row => Number(row.purchaseOrderId))).size !==
        poIds.length ||
      links.some(link => !poIds.includes(Number(link.purchaseOrderId)))
    )
      no("دفعات الحزمة لا تطابق طلباتها الأصلية");
    const orders = await rows(
      tx,
      sql`SELECT p.*,pk.packageNumber FROM purchase_orders p LEFT JOIN purchase_packages pk ON pk.id=p.packageId WHERE p.id IN (${ids(poIds)}) ORDER BY p.id ${lock ? sql`FOR UPDATE` : sql``}`
    );
    if (orders.length !== poIds.length) no("أحد طلبات الحزمة غير موجود");
    const guard = await this.ports.readGuard(actor);
    // The accountant's ordinary PO visibility ends at pending_accounting.
    // A committed decision may only be read/replayed by its exact approver in
    // this DPB scope. Keep every other parent/identity check and the central
    // guard; this projection must never escape to PO lists or new decisions.
    const ownCommittedAccounting =
      actor.role === "accountant" &&
      Number(root.accountingApprovedById) === actor.id &&
      !!root.accountingApprovedAt &&
      !!root.accountingOperationKey &&
      !!root.accountingRequestHash &&
      root.status !== "pending_accounting";
    const managementScope =
      actor.role === "senior_management" &&
      ((root.status === "pending_management" &&
        Number(root.accountingApprovedById) > 0 &&
        !!root.accountingApprovedAt) ||
        (Number(root.managementApprovedById) === actor.id &&
          !!root.managementApprovedAt &&
          !!root.managementOperationKey &&
          !!root.managementRequestHash));
    const scopedPhase = ownCommittedAccounting
      ? "pending_accounting"
      : managementScope
        ? "pending_management"
        : null;
    if (scopedPhase) {
      const [currentActor] = await rows(
        tx,
        sql`SELECT id,role,isActive FROM users WHERE id=${actor.id}`
      );
      if (
        !currentActor ||
        currentActor.role !== actor.role ||
        Number(currentActor.isActive) !== 1
      )
        no("الحساب غير نشط أو تغير دوره", "FORBIDDEN");
    }
    for (const order of orders)
      guard(scopedPhase ? { ...order, status: scopedPhase } : order);
    const batchIds = links
      .map(row => Number(row.pricingBatchId))
      .sort((a, b) => a - b);
    const batches = await rows(
      tx,
      sql`SELECT * FROM po_pricing_batches WHERE id IN (${ids(batchIds)}) ORDER BY id ${lock ? sql`FOR UPDATE` : sql``}`
    );
    if (batches.length !== batchIds.length) no("إحدى دفعات التسعير غير موجودة");
    for (const link of links) {
      const batch = batches.find(
        row => Number(row.id) === Number(link.pricingBatchId)
      );
      if (
        !batch ||
        Number(batch.purchaseOrderId) !== Number(link.purchaseOrderId) ||
        Number(batch.submittedById) !== Number(root.delegateId) ||
        (batch.purchasePackageSubmissionId ?? null) !==
          (link.purchasePackageSubmissionId ?? null)
      )
        no("تغير ارتباط دفعة التسعير");
    }
    const submissionIds = Array.from(
      new Set(
        links
          .filter(row => row.purchasePackageSubmissionId != null)
          .map(row => Number(row.purchasePackageSubmissionId))
      )
    ).sort((a, b) => a - b);
    const submissions = submissionIds.length
      ? await rows(
          tx,
          sql`SELECT * FROM purchase_package_submissions WHERE id IN (${ids(submissionIds)}) ORDER BY id ${lock ? sql`FOR UPDATE` : sql``}`
        )
      : [];
    if (submissions.length !== submissionIds.length)
      no("دفعة إرسال حزمة الشراء غير موجودة");
    if (submissionIds.length) {
      const all = await rows(
        tx,
        sql`SELECT id FROM po_pricing_batches WHERE purchasePackageSubmissionId IN (${ids(submissionIds)})`
      );
      if (all.some(row => !batchIds.includes(Number(row.id))))
        no("دفعة PB تضم أصنافًا خارج DPB الحالية");
    }
    for (const link of links.filter(
      row => row.purchasePackageSubmissionId != null
    )) {
      const sub = submissions.find(
        row => Number(row.id) === Number(link.purchasePackageSubmissionId)
      );
      const order = orders.find(
        row => Number(row.id) === Number(link.purchaseOrderId)
      );
      if (
        Number(sub.purchasePackageId) !== Number(order.packageId) ||
        !order.packageNumber
      )
        no("دفعة PB لا تتبع حزمة طلب الشراء أو أن الحزمة غير موجودة");
    }
    const itemIds = snapshot.rows
      .map(row => Number(row.id))
      .sort((a, b) => a - b);
    const members = await rows(
      tx,
      sql`SELECT purchaseOrderItemId FROM delegate_pricing_bundle_items WHERE bundleId=${id} AND removedAt IS NULL`
    );
    if (
      new Set(itemIds).size !== itemIds.length ||
      members.length !== itemIds.length ||
      members.some(row => !itemIds.includes(Number(row.purchaseOrderItemId)))
    )
      no("تغيرت عضوية أصناف الحزمة");
    const items = await rows(
      tx,
      sql`SELECT * FROM purchase_order_items WHERE id IN (${ids(itemIds)}) ORDER BY id ${lock ? sql`FOR UPDATE` : sql``}`
    );
    if (items.length !== itemIds.length) no("أحد أصناف الحزمة غير موجود");
    const priorRejected = new Set(
      rejected(root).map((row: any) => Number(row.itemId))
    );
    for (const item of items) {
      const frozen = snapshot.rows.find(
        row => Number(row.id) === Number(item.id)
      )!;
      const link = links.find(
        row => Number(row.purchaseOrderId) === Number(item.purchaseOrderId)
      );
      const order = orders.find(
        row => Number(row.id) === Number(item.purchaseOrderId)
      );
      if (!order) no("طلب شراء الصنف غير موجود");
      for (const field of [
        "packageId",
        "ticketId",
        "ticketItemId",
        "siteId",
        "sectionId",
      ] as const) {
        if (
          field in frozen &&
          (order[field] == null ? null : Number(order[field])) !==
            (frozen[field] == null ? null : Number(frozen[field]))
        )
          no("تغير سياق طلب الشراء أو البلاغ أو المهمة المرتبطة بالصنف");
      }
      const originalRequester = snapshot.signatures?.find(
        row => Number(row.purchaseOrderId) === Number(item.purchaseOrderId)
      )?.requesterId;
      if (
        originalRequester != null &&
        Number(order.requestedById) !== Number(originalRequester)
      )
        no("تغير منشئ طلب الشراء بعد إرسال التسعير");
      if (
        Number(item.purchaseOrderId) !== Number(frozen.purchaseOrderId) ||
        !link
      )
        no("تغير طلب الشراء المرتبط بالصنف");
      if (
        !priorRejected.has(Number(item.id)) &&
        !["rejected", "cancelled"].includes(item.status) &&
        (Number(item.batchId) !== Number(link.pricingBatchId) ||
          Number(item.delegateId) !== Number(root.delegateId))
      )
        no("تغيرت دفعة الصنف أو المندوب المسند إليه");
    }
    for (const item of items.filter(
      row =>
        !priorRejected.has(Number(row.id)) &&
        !["rejected", "cancelled"].includes(row.status)
    )) {
      const original = snapshot.rows.find(
        row => Number(row.id) === Number(item.id)
      )!;
      if (
        Number(item.quantity) !== Number(original.quantity) ||
        Number(item.estimatedUnitCost) !== Number(original.estimatedUnitCost) ||
        Number(item.estimatedTotalCost) !==
          Number(original.estimatedTotalCost) ||
        quoteUnit(item.unit) !== quoteUnit(original.unit) ||
        item.itemName !== original.itemName
      )
        no("تغيرت بيانات صنف بعد إرسال التسعير؛ لا يمكن اعتماد لقطة مختلفة");
    }
    const batchItems = await rows(
      tx,
      sql`SELECT id FROM purchase_order_items WHERE batchId IN (${ids(batchIds)})`
    );
    if (batchItems.some(row => !itemIds.includes(Number(row.id))))
      no("إحدى الدفعات تضم صنفًا خارج حزمة التسعير");
    return {
      root,
      snapshot,
      links,
      orders,
      batches,
      submissions,
      items,
      priorRejected,
    };
  }
  async detail(actor: Actor, id: number) {
    this.role(actor);
    const c = await this.context(await this.ports.database(), id, actor);
    return this.dto(c);
  }
  private dto(c: any) {
    return {
      id: Number(c.root.bundleId),
      bundleNumber: c.root.bundleNumber,
      delegateId: Number(c.root.delegateId),
      delegateName: c.snapshot.delegate.name,
      status: c.root.status,
      revision: Number(c.root.revision),
      custodyBalance: c.root.custodyBalance,
      accountingNotes: c.root.accountingNotes,
      managementNotes: c.root.managementNotes,
      accountingApprovedById: c.root.accountingApprovedById,
      managementApprovedById: c.root.managementApprovedById,
      accountingEffectsDone: Number(c.root.accountingEffectsDone) === 1,
      managementEffectsDone: Number(c.root.managementEffectsDone) === 1,
      rejections: rejected(c.root),
      items: c.snapshot.rows.map((row: any) => ({
        ...row,
        packageNumber:
          c.orders.find(
            (order: any) => Number(order.id) === Number(row.purchaseOrderId)
          )?.packageNumber || null,
        currentStatus: c.priorRejected.has(Number(row.id))
          ? rejected(c.root).find(
              (decision: any) => Number(decision.itemId) === Number(row.id)
            )?.status || "rejected"
          : c.items.find((item: any) => Number(item.id) === Number(row.id))
              .status,
      })),
      orderIds: c.orders.map((row: any) => Number(row.id)),
      submissionIds: c.submissions.map((row: any) => Number(row.id)),
      batchIds: c.batches.map((row: any) => Number(row.id)),
    };
  }
  async queue(actor: Actor, afterId = 0) {
    this.role(actor);
    const database = await this.ports.database();
    const stage =
      actor.role === "senior_management"
        ? "pending_management"
        : actor.role === "accountant"
          ? "pending_accounting"
          : null;
    const parents = await rows(
      database,
      sql`SELECT a.bundleId AS id,a.status,a.revision,a.custodyBalance,b.bundleNumber,b.delegateId
      FROM delegate_pricing_bundle_approvals a JOIN delegate_pricing_bundles b ON b.id=a.bundleId
      WHERE a.bundleId>${afterId} AND ${stage ? sql`a.status=${stage}` : sql`a.status IN ('pending_accounting','pending_management')`}
      AND EXISTS (SELECT 1 FROM delegate_pricing_bundle_batches l WHERE l.bundleId=a.bundleId)
      AND EXISTS (SELECT 1 FROM delegate_pricing_bundle_items m WHERE m.bundleId=a.bundleId AND m.removedAt IS NULL)
      AND NOT EXISTS (SELECT 1 FROM delegate_pricing_bundle_batches l LEFT JOIN po_pricing_batches pb ON pb.id=l.pricingBatchId
        LEFT JOIN purchase_orders p ON p.id=l.purchaseOrderId LEFT JOIN purchase_packages pk ON pk.id=p.packageId LEFT JOIN purchase_package_submissions s ON s.id=l.purchasePackageSubmissionId
        WHERE l.bundleId=a.bundleId AND (pb.id IS NULL OR p.id IS NULL OR pb.purchaseOrderId<>p.id
          OR pb.status IS NULL OR pb.status NOT IN (a.status,'rejected')
          OR (l.purchasePackageSubmissionId IS NULL AND pb.purchasePackageSubmissionId IS NOT NULL)
          OR (l.purchasePackageSubmissionId IS NOT NULL AND (s.id IS NULL OR pk.id IS NULL OR pb.purchasePackageSubmissionId IS NULL OR pb.purchasePackageSubmissionId<>s.id OR p.packageId IS NULL OR p.packageId<>s.purchasePackageId))))
      AND NOT EXISTS (SELECT 1 FROM delegate_pricing_bundle_items m LEFT JOIN purchase_order_items i ON i.id=m.purchaseOrderItemId
        LEFT JOIN delegate_pricing_bundle_batches l ON l.bundleId=m.bundleId AND l.purchaseOrderId=i.purchaseOrderId
        WHERE m.bundleId=a.bundleId AND m.removedAt IS NULL AND (i.id IS NULL OR l.pricingBatchId IS NULL))
      ORDER BY a.bundleId LIMIT 51`
    );
    const page = parents.slice(0, 50);
    if (!page.length) return { items: [], nextId: null };
    const links = await rows(
      database,
      sql`SELECT bundleId,purchaseOrderId,pricingBatchId,purchasePackageSubmissionId FROM delegate_pricing_bundle_batches WHERE bundleId IN (${ids(page.map(row => Number(row.id)))})`
    );
    const orders = await readScopeChunks(
      links.map(row => Number(row.purchaseOrderId)),
      chunk =>
        rows(
          database,
          sql`SELECT * FROM purchase_orders WHERE id IN (${ids(chunk)})`
        )
    );
    const guard = await this.ports.readGuard(actor);
    const byId = new Map(orders.map(row => [Number(row.id), row]));
    const visible = page.filter(parent => {
      const members = links.filter(
        row => Number(row.bundleId) === Number(parent.id)
      );
      if (!members.length) return false;
      try {
        for (const member of members) {
          const order = byId.get(Number(member.purchaseOrderId));
          if (!order) return false;
          guard(order);
        }
        return true;
      } catch (error) {
        if (error instanceof TRPCError && error.code === "FORBIDDEN")
          return false;
        throw error;
      }
    });
    const visibleBundleIds = new Set(visible.map(parent => Number(parent.id)));
    const visibleBatchIds = new Set(
      links
        .filter(link => visibleBundleIds.has(Number(link.bundleId)))
        .map(link => Number(link.pricingBatchId))
    );
    const allPending = await readScopeChunks(Array.from(byId.keys()), chunk =>
      rows(
        database,
        sql`SELECT id,purchaseOrderId,purchasePackageSubmissionId FROM po_pricing_batches WHERE purchaseOrderId IN (${ids(chunk)}) AND status IN ('pending_accounting','pending_management')`
      )
    );
    return {
      items: visible.map(parent => {
        const members = links.filter(
          row => Number(row.bundleId) === Number(parent.id)
        );
        const batchIds = members.map(row => Number(row.pricingBatchId));
        return {
          ...parent,
          id: Number(parent.id),
          orderIds: members.map(row => Number(row.purchaseOrderId)),
          batchIds,
          submissionIds: Array.from(
            new Set(
              members
                .filter(row => row.purchasePackageSubmissionId != null)
                .map(row => Number(row.purchasePackageSubmissionId))
            )
          ),
          coveredOrderIds: members
            .map(row => Number(row.purchaseOrderId))
            .filter(id => {
              const pending = allPending.filter(
                row => Number(row.purchaseOrderId) === id
              );
              return (
                pending.length === 0 ||
                pending.every(row => visibleBatchIds.has(Number(row.id)))
              );
            }),
        };
      }),
      nextId: parents.length > 50 ? Number(page[49].id) : null,
    };
  }
  async approve(actor: Actor, stage: Stage, input: UnifiedApprovalInput) {
    this.role(actor, stage);
    const database = await this.ports.database();
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ stage, input, actorId: actor.id }))
      .digest("hex");
    const result = await database.transaction(async (tx: any) => {
      const [currentActor] = await rows(
        tx,
        sql`SELECT id,role,isActive,name,signatureUrl FROM users WHERE id=${actor.id} FOR UPDATE`
      );
      if (
        !currentActor ||
        currentActor.role !== actor.role ||
        Number(currentActor.isActive) !== 1
      )
        no("الحساب غير نشط أو تغير دوره", "FORBIDDEN");
      const c = await this.context(tx, input.id, actor, true);
      const r = c.root;
      const priorKey =
        stage === "accounting"
          ? r.accountingOperationKey
          : r.managementOperationKey;
      const priorHash =
        stage === "accounting"
          ? r.accountingRequestHash
          : r.managementRequestHash;
      if (priorKey === input.operationKey) {
        if (priorHash !== fingerprint) no("مفتاح العملية مستخدم لبيانات أخرى");
        return {
          id: input.id,
          status: r.status,
          revision: Number(r.revision),
          replayed: true,
        };
      }
      if (
        Number(r.revision) !== input.revision ||
        r.status !==
          (stage === "accounting" ? "pending_accounting" : "pending_management")
      )
        no("تغيرت مرحلة الحزمة؛ حدّث البيانات");
      this.ports.authorizeStage(actor, stage, c.orders);
      const active = c.items.filter(
        item =>
          !c.priorRejected.has(Number(item.id)) &&
          !["rejected", "cancelled"].includes(item.status)
      );
      if (
        c.orders.some(
          order =>
            ["closed", "rejected"].includes(order.status) &&
            active.some(
              item => Number(item.purchaseOrderId) === Number(order.id)
            )
        )
      )
        no("طلب شراء مرتبط مغلق أو مرفوض؛ يلزم مراجعة ارتباطه");
      if (active.some(item => item.status !== "estimated"))
        no("تغيرت الأصناف؛ الحزمة لا تحتوي أصنافًا جاهزة للاعتماد");
      const decisions = new Map<number, string>();
      for (const row of input.rejections) {
        if (
          decisions.has(row.itemId) ||
          !active.some(item => Number(item.id) === row.itemId) ||
          row.reason.trim().length < 10
        )
          no("الصنف المرفوض خارج الحزمة أو السبب غير مكتمل", "BAD_REQUEST");
        decisions.set(row.itemId, row.reason.trim());
      }
      const kept = active.filter(item => !decisions.has(Number(item.id)));
      const effectiveRejections = [
        ...input.rejections,
        ...c.items
          .filter(
            item =>
              !c.priorRejected.has(Number(item.id)) &&
              ["rejected", "cancelled"].includes(item.status)
          )
          .map(item => ({
            itemId: Number(item.id),
            reason:
              item.managementRejectionReason ||
              (item.status === "cancelled"
                ? "الصنف ملغى قبل مراجعة الحزمة"
                : "الصنف مرفوض قبل مراجعة الحزمة"),
            status: item.status,
            observedBeforeApproval: true,
          })),
      ];
      const amount = input.custodyBalance?.trim();
      if (
        stage === "accounting" &&
        kept.length &&
        (!amount ||
          !/^\d{1,10}(\.\d{1,2})?$/.test(amount) ||
          Number(amount) <= 0)
      )
        no("أدخل مبلغ العهدة يدويًا بقيمة صحيحة أكبر من صفر", "BAD_REQUEST");
      const signature = captureDocumentSignature({
        ...currentActor,
        id: Number(currentActor.id),
      });
      for (const batch of c.batches) {
        const members = active.filter(
          item => Number(item.batchId) === Number(batch.id)
        );
        if (!members.length) {
          if (
            batch.status ===
            (stage === "accounting"
              ? "pending_accounting"
              : "pending_management")
          )
            await tx.execute(
              sql`UPDATE po_pricing_batches SET status='rejected' WHERE id=${Number(batch.id)}`
            );
          continue;
        }
        if (
          batch.status !==
          (stage === "accounting" ? "pending_accounting" : "pending_management")
        )
          no("تغيرت مرحلة إحدى دفعات الحزمة");
        const rejectedItem = members.find(item =>
          decisions.has(Number(item.id))
        );
        const replacement = await this.ports.replacement(
          tx,
          actor,
          stage,
          batch,
          rejectedItem
            ? {
                itemId: Number(rejectedItem.id),
                reason: decisions.get(Number(rejectedItem.id))!,
              }
            : undefined,
          input.notes || "",
          signature
        );
        for (const item of members) {
          const reason = decisions.get(Number(item.id));
          if (reason) {
            if (!replacement)
              await this.ports.updateItem(
                tx,
                item,
                { status: "rejected", managementRejectionReason: reason },
                actor,
                r.bundleNumber
              );
          } else if (stage === "management" && !replacement)
            await this.ports.updateItem(
              tx,
              item,
              { status: "approved" },
              actor,
              r.bundleNumber
            );
        }
        const hasAccepted = members.some(
          item => !decisions.has(Number(item.id))
        );
        const status = hasAccepted
          ? stage === "accounting"
            ? "pending_management"
            : "approved"
          : "rejected";
        const total =
          members
            .filter(item => !decisions.has(Number(item.id)))
            .reduce(
              (sum, item) =>
                sum + Math.round(Number(item.estimatedTotalCost) * 100),
              0
            ) / 100;
        if (stage === "accounting")
          await tx.execute(sql`UPDATE po_pricing_batches SET status=${status},accountingApprovedById=${actor.id},accountingApprovedAt=CURRENT_TIMESTAMP,
          accountingSignatureSnapshot=${signature},accountingNotes=${input.notes || null},totalEstimatedCost=${total.toFixed(2)} WHERE id=${Number(batch.id)}`);
        else
          await tx.execute(
            sql`UPDATE po_pricing_batches SET status=${status},totalEstimatedCost=${total.toFixed(2)},managementApprovedById=${actor.id},managementApprovedAt=CURRENT_TIMESTAMP,managementNotes=${input.notes || null} WHERE id=${Number(batch.id)}`
          );
      }
      // PB rows carry workflow projections only. The free custody field is stored ONCE on DPB.
      for (const sub of c.submissions) {
        const batchIds = c.batches
          .filter(b => Number(b.purchasePackageSubmissionId) === Number(sub.id))
          .map(b => Number(b.id));
        const [summary] = await rows(
          tx,
          sql`SELECT COUNT(*) AS activeCount,COALESCE(SUM(totalEstimatedCost),0) AS total FROM po_pricing_batches WHERE id IN (${ids(batchIds)}) AND status<>'rejected'`
        );
        const status =
          Number(summary.activeCount) > 0
            ? stage === "accounting"
              ? "pending_management"
              : "approved"
            : "rejected";
        if (stage === "accounting")
          await tx.execute(sql`UPDATE purchase_package_submissions SET status=${status},totalEstimatedCost=${String(summary.total)},
          accountingApprovedById=${actor.id},accountingApprovedAt=CURRENT_TIMESTAMP,accountingSignatureSnapshot=${signature} WHERE id=${Number(sub.id)}`);
        else
          await tx.execute(
            sql`UPDATE purchase_package_submissions SET status=${status},totalEstimatedCost=${String(summary.total)},managementApprovedById=${actor.id},managementApprovedAt=CURRENT_TIMESTAMP WHERE id=${Number(sub.id)}`
          );
      }
      for (const order of c.orders) {
        const allItems = await rows(
          tx,
          sql`SELECT status,batchId FROM purchase_order_items WHERE purchaseOrderId=${Number(order.id)}`
        );
        const pending = await rows(
          tx,
          sql`SELECT status FROM po_pricing_batches WHERE purchaseOrderId=${Number(order.id)} AND status IN ('pending_accounting','pending_management')`
        );
        const activeAll = allItems.filter(
          item => !["rejected", "cancelled"].includes(item.status)
        );
        let status = order.status;
        if (!activeAll.length) status = "rejected";
        else if (pending.some(row => row.status === "pending_accounting"))
          status = "pending_accounting";
        else if (pending.length) status = "pending_management";
        else if (
          ["pending_accounting", "pending_management"].includes(order.status)
        ) {
          if (activeAll.every(item => item.status === "delivered_to_warehouse"))
            status = "received";
          else if (
            activeAll.every(item =>
              ["purchased", "delivered_to_warehouse"].includes(item.status)
            )
          )
            status = "purchased";
          else if (
            activeAll.some(item =>
              ["purchased", "delivered_to_warehouse"].includes(item.status)
            )
          )
            status = "partial_purchase";
          else if (
            activeAll.some(
              item =>
                !item.batchId && ["pending", "estimated"].includes(item.status)
            )
          )
            status = "pending_estimate";
          else status = "approved";
        }
        if (status !== order.status)
          await tx.execute(
            sql`UPDATE purchase_orders SET status=${status} WHERE id=${Number(order.id)}`
          );
      }
      const finalStatus = kept.length
        ? stage === "accounting"
          ? "pending_management"
          : "approved"
        : "rejected";
      if (stage === "accounting")
        await tx.execute(sql`UPDATE delegate_pricing_bundle_approvals SET status=${finalStatus},revision=revision+1,custodyBalance=${kept.length ? amount! : null},
        accountingApprovedById=${actor.id},accountingApprovedAt=CURRENT_TIMESTAMP,accountingSignatureSnapshot=${signature},accountingNotes=${input.notes || null},
        accountingRejections=${JSON.stringify(effectiveRejections)},accountingOperationKey=${input.operationKey},accountingRequestHash=${fingerprint} WHERE bundleId=${input.id}`);
      else
        await tx.execute(sql`UPDATE delegate_pricing_bundle_approvals SET status=${finalStatus},revision=revision+1,managementApprovedById=${actor.id},managementApprovedAt=CURRENT_TIMESTAMP,
        managementSignatureSnapshot=${signature},managementNotes=${input.notes || null},managementRejections=${JSON.stringify(effectiveRejections)},managementOperationKey=${input.operationKey},managementRequestHash=${fingerprint} WHERE bundleId=${input.id}`);
      await tx.execute(
        sql`INSERT INTO audit_logs (userId,action,entityType,entityId,newValues) VALUES (${actor.id},${`approve_dpb_${stage}`},'delegate_pricing_bundle',${input.id},${JSON.stringify({ status: finalStatus, rejections: input.rejections, operationKey: input.operationKey })})`
      );
      return {
        id: input.id,
        status: finalStatus,
        revision: Number(r.revision) + 1,
        replayed: false,
      };
    });
    try {
      await this.finish(actor, input.id, stage);
      return { ...result, effectsDone: true };
    } catch (error) {
      console.error("[DPB approval] Pending workflow synchronization", error);
      return { ...result, effectsDone: false };
    }
  }
  async resumeApproval(actor: Actor, id: number, stage: Stage) {
    this.role(actor, stage);
    const result = await this.finish(actor, id, stage);
    return { id, status: result.status, effectsDone: true };
  }
  async finish(actor: Actor, id: number, stage: Stage | "send") {
    const database = await this.ports.database();
    return database.transaction(async (tx: any) => {
      const [currentActor] = await rows(
        tx,
        sql`SELECT id,role,isActive FROM users WHERE id=${actor.id}`
      );
      if (
        !currentActor ||
        currentActor.role !== actor.role ||
        Number(currentActor.isActive) !== 1
      )
        no("الحساب غير نشط أو تغير دوره", "FORBIDDEN");
      if (stage !== "send") this.role(actor, stage);
      // Lock the durable marker only. Follow-up writers use their own existing transactions.
      await rows(
        tx,
        sql`SELECT bundleId FROM delegate_pricing_bundle_approvals WHERE bundleId=${id} FOR UPDATE`
      );
      const c = await this.context(tx, id, actor);
      const decidedBy =
        stage === "accounting"
          ? c.root.accountingApprovedById
          : stage === "management"
            ? c.root.managementApprovedById
            : c.root.delegateId;
      const decidedAt =
        stage === "accounting"
          ? c.root.accountingApprovedAt
          : stage === "management"
            ? c.root.managementApprovedAt
            : c.snapshot.submittedAt;
      if (Number(decidedBy) !== actor.id || !decidedAt)
        no("استكمال المتابعة متاح لصاحب القرار المحفوظ فقط", "FORBIDDEN");
      const done =
        stage === "send"
          ? c.root.sendEffectsDone
          : stage === "accounting"
            ? c.root.accountingEffectsDone
            : c.root.managementEffectsDone;
      if (Number(done) === 1) return { status: c.root.status };
      await this.ports.finish(c, actor, stage);
      if (stage === "send")
        await tx.execute(
          sql`UPDATE delegate_pricing_bundle_approvals SET sendEffectsDone=1 WHERE bundleId=${id}`
        );
      else if (stage === "accounting")
        await tx.execute(
          sql`UPDATE delegate_pricing_bundle_approvals SET accountingEffectsDone=1 WHERE bundleId=${id}`
        );
      else
        await tx.execute(
          sql`UPDATE delegate_pricing_bundle_approvals SET managementEffectsDone=1 WHERE bundleId=${id}`
        );
      return { status: c.root.status };
    });
  }
}
