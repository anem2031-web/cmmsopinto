import { useEffect, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

export function BundleApprovalCards({
  items,
  onSelect,
}: {
  items: any[];
  onSelect?: (id: number) => void;
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
              <Link href={`/delegate-pricing-bundles?approval=${row.id}`}>
                <Button>مراجعة الحزمة</Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ))}
    </>
  );
}
export function UnifiedBundleApproval() {
  const { user } = useAuth();
  const allowed =
    !!user &&
    ["owner", "admin", "accountant", "senior_management"].includes(user.role);
  const requestedId = Number(
    new URLSearchParams(useSearch()).get("approval") || 0
  );
  const [selected, setSelected] = useState(requestedId);
  const [afterId, setAfterId] = useState(0);
  const queue = trpc.delegatePricingBundles.approvalQueue.useQuery(
    { afterId },
    { enabled: allowed, retry: false }
  );
  const detail = trpc.delegatePricingBundles.approvalDetail.useQuery(
    { id: selected },
    { enabled: allowed && selected > 0, retry: false }
  );
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const operation = useRef<{
    fingerprint: string;
    stage: "accounting" | "management";
    payload: any;
  } | null>(null);
  const [pendingFollowup, setPendingFollowup] = useState(false);
  useEffect(() => {
    if (requestedId > 0) {
      setSelected(requestedId);
      setPendingFollowup(false);
      operation.current = null;
    }
  }, [requestedId]);
  const utils = trpc.useUtils();
  const data = detail.data;
  useEffect(() => {
    setAmount(data?.custodyBalance || "");
    setNotes("");
    setReasons({});
  }, [data?.id, data?.revision]);
  const success = async (result: any) => {
    setPendingFollowup(!result.effectsDone);
    if (result.effectsDone)
      toast.success("تم حفظ قرارات الحزمة وتحديث أصنافها");
    else
      toast.warning(
        "تم تثبيت القرار؛ يلزم استكمال متابعة المسارات دون إعادة الاعتماد"
      );
    await Promise.all([
      utils.delegatePricingBundles.invalidate(),
      utils.purchaseOrders.invalidate(),
      utils.purchasePackages.invalidate(),
    ]);
  };
  const accounting = trpc.delegatePricingBundles.approveAccounting.useMutation({
    onSuccess: success,
    onError: error => toast.error(error.message),
  });
  const management = trpc.delegatePricingBundles.approveManagement.useMutation({
    onSuccess: success,
    onError: error => toast.error(error.message),
  });
  const busy = accounting.isPending || management.isPending;
  const submit = () => {
    if (!data) return;
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
    stage === "accounting"
      ? accounting.mutate(operation.current.payload)
      : management.mutate(operation.current.payload);
  };
  if (!allowed) return null;
  const canApprove =
    data &&
    ((data.status === "pending_accounting" &&
      ["owner", "admin", "accountant"].includes(user!.role)) ||
      (data.status === "pending_management" &&
        ["owner", "admin", "senior_management"].includes(user!.role)));
  return (
    <section className="space-y-4">
      <h2 className="font-bold text-lg">حزم التسعير بانتظار الاعتماد</h2>
      {queue.error && <p role="alert">{queue.error.message}</p>}
      <BundleApprovalCards
        items={queue.data?.items || []}
        onSelect={id => {
          setSelected(id);
          setPendingFollowup(false);
          operation.current = null;
        }}
      />
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
      {detail.error && <p role="alert">{detail.error.message}</p>}
      {data && (
        <Card>
          <CardHeader>
            <CardTitle dir="ltr">{data.bundleNumber}</CardTitle>
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
                  {data.items.map((item: any) => (
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
                        {canApprove && item.currentStatus === "estimated" ? (
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
            {canApprove && (
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
                <Button disabled={busy} onClick={submit}>
                  {busy ? "جارٍ حفظ القرار…" : "تأكيد قرارات الحزمة"}
                </Button>
              </div>
            )}
            {pendingFollowup && operation.current && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  const op = operation.current!;
                  op.stage === "accounting"
                    ? accounting.mutate(op.payload)
                    : management.mutate(op.payload);
                }}
              >
                استكمال متابعة القرار المحفوظ
              </Button>
            )}
            <p>
              إجمالي تسعير الحزمة الأصلي:{" "}
              <strong>
                {(
                  data.items.reduce(
                    (sum: number, item: any) =>
                      sum + Math.round(Number(item.estimatedTotalCost) * 100),
                    0
                  ) / 100
                ).toFixed(2)}{" "}
                ر.س
              </strong>
            </p>
            <p>
              إجمالي الأصناف المقبولة بعد قرارات الرفض:{" "}
              <strong>
                {(
                  data.items
                    .filter(
                      (item: any) =>
                        !["rejected", "cancelled"].includes(
                          item.currentStatus
                        ) && !(item.id in reasons)
                    )
                    .reduce(
                      (sum: number, item: any) =>
                        sum + Math.round(Number(item.estimatedTotalCost) * 100),
                      0
                    ) / 100
                ).toFixed(2)}{" "}
                ر.س
              </strong>
            </p>
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
