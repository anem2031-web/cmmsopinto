import { isDelegateRole } from "@shared/roles";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CatalogPickerDialog } from "@/components/catalog/CatalogPickerDialog";
import { toast } from "sonner";

const replacementStatus: Record<string, string> = {
  draft: "مسودة", pending_review: "بانتظار مراجعة الطلب", pricing: "بانتظار التسعير",
  pending_accounting: "بانتظار الحسابات", pending_management: "بانتظار الإدارة العليا",
  ready_to_purchase: "معتمد وجاهز للشراء", purchased: "تم الشراء وبانتظار الاستلام",
  partially_received: "استلام جزئي", received: "تم استلام البديل", cancelled: "ملغى",
};

export function SupplierReturns({ centerMode = false, search = "" }: { centerMode?: boolean; search?: string } = {}) {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [returnStatus, setReturnStatus] = useState<"active" | "completed">("active");
  const [reason, setReason] = useState<Record<number, string>>({});
  const [refundReference, setRefundReference] = useState<Record<number, string>>({});
  const [refundMethod, setRefundMethod] = useState<Record<number, "cash" | "transfer">>({});
  const [pickerCaseId, setPickerCaseId] = useState<number | null>(null);
  const [replacement, setReplacement] = useState<Record<number, { id: number; name: string; unit: string; image: string; quantity: number }>>({});
  // Retain the key for an uncertain retry of the SAME payload, not for a new action.
  const [keys] = useState(() => new Map<string, string>());
  const status = trpc.supplierReturns.status.useQuery();
  const list = trpc.supplierReturns.list.useQuery({ page, pageSize: 20, status: returnStatus }, { enabled: status.data?.enabled === true });
  useEffect(() => {
    if (list.data && page > Math.max(1, Math.ceil(list.data.total / 20))) setPage(Math.max(1, Math.ceil(list.data.total / 20)));
  }, [list.data?.total, page]);
  const change = trpc.supplierReturns.command.useMutation({
    onSuccess: () => { toast.success("تم حفظ الإجراء"); void list.refetch(); },
    onError: error => toast.error(error.message),
  });
  const chooseReplacement = trpc.supplierReturns.chooseReplacement.useMutation({
    onSuccess: () => { toast.success("حُفظ اختيار الصنف البديل"); void list.refetch(); },
    onError: error => toast.error(error.message),
  });
  const confirmRefund = trpc.supplierReturns.confirmRefund.useMutation({
    onSuccess: () => { toast.success("تم تسجيل استلام مبلغ المرتجع"); void list.refetch(); },
    onError: error => toast.error(error.message),
  });
  const cancelAfterRefund = trpc.supplierReturns.cancelAfterRefund.useMutation({
    onSuccess: () => { toast.success("أُغلقت متابعة الصنف بعد استرداد المبلغ"); void list.refetch(); },
    onError: error => toast.error(error.message),
  });
  const act = (row: any, action: "accept" | "reject" | "resend" | "resolve", resolution?: "same_item" | "change_item" | "refund") => {
    const rejection = (reason[row.id] ?? "").trim();
    if (action === "reject" && !rejection) { toast.error("سبب عدم الاستلام إلزامي"); return; }
    const command = { caseId: Number(row.id), expectedRevision: Number(row.revision), action,
      ...(action === "reject" ? { reason: rejection } : {}), ...(action === "resolve" ? { resolution } : {}) };
    const identity = JSON.stringify(command);
    if (!keys.has(identity)) keys.set(identity, crypto.randomUUID());
    change.mutate({ ...command, operationKey: keys.get(identity)! } as Parameters<typeof change.mutate>[0]);
  };
  const selectReplacement = (row: any) => {
    const selected = replacement[row.id];
    if (!selected?.id || !Number.isSafeInteger(selected.quantity) || selected.quantity <= 0) { toast.error("اختر صنفًا وكمية صحيحة"); return; }
    const command = { caseId: Number(row.id), expectedRevision: Number(row.revision), catalogItemId: selected.id, quantity: selected.quantity };
    const identity = JSON.stringify(command);
    if (!keys.has(identity)) keys.set(identity, crypto.randomUUID());
    chooseReplacement.mutate({ ...command, operationKey: keys.get(identity)! });
  };
  const loadedRows = list.data?.items ?? [];
  const searchTerm = centerMode ? search.trim().toLocaleLowerCase() : "";
  const visibleRows = searchTerm ? loadedRows.filter(row => [row.itemName, row.returnNumber, row.poNumber, row.parentReturnNumber,
    row.originalReceiptNumber, row.replacementItemName, row.replacementPoNumber, row.returnReason, row.returnedUnit,
    row.replacementPlanStatus, replacementStatus[row.replacementPlanStatus || ""]]
    .some(value => String(value ?? "").toLocaleLowerCase().includes(searchTerm))) : loadedRows;
  if (status.isLoading) return <p>جارٍ التحقق من متابعة المرتجعات…</p>;
  if (status.error) return <p role="alert">{status.error.message}</p>;
  if (!status.data?.enabled) return centerMode ? <p role="status" className="text-sm text-muted-foreground">متابعة مرتجعات المورد غير متاحة حاليًا.</p> : null;
  return <section className="space-y-3" aria-label="متابعة مرتجعات المورد">
    <CatalogPickerDialog open={pickerCaseId != null} onClose={() => setPickerCaseId(null)} onSelect={item => {
      if (pickerCaseId != null) setReplacement(prev => ({ ...prev, [pickerCaseId]: {
        id: item.id, name: item.nameAr, unit: item.unit || "", image: item.primaryImageUrl || "", quantity: 1,
      } }));
      setPickerCaseId(null);
    }} />
    <div className="flex items-center justify-between"><h2 className="font-bold">متابعة مرتجعات المورد</h2><Button variant="outline" onClick={() => void list.refetch()}>تحديث</Button></div>
    <div className="flex gap-2" role="tablist" aria-label="حالة متابعة المرتجع">
      <Button role="tab" aria-selected={returnStatus === "active"} variant={returnStatus === "active" ? "default" : "outline"} onClick={() => { setReturnStatus("active"); setPage(1); }}>قيد المتابعة</Button>
      <Button role="tab" aria-selected={returnStatus === "completed"} variant={returnStatus === "completed" ? "default" : "outline"} onClick={() => { setReturnStatus("completed"); setPage(1); }}>مكتملة</Button>
    </div>
    {list.isLoading && <p>جارٍ التحميل…</p>}
    {list.error && <p role="alert">{list.error.message}</p>}
    {centerMode && list.data && <p className="text-sm text-muted-foreground" role="status">البحث في الصفحة الحالية فقط — المعروض {visibleRows.length} من {loadedRows.length}. إجمالي ملفات الحالة: {list.data.total}.</p>}
    {list.data?.items.length === 0 && <p>{centerMode && (searchTerm || list.data.total > 0) ? "لا توجد بيانات في الصفحة الحالية؛ يمكنك تغيير الصفحة أو حالة المتابعة." : returnStatus === "completed" ? "لا توجد متابعات مرتجع مكتملة." : "لا توجد مرتجعات قيد المتابعة."}</p>}
    {centerMode && searchTerm && loadedRows.length > 0 && visibleRows.length === 0 && <p>لا توجد نتائج مطابقة في الصفحة الحالية؛ جرّب صفحة أخرى أو غيّر البحث.</p>}
    {visibleRows.map(row => <Card key={row.id}><CardContent className="p-4 space-y-3">
      <h3 className="font-semibold">{row.itemName || "صنف المرتجع"} — {row.returnNumber}</h3>
      <p>{row.poNumber || "بدون طلب شراء"} · {row.returnedQuantity} {row.returnedUnit}</p>
      {row.originalReceiptNumber && !row.poNumber && <p>سند الاستلام المستقل: {row.originalReceiptNumber}</p>}
      {row.parentReturnNumber && <p className="text-sm text-muted-foreground">تعويض متتابع للمرتجع: {row.parentReturnNumber}</p>}
      {row.originalPurchaseValue != null && <p>قيمة الكمية المرتجعة من الفاتورة: <strong>{Number(row.originalPurchaseValue).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ر.س</strong></p>}
      {row.supplierCreditAmount != null && <p>رصيد التعويض بعد تأكيد المندوب: <strong>{Number(row.supplierCreditAmount).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ر.س</strong></p>}
      <p>سبب المرتجع: {row.returnReason}</p>
      <p>{row.handoverStatus === "accepted" ? "استلم المندوب المرتجع" : row.handoverStatus === "rejected" ? "أُعيد للمستودع لمراجعة التسليم" : "بانتظار تأكيد استلام المندوب"}</p>
      {row.rejectionReason && <p>سبب عدم الاستلام: {row.rejectionReason}</p>}
      {!row.closedAt && isDelegateRole(user?.role) && row.handoverStatus === "awaiting_delegate" && <div className="space-y-2">
        <Button disabled={change.isPending} onClick={() => act(row, "accept")}>استلمت المرتجع</Button>
        <Input aria-label="سبب عدم استلام المرتجع" placeholder="سبب عدم الاستلام (إلزامي عند الرفض)" value={reason[row.id] ?? ""} onChange={event => setReason({ ...reason, [row.id]: event.target.value })} />
        <Button variant="outline" disabled={change.isPending} onClick={() => act(row, "reject")}>لم أستلم المرتجع</Button>
      </div>}
      {!row.closedAt && ["warehouse", "admin", "owner"].includes(user?.role ?? "") && row.handoverStatus === "rejected" && <Button disabled={change.isPending} onClick={() => act(row, "resend")}>إعادة التسليم للمندوب</Button>}
      {!row.closedAt && isDelegateRole(user?.role) && row.handoverStatus === "accepted" && !row.resolution && <div className="flex gap-2 flex-wrap">
        <Button disabled={change.isPending} onClick={() => act(row, "resolve", "same_item")}>استبدال بنفس الصنف</Button>
        <Button variant="outline" disabled={change.isPending} onClick={() => act(row, "resolve", "change_item")}>طلب صنف بديل من منشئ الطلب</Button>
        <Button variant="outline" disabled={change.isPending} onClick={() => act(row, "resolve", "refund")}>استرداد المبلغ</Button>
      </div>}
      {row.resolution && <p>الإجراء المختار: {row.resolution === "same_item" ? "استبدال بنفس الصنف" : row.resolution === "change_item" ? "طلب صنف بديل" : "استرداد المبلغ"}</p>}
      {!row.closedAt && row.resolution === "refund" && !row.confirmedRefundId && isDelegateRole(user?.role) && Number(row.delegateId) === user?.id && <div className="space-y-2 rounded-md border p-3">
        <p>أكد استلام مبلغ المرتجع من المورد بعد وصول النقد أو التحويل فعليًا.</p>
        <select aria-label="طريقة استلام المبلغ" value={refundMethod[row.id] || "cash"} onChange={event => setRefundMethod(prev => ({...prev,[row.id]:event.target.value as "cash" | "transfer"}))}>
          <option value="cash">نقدًا</option><option value="transfer">تحويل</option>
        </select>
        <Input aria-label="مرجع استلام مبلغ المرتجع" placeholder="رقم التحويل أو مرجع الاستلام" value={refundReference[row.id] || ""} onChange={event => setRefundReference(prev => ({...prev,[row.id]:event.target.value}))} />
        <Button disabled={confirmRefund.isPending} onClick={() => {
          const reference = (refundReference[row.id] || "").trim();
          if (reference.length < 3) { toast.error("مرجع الاستلام إلزامي"); return; }
          const command = {caseId:Number(row.id),expectedRevision:Number(row.revision),method:refundMethod[row.id] || "cash" as const,reference};
          const identity = JSON.stringify(command);
          if (!keys.has(identity)) keys.set(identity, crypto.randomUUID());
          confirmRefund.mutate({...command,operationKey:keys.get(identity)!});
        }}>تأكيد استلام مبلغ المرتجع</Button>
      </div>}
      {!row.closedAt && (row.resolution === "change_item" || row.resolution === "refund" && row.confirmedRefundId) && row.creatorDecision === "pending" && Number(row.creatorId) === user?.id && <div className="space-y-2 rounded-md border p-3">
        <p className="font-medium">اختر الصنف البديل قبل إنشاء طلب الشراء</p>
        <Button variant="outline" onClick={() => setPickerCaseId(Number(row.id))}>اختيار من الكتالوج</Button>
        {replacement[row.id] && <div className="flex items-center gap-2 flex-wrap"><span>{replacement[row.id].name} — {replacement[row.id].unit}</span>
          <Input aria-label="كمية الصنف البديل" type="number" min={1} step={1} className="w-24" value={replacement[row.id].quantity}
            onChange={event => setReplacement(prev => ({ ...prev, [row.id]: { ...prev[row.id], quantity: Number(event.target.value) } }))} />
          <Button disabled={chooseReplacement.isPending} onClick={() => selectReplacement(row)}>حفظ اختيار البديل</Button></div>}
      </div>}
      {row.confirmedRefundId && <p className="text-emerald-800">تم تأكيد استرداد المبلغ: {Number(row.confirmedRefundAmount ?? row.originalPurchaseValue).toFixed(2)} ر.س — المرجع: {row.refundReference || "—"}</p>}
      {row.closedAt && <p className="text-emerald-800">{row.replacementPlanStatus === "received" ? "اكتملت متابعة المرتجع باستلام البديل." : "أُغلقت متابعة التعويض بعد استرداد المبلغ وقرار منشئ الطلب."}</p>}
      {!row.closedAt && row.resolution === "refund" && !row.confirmedRefundId && row.creatorDecision === "pending" && Number(row.creatorId) === user?.id
        && <p className="text-amber-800">بانتظار توثيق استرداد المبلغ قبل اتخاذ قرار الصنف الأصلي.</p>}
      {!row.closedAt && row.resolution === "refund" && row.confirmedRefundId && row.creatorDecision === "pending" && Number(row.creatorId) === user?.id
        && <Button variant="outline" disabled={cancelAfterRefund.isPending} onClick={() => {
          const command = { caseId: Number(row.id), expectedRevision: Number(row.revision) };
          const identity = JSON.stringify({ action: "cancelAfterRefund", ...command });
          if (!keys.has(identity)) keys.set(identity, crypto.randomUUID());
          cancelAfterRefund.mutate({ ...command, operationKey: keys.get(identity)! });
        }}>إلغاء الصنف غير المرتبط بعد الاسترداد</Button>}
      {row.replacementPlanId && <div className="rounded-md border p-3 space-y-1">
        <p>{row.parentReplacementPlanId ? "الصنف المرتجع في هذه الجولة" : "الاحتياج الأصلي"}: {row.itemName || "صنف المرتجع"} — {row.returnedQuantity} {row.returnedUnit}</p>
        <p>البديل المرتبط: {row.replacementItemName || "بانتظار تحديد الصنف"} — {row.replacementQuantity} {row.replacementUnit}</p>
        <p>خطة البديل #{row.replacementPlanId} · {row.replacementPurchaseOrderId
          ? <a className="text-primary underline" href={`/purchase-orders/${row.replacementPurchaseOrderId}`}>طلب الشراء {row.replacementPoNumber || `#${row.replacementPurchaseOrderId}`}</a>
          : "بانتظار إنشاء طلب الشراء التعويضي"}</p>
        {row.replacementPlanStatus && <p>مرحلة التعويض: {replacementStatus[row.replacementPlanStatus] || row.replacementPlanStatus}</p>}
        {row.replacementQuotedTotal != null && <p>سعر البديل: {Number(row.replacementQuotedTotal).toFixed(2)} ر.س · رصيد المرتجع المستخدم: {Number(row.replacementCreditAllocated ?? 0).toFixed(2)} ر.س · فرق العهدة: {Number(row.replacementAdditionalFunding ?? 0).toFixed(2)} ر.س</p>}
        {row.residualCustodyAmount != null && Number(row.residualCustodyAmount) > 0 && <p className="font-semibold text-amber-800">متبقٍ بعهدة المندوب: {Number(row.residualCustodyAmount).toFixed(2)} ر.س</p>}
      </div>}
      {row.replacementPlanId && !row.replacementPurchaseOrderId && row.replacementPlanStatus === "pending_review"
        && (Number(row.creatorId) === user?.id || ["admin", "owner"].includes(user?.role || ""))
        && <a className="inline-flex rounded-md bg-primary px-3 py-2 text-primary-foreground" href={`/purchase-orders/new?${new URLSearchParams({
          supplierReturnPlanId: String(row.replacementPlanId),
          returnItemName: String(row.replacementItemName || ""), returnQuantity: String(row.replacementQuantity || ""),
          returnUnit: String(row.replacementUnit || ""), returnCatalogItemId: String(row.replacementCatalogItemId || ""),
          returnPhotoUrl: String(row.replacementPhotoUrl || (row.resolution === "same_item" ? row.originalPhotoUrl : "") || ""),
          siteId: String(row.originalSiteId || ""), sectionId: String(row.originalSectionId || ""),
          categoryId: String(row.originalCategoryId || ""), assetId: String(row.originalAssetId || ""),
          itemSiteId: String(row.originalItemSiteId || row.originalSiteId || ""),
          itemSectionId: String(row.originalItemSectionId || row.originalSectionId || ""),
          itemCategoryId: String(row.originalItemCategoryId || row.originalCategoryId || ""),
          itemAssetId: String(row.originalItemAssetId || row.originalAssetId || ""),
          ticketId: String(row.originalTicketId || ""), ticketItemId: String(row.originalTicketItemId || ""),
        }).toString()}`}>إنشاء طلب شراء البديل</a>}
    </CardContent></Card>)}
    <div className="flex gap-3 items-center"><Button variant="outline" disabled={page === 1 || list.isFetching} onClick={() => setPage(page-1)}>السابق</Button><span>{page}</span><Button variant="outline" disabled={!list.data || page * 20 >= list.data.total || list.isFetching} onClick={() => setPage(page+1)}>التالي</Button></div>
  </section>;
}
