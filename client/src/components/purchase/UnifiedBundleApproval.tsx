import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { useTranslation } from "@/contexts/LanguageContext";

export function BundleApprovalCards({
  items,
  onSelect,
  stage,
}: {
  items: any[];
  onSelect?: (id: number) => void;
  stage?: "accounting" | "management";
}) {
  return (
    <>
      {items.map(row => (
        <Card key={`dpb-approval:${row.id}`}>
          <CardContent className="p-4 flex justify-between gap-3 flex-wrap">
            <div>
              <strong dir="ltr">{row.bundleNumber}</strong>
              <p className="text-sm">
                {row.status === "pending_accounting"
                  ? "بانتظار اعتماد الحسابات"
                  : "بانتظار اعتماد الإدارة العليا"}
              </p>
              <small>{row.orderIds.length} طلب شراء — حزمة تسعير واحدة</small>
            </div>
            {onSelect ? (
              <Button onClick={() => onSelect(row.id)}>مراجعة الحزمة</Button>
            ) : (
              <Link href={`/delegate-pricing-bundles?approval=${row.id}${stage ? `&stage=${stage}` : ""}`}>
                <Button>مراجعة الحزمة</Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ))}
    </>
  );
}
export function UnifiedBundleApproval({
  selectedOnly = false,
}: {
  selectedOnly?: boolean;
}) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const allowed =
    !!user &&
    ["owner", "admin", "accountant", "senior_management"].includes(user.role);
  const params = new URLSearchParams(useSearch());
  const requestedId = Number(params.get("approval") || 0);
  const rawStage = params.get("stage");
  const requestedStage = rawStage === "accounting" || rawStage === "management" ? rawStage : undefined;
  const invalidStage = rawStage !== null && !requestedStage;
  const [selected, setSelected] = useState(requestedId);
  const [afterId, setAfterId] = useState(0);
  const detail = trpc.delegatePricingBundles.approvalDetail.useQuery(
    { id: selected, ...(requestedStage ? { stage: requestedStage } : {}) },
    { enabled: allowed && !invalidStage && selected > 0, retry: false }
  );
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const operation = useRef<{
    fingerprint: string;
    stage: "accounting" | "management";
    payload: any;
    resumeOnly?: boolean;
  } | null>(null);
  const [pendingFollowup, setPendingFollowup] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (requestedId > 0) {
      setSelected(requestedId);
      setPendingFollowup(false);
      operation.current = null;
    }
  }, [requestedId, requestedStage]);
  const utils = trpc.useUtils();
  const data = detail.data;
  const [queueStage, setQueueStage] = useState<"accounting" | "management">(requestedStage ?? "management");
  const isSeniorReviewRole = user?.role === "senior_management";
  const effectiveQueueStage = requestedStage ?? (isSeniorReviewRole ? queueStage : undefined);
  const queue = trpc.delegatePricingBundles.approvalQueue.useQuery(
    { afterId, ...(effectiveQueueStage ? { stage: effectiveQueueStage } : {}) },
    { enabled: allowed && !invalidStage && !selectedOnly, retry: false }
  );
  const returnTo = requestedStage ? `/purchase-orders?reviewStage=${requestedStage}` : "/purchase-orders";
  const actualStage = data?.status === "pending_accounting" ? "accounting" : data?.status === "pending_management" ? "management" : null;
  const stageMatches = !requestedStage || requestedStage === actualStage;
  useEffect(() => {
    setAmount(data?.custodyBalance || "");
    setNotes("");
    setReasons({});
  }, [data?.id, data?.revision]);
  const refresh = () =>
    Promise.all([
      utils.delegatePricingBundles.invalidate(),
      utils.purchaseOrders.invalidate(),
      utils.purchasePackages.invalidate(),
    ]);
  const accounting =
    trpc.delegatePricingBundles.approveAccounting.useMutation();
  const management =
    trpc.delegatePricingBundles.approveManagement.useMutation();
  const resume = trpc.delegatePricingBundles.resumeApproval.useMutation();
  const busy =
    submitting ||
    accounting.isPending ||
    management.isPending ||
    resume.isPending;
  const runOperation = async (op: NonNullable<typeof operation.current>) => {
    setSubmitting(true);
    let committed = pendingFollowup || op.resumeOnly === true;
    try {
      // Retry only the exact committed operation. Never create another decision
      // or repeat a financial writer because a notification/sync failed.
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await (op.resumeOnly
          ? resume.mutateAsync(op.payload)
          : op.stage === "accounting"
            ? accounting.mutateAsync(op.payload)
            : management.mutateAsync(op.payload));
        committed = true;
        if (operation.current !== op) return;
        if (result.effectsDone) {
          setPendingFollowup(false);
          toast.success(
            result.status === "rejected"
              ? "تم حفظ رفض الحزمة"
              : op.stage === "accounting"
                ? "تم الاعتماد والإرسال للإدارة العليا"
                : "تم اعتماد الحزمة وإتاحتها للمندوب"
          );
          void refresh().catch(() =>
            toast.warning("تم حفظ القرار؛ حدّث القائمة لإظهار الحالة الجديدة")
          );
          if (selectedOnly) setLocation(returnTo);
          return;
        }
      }
      setPendingFollowup(true);
      toast.warning(
        "تم حفظ القرار، وتعذّر إتمام الإرسال الآن. أعد محاولة الإرسال من الزر نفسه دون إعادة الاعتماد"
      );
      void refresh().catch(() => {});
    } catch (error) {
      if (operation.current === op) {
        setPendingFollowup(committed);
        toast.error(
          error instanceof Error ? error.message : "تعذر إرسال قرار الحزمة"
        );
      }
    } finally {
      setSubmitting(false);
    }
  };
  useEffect(() => {
    if (
      !allowed ||
      !data ||
      data.id !== selected ||
      submitting ||
      operation.current
    )
      return;
    const stage =
      data.accountingApprovedById === user?.id &&
      data.accountingEffectsDone === false
        ? "accounting"
        : data.managementApprovedById === user?.id &&
            data.managementEffectsDone === false
          ? "management"
          : null;
    if (!stage) return;
    if (requestedStage && requestedStage !== stage) return;
    operation.current = {
      fingerprint: `resume:${data.id}:${stage}`,
      stage,
      payload: { id: data.id, stage },
      resumeOnly: true,
    };
    void runOperation(operation.current);
  }, [
    allowed,
    data?.id,
    data?.revision,
    data?.accountingEffectsDone,
    data?.managementEffectsDone,
    selected,
    user?.id,
    requestedStage,
  ]);
  const submit = () => {
    if (busy) return;
    if (pendingFollowup && operation.current) {
      return runOperation(operation.current);
    }
    if (!data || !stageMatches) return;
    const stage =
      data.status === "pending_accounting" ? "accounting" : "management";
    const rejections = Object.entries(reasons).map(([itemId, reason]) => ({
      itemId: Number(itemId),
      reason: reason.trim(),
    }));
    if (rejections.some(row => row.reason.length < 10)) {
      toast.error("سبب رفض كل صنف يجب ألا يقل عن 10 أحرف");
      return;
    }
    const input = {
      id: data.id,
      revision: data.revision,
      notes: notes.trim() || undefined,
      rejections,
      ...(stage === "accounting" ? { custodyBalance: amount.trim() } : {}),
    };
    const fingerprint = JSON.stringify(input);
    if (operation.current?.fingerprint !== fingerprint)
      operation.current = {
        fingerprint,
        stage,
        payload: { ...input, operationKey: crypto.randomUUID() },
      };
    return runOperation(operation.current);
  };
  if (!allowed) return null;
  if (invalidStage) return <p role="alert">{t.purchaseOrders.approvalStageChanged}</p>;
  const canApprove =
    data &&
    stageMatches &&
    ((data.status === "pending_accounting" &&
      ["owner", "admin", "accountant", "senior_management"].includes(user!.role)) ||
      (data.status === "pending_management" &&
        ["owner", "admin", "senior_management"].includes(user!.role)));
  const managementView =
    data?.status === "pending_management";
  const displayedItems = (data?.items || []).filter(
    (item: any) =>
      !managementView || !["rejected", "cancelled"].includes(item.currentStatus)
  );
  const displayedTotal =
    displayedItems.reduce(
      (sum: number, item: any) =>
        sum + Math.round(Number(item.estimatedTotalCost) * 100),
      0
    ) / 100;
  const acceptedTotal =
    displayedItems
      .filter(
        (item: any) =>
          !["rejected", "cancelled"].includes(item.currentStatus) &&
          !(item.id in reasons)
      )
      .reduce(
        (sum: number, item: any) =>
          sum + Math.round(Number(item.estimatedTotalCost) * 100),
        0
      ) / 100;
  return (
    <section className="space-y-4">
      {selectedOnly && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setLocation(returnTo)}
        >
          رجوع إلى بانتظار إجرائي
        </Button>
      )}
      {!selectedOnly && (
        <>
          <h2 className="font-bold text-lg">حزم التسعير بانتظار الاعتماد</h2>
          {isSeniorReviewRole && !requestedStage && <div className="flex flex-wrap gap-2" aria-label={t.purchaseOrders.reviewStages}>
            {(["accounting", "management"] as const).map(stage => <Button key={stage} variant={queueStage === stage ? "default" : "outline"} aria-pressed={queueStage === stage} onClick={() => { setQueueStage(stage); setAfterId(0); }}>{stage === "accounting" ? t.purchaseOrders.accountingApprovalTab : t.purchaseOrders.managementApprovalTab}</Button>)}
          </div>}
          {queue.error && <p role="alert">{queue.error.message}</p>}
          <BundleApprovalCards items={(queue.data?.items || []).filter((row: any) => !effectiveQueueStage || row.status === `pending_${effectiveQueueStage}`)} stage={effectiveQueueStage} />
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!afterId}
              onClick={() => setAfterId(0)}
            >
              البداية
            </Button>
            <Button
              variant="outline"
              disabled={!queue.data?.nextId}
              onClick={() => setAfterId(queue.data!.nextId!)}
            >
              الحزم التالية
            </Button>
          </div>
        </>
      )}
      {selectedOnly && detail.isLoading && (
        <p role="status">جارٍ تحميل تفاصيل الحزمة…</p>
      )}
      {detail.error && <p role="alert">{detail.error.message}</p>}
      {data && requestedStage && !stageMatches && !pendingFollowup && <p role="status">{t.purchaseOrders.approvalStageChanged}</p>}
      {data && (
        <Card>
          <CardHeader>
            <CardTitle dir="ltr">{data.bundleNumber}</CardTitle>
            <p>المندوب: {data.delegateName || "—"}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              {data.status === "pending_accounting"
                ? "مراجعة الحسابات"
                : data.status === "pending_management"
                  ? "مراجعة الإدارة العليا"
                  : data.status === "approved"
                    ? "الحزمة معتمدة — كل صنف يستكمل مساره الأصلي"
                    : "الحزمة مرفوضة"}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {[
                      "الصنف",
                      "طلب الشراء",
                      "حزمة الطلبات",
                      "الكمية",
                      "الوحدة",
                      "الإجمالي",
                      "الحالة",
                      "القرار",
                    ].map(label => (
                      <th key={label} className="p-2 border">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayedItems.map((item: any) => (
                    <tr key={item.id}>
                      <td className="p-2 border">{item.itemName}</td>
                      <td className="p-2 border">
                        <Link
                          href={`/purchase-orders/${item.purchaseOrderId}?itemId=${item.id}`}
                        >
                          {item.poNumber}
                        </Link>
                      </td>
                      <td className="p-2 border">
                        {item.packageNumber || "—"}
                      </td>
                      <td className="p-2 border">{item.quantity}</td>
                      <td className="p-2 border">{item.unit}</td>
                      <td className="p-2 border">
                        {Number(item.estimatedTotalCost).toFixed(2)}
                      </td>
                      <td className="p-2 border">
                        {(
                          {
                            estimated: "مسعّر",
                            approved: "معتمد للشراء",
                            funded: "معتمد للشراء",
                            purchased: "تم الشراء",
                            delivered_to_warehouse: "مستلم بالمستودع",
                            rejected: "مرفوض",
                            cancelled: "ملغى",
                            pending: "بانتظار التسعير",
                          } as Record<string, string>
                        )[item.currentStatus] || "قيد المتابعة"}
                      </td>
                      <td className="p-2 border">
                        {canApprove &&
                        !pendingFollowup &&
                        item.currentStatus === "estimated" ? (
                          <div className="space-y-2">
                            <label className="flex gap-2">
                              <input
                                type="checkbox"
                                disabled={busy}
                                checked={item.id in reasons}
                                onChange={event =>
                                  setReasons(old => {
                                    const next = { ...old };
                                    if (event.target.checked)
                                      next[item.id] = "";
                                    else delete next[item.id];
                                    return next;
                                  })
                                }
                              />
                              رفض هذا الصنف فقط
                            </label>
                            {item.id in reasons && (
                              <Textarea
                                aria-label={`سبب رفض ${item.itemName}`}
                                maxLength={2000}
                                value={reasons[item.id]}
                                disabled={busy}
                                onChange={event =>
                                  setReasons(old => ({
                                    ...old,
                                    [item.id]: event.target.value,
                                  }))
                                }
                              />
                            )}
                          </div>
                        ) : (
                          data.rejections.find((r: any) => r.itemId === item.id)
                            ?.reason || "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.custodyBalance != null && (
              <p>
                إجمالي رصيد العهد التي على المندوب:{" "}
                <strong>{data.custodyBalance} ر.س</strong>
              </p>
            )}
            {canApprove && !pendingFollowup && (
              <div className="space-y-3">
                {data.status === "pending_accounting" && (
                  <label className="block">
                    إجمالي رصيد العهد التي على المندوب — إدخال يدوي مرة واحدة
                    <Input
                      aria-label="إجمالي رصيد العهد"
                      value={amount}
                      inputMode="decimal"
                      disabled={busy}
                      onChange={event => setAmount(event.target.value)}
                    />
                  </label>
                )}
                <Textarea
                  aria-label="ملاحظات الاعتماد"
                  placeholder="ملاحظات الاعتماد (اختياري)"
                  maxLength={4000}
                  value={notes}
                  disabled={busy}
                  onChange={event => setNotes(event.target.value)}
                />
              </div>
            )}
            {(canApprove || (pendingFollowup && operation.current)) && (
              <Button disabled={busy} onClick={submit}>
                {busy
                  ? "جارٍ حفظ القرار والإرسال…"
                  : pendingFollowup
                    ? "إعادة محاولة الإرسال"
                    : Object.keys(reasons).length > 0 && acceptedTotal === 0
                      ? "تأكيد رفض الحزمة"
                      : data.status === "pending_accounting"
                        ? "اعتماد وإرسال للإدارة العليا"
                        : "اعتماد وإرسال للمندوب"}
              </Button>
            )}
            <p>
              إجمالي الحزمة للمراجعة:{" "}
              <strong>{displayedTotal.toFixed(2)} ر.س</strong>
            </p>
            {Object.keys(reasons).length > 0 && (
              <p>
                إجمالي الأصناف المقبولة بعد قرارات الرفض:{" "}
                <strong>{acceptedTotal.toFixed(2)} ر.س</strong>
              </p>
            )}
            {data.accountingNotes && (
              <p>ملاحظات الحسابات: {data.accountingNotes}</p>
            )}
            {data.managementNotes && (
              <p>ملاحظات الإدارة العليا: {data.managementNotes}</p>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
