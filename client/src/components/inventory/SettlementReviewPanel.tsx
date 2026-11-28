import { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, FilePlus2, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  canPrepareSettlementDraft,
  canReviewSettlementDraft,
  settlementDraftEditable,
} from "@shared/inventory-settlement-review";

type DraftStatus =
  | "draft"
  | "pending_review"
  | "returned"
  | "applied"
  | "no_adjustment";
type ReviewDraft = {
  id: number;
  status: DraftStatus;
  version: number;
  sourceCountOperationId: number;
  sourceCountNumber?: string | null;
  warehouseName?: string | null;
  preparedById: number;
  lastSubmittedById?: number | null;
  preparedByName?: string | null;
  reason: string;
  reference?: string | null;
  returnedReason?: string | null;
  correctsSettlementId?: number | null;
  appliedSettlementId?: number | null;
  sourceChanged?: boolean;
};
type CountLine = {
  countItemId: number;
  inventoryId: number;
  lotId?: number | null;
  lotNumber?: string | null;
  lotCode?: string | null;
  itemName: string;
  unit?: string | null;
  systemQuantity: number;
  countedQuantity: number | null;
  diffQuantity: number;
  averageCostSnapshot: number | null;
  diffValue: number | null;
};
type Correction = {
  id: number;
  status: "pending" | "corrected";
  allowedCountItemIds: number[];
  requestedReason: string;
  correctionReason?: string | null;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
};
type DraftDetails = {
  draft: ReviewDraft;
  sourceCount: {
    id: number;
    operationNumber: string;
    countType?: string;
    warehouseName?: string | null;
  };
  items: CountLine[];
  history: Array<{
    id: number;
    version: number;
    action: string;
    actorId?: number;
    actorName?: string | null;
    reason?: string | null;
    createdAt: Date | string;
    payload?: unknown;
  }>;
  corrections: Correction[];
  pendingCorrection?: Correction | null;
};

export function settlementReviewPermissions(
  role: string | undefined,
  userId: number | undefined,
  isReadOnly: boolean,
  draft?: ReviewDraft,
  history: ReadonlyArray<{ actorId?: number; action: string }> = []
) {
  const administrator = !isReadOnly && (role === "admin" || role === "owner");
  const prepare = !isReadOnly && canPrepareSettlementDraft(role);
  const review = !isReadOnly && canReviewSettlementDraft(role);
  const edit =
    !!draft &&
    prepare &&
    (administrator || draft.preparedById === userId) &&
    settlementDraftEditable(draft.status);
  const approve =
    !!draft &&
    review &&
    draft.status === "pending_review" &&
    draft.preparedById !== userId &&
    draft.lastSubmittedById !== userId &&
    !history.some(
      event =>
        event.actorId === userId &&
        ["created", "edited", "submitted", "count_corrected"].includes(
          event.action
        )
    );
  return { prepare, review, edit, approve };
}

const STATE_COLORS: Record<DraftStatus, string> = {
  draft: "bg-slate-100 text-slate-800",
  pending_review: "bg-blue-100 text-blue-800",
  returned: "bg-amber-100 text-amber-900",
  applied: "bg-emerald-100 text-emerald-800",
  no_adjustment: "bg-emerald-100 text-emerald-800",
};

function numberText(value: number | null | undefined) {
  return value == null || !Number.isFinite(Number(value))
    ? "—"
    : Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** Non-posting preparation and management review; quantities come only from the saved count. */
export default function SettlementReviewPanel({
  createCountId,
  onCreateHandled,
  onUpdated,
}: {
  createCountId?: number | null;
  onCreateHandled?: () => void;
  onUpdated?: () => void;
}) {
  const { authenticatedUser: user, isReadOnly } = useAuth();
  const { language } = useTranslation();
  const tx = (ar: string, en: string, ur: string) =>
    language === "en" ? en : language === "ur" ? ur : ar;
  const stateText = (status: string) =>
    ({
      draft: tx("مسودة", "Draft", "مسودہ"),
      pending_review: tx(
        "بانتظار اعتماد الإدارة",
        "Awaiting management approval",
        "انتظامیہ کی منظوری کا منتظر"
      ),
      returned: tx(
        "معادة للتعديل",
        "Returned for correction",
        "ترمیم کے لیے واپس"
      ),
      applied: tx("معتمدة ومطبقة", "Approved and applied", "منظور اور نافذ"),
      no_adjustment: tx(
        "معتمدة دون فروقات",
        "Approved with no variance",
        "بغیر فرق کے منظور"
      ),
    })[status] || tx("غير معروفة", "Unknown", "نامعلوم");
  const actionText = (action: string) =>
    ({
      created: tx("حفظ المسودة", "Draft saved", "مسودہ محفوظ"),
      edited: tx("تعديل المسودة", "Draft updated", "مسودہ ترمیم"),
      submitted: tx(
        "إرسال للمراجعة",
        "Submitted for review",
        "جائزے کے لیے ارسال"
      ),
      returned: tx(
        "إعادة للتعديل",
        "Returned for correction",
        "ترمیم کے لیے واپس"
      ),
      applied: tx(
        "اعتماد وتطبيق التسوية",
        "Approved and applied",
        "منظور اور نافذ"
      ),
      no_adjustment: tx(
        "اعتماد دون فروقات",
        "Approved without variances",
        "بغیر فرق کے منظور"
      ),
      correction_requested: tx(
        "طلب تصحيح موثّق للجرد",
        "Count correction requested",
        "گنتی کی تصحیح کی درخواست"
      ),
      count_corrected: tx(
        "حفظ تصحيح الجرد",
        "Count correction saved",
        "گنتی کی تصحیح محفوظ"
      ),
    })[action] || tx("تحديث موثّق", "Recorded update", "ریکارڈ شدہ تبدیلی");
  const utils = trpc.useUtils();
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const id = typeof window === "undefined" ? NaN : Number(new URLSearchParams(window.location?.search || "").get("draftId"));
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  });
  const [filter, setFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [newCountId, setNewCountId] = useState("");
  const [newReason, setNewReason] = useState("");
  const [newReference, setNewReference] = useState("");
  const [newCorrectsId, setNewCorrectsId] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editReference, setEditReference] = useState("");
  const [decision, setDecision] = useState<
    "return" | "correction" | "approve" | null
  >(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [requestedIds, setRequestedIds] = useState<number[]>([]);
  const [correctedQty, setCorrectedQty] = useState<Record<number, string>>({});
  const [correctionReason, setCorrectionReason] = useState("");
  const listQuery = trpc.inventoryCount.settlementDrafts.useQuery(undefined, {
    retry: false,
    refetchOnMount: "always",
  });
  const detailQuery = trpc.inventoryCount.settlementDraftDetails.useQuery(
    { draftId: selectedId! },
    { enabled: selectedId !== null, retry: false, refetchOnMount: "always" }
  );
  const detail = detailQuery.data as DraftDetails | undefined;
  const draft = detail?.draft;
  const permissions = settlementReviewPermissions(
    user?.role,
    user?.id,
    isReadOnly,
    draft,
    detail?.history
  );
  // These existing reads are needed only by a preparer choosing a finalized count.
  const countQuery = trpc.inventoryCount.listOperations.useQuery(undefined, {
    enabled: createOpen && permissions.prepare,
    retry: false,
  });
  const appliedQuery = trpc.inventoryCount.listSettlements.useQuery(undefined, {
    enabled: createOpen && permissions.prepare,
    retry: false,
  });

  const refresh = async () => {
    // A committed action remains a success if a subsequent list refresh fails.
    await Promise.allSettled([
      utils.inventoryCount.invalidate(),
      utils.inventory.list.invalidate(),
    ]);
    onUpdated?.();
  };
  const failed = (error: { message: string }) => {
    toast.error(error.message);
  };
  const saveMutation = trpc.inventoryCount.saveSettlementDraft.useMutation({
    onSuccess: async result => {
      toast.success(
        tx(
          "حُفظت المسودة دون تغيير المخزون",
          "Draft saved without changing stock",
          "اسٹاک بدلے بغیر مسودہ محفوظ"
        )
      );
      setSelectedId(result.draftId);
      setCreateOpen(false);
      await refresh();
    },
    onError: failed,
  });
  const submitted = async () => {
    toast.success(
      tx(
        "أُرسلت التسوية لمراجعة الإدارة دون تغيير المخزون",
        "Sent for management review; stock is unchanged",
        "انتظامیہ کو ارسال؛ اسٹاک تبدیل نہیں ہوا"
      )
    );
    await refresh();
  };
  const submitMutation = trpc.inventoryCount.submitSettlementDraft.useMutation({
    onSuccess: submitted,
    onError: failed,
  });
  const returnMutation = trpc.inventoryCount.returnSettlementDraft.useMutation({
    onSuccess: async () => {
      setDecision(null);
      toast.success(
        tx("أُعيدت للمستودع للتعديل", "Returned to warehouse", "گودام کو واپس")
      );
      await refresh();
    },
    onError: failed,
  });
  const requestCorrectionMutation =
    trpc.inventoryCount.requestCountCorrection.useMutation({
      onSuccess: async () => {
        setDecision(null);
        toast.success(
          tx(
            "أُرسل طلب تصحيح الجرد للمستودع",
            "Count correction requested from warehouse",
            "گودام کو گنتی کی تصحیح کی درخواست ارسال"
          )
        );
        await refresh();
      },
      onError: failed,
    });
  const correctMutation = trpc.inventoryCount.correctCount.useMutation({
    onSuccess: async () => {
      toast.success(
        tx(
          "حُفظ تصحيح الجرد، وتحتاج التسوية إعادة إرسال للمراجعة",
          "Count corrected; resubmit the settlement for review",
          "گنتی درست؛ جائزے کے لیے دوبارہ ارسال کریں"
        )
      );
      await refresh();
    },
    onError: failed,
  });
  const approveMutation =
    trpc.inventoryCount.approveSettlementDraft.useMutation({
      onSuccess: async result => {
        setDecision(null);
        toast.success(
          result.noAdjustment
            ? tx(
                "اعتُمدت المراجعة دون فروقات؛ لم يتغير المخزون",
                "Approved with no variance; stock is unchanged",
                "بغیر فرق کے منظوری؛ اسٹاک برقرار"
              )
            : tx(
                "اعتُمدت التسوية وطُبقت على المخزون",
                "Settlement approved and applied to stock",
                "تسویہ منظور اور اسٹاک پر نافذ"
              )
        );
        await refresh();
      },
      onError: failed,
    });
  const busy =
    saveMutation.isPending ||
    submitMutation.isPending ||
    returnMutation.isPending ||
    requestCorrectionMutation.isPending ||
    correctMutation.isPending ||
    approveMutation.isPending;

  useEffect(() => {
    if (!createCountId || !permissions.prepare) return;
    setNewCountId(String(createCountId));
    setNewReason("");
    setNewReference("");
    setNewCorrectsId("");
    setCreateOpen(true);
    onCreateHandled?.();
  }, [createCountId, permissions.prepare, onCreateHandled]);
  useEffect(() => {
    setEditReason(draft?.reason || "");
    setEditReference(draft?.reference || "");
    setDecision(null);
    setDecisionReason("");
    setRequestedIds([]);
    setCorrectionReason("");
    setCorrectedQty(
      Object.fromEntries(
        (detail?.items || []).map(item => [
          item.countItemId,
          item.countedQuantity == null ? "" : String(item.countedQuantity),
        ])
      )
    );
  }, [draft?.id, draft?.version, detail?.pendingCorrection?.id]);

  const pendingCorrection = detail?.pendingCorrection;
  const hasVariance =
    detail?.items?.some(item => Number(item.diffQuantity) !== 0) ?? false;
  const changedText = tx(
    "تغير الجرد عن آخر نسخة أُرسلت للمراجعة. راجع الفروقات المصححة ثم أعد إرسال التسوية؛ لا يمكن اعتماد النسخة القديمة.",
    "The count changed since the last submitted version. Review the corrected variances and submit it again; the old version cannot be approved.",
    "آخری ارسال کے بعد گنتی تبدیل ہوئی۔ درست فرق کا جائزہ لے کر دوبارہ ارسال کریں؛ پرانا نسخہ منظور نہیں ہو سکتا۔"
  );
  const hasUnsavedChanges =
    !!draft &&
    (editReason !== draft.reason || editReference !== (draft.reference || ""));
  const validCorrections =
    !!pendingCorrection &&
    pendingCorrection.allowedCountItemIds.length > 0 &&
    pendingCorrection.allowedCountItemIds.every(
      id =>
        correctedQty[id]?.trim() !== "" &&
        Number.isFinite(Number(correctedQty[id])) &&
        Number(correctedQty[id]) >= 0
    );
  const canDecide =
    permissions.review &&
    draft?.status === "pending_review" &&
    !pendingCorrection;
  const drafts = (listQuery.data || []) as ReviewDraft[];

  return (
    <section
      className="space-y-4"
      aria-label={tx(
        "مراجعة تسويات الجرد",
        "Count settlement review",
        "گنتی کے تسویوں کا جائزہ"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">
            {tx(
              "مسودات التسوية واعتمادها",
              "Settlement drafts and approval",
              "تسویے کے مسودے اور منظوری"
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            {tx(
              "الحفظ والإرسال والتصحيح لا تغير المخزون. الاعتماد الرسمي وحده يطبق التسوية.",
              "Saving, submission and correction do not change stock. Only formal approval applies the settlement.",
              "محفوظ، ارسال یا تصحیح سے اسٹاک تبدیل نہیں ہوتا۔ صرف منظوری سے تسویہ نافذ ہوتا ہے۔"
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => listQuery.refetch()}
            disabled={listQuery.isFetching}
          >
            <RefreshCw className="h-4 w-4 me-1" />
            {tx("تحديث", "Refresh", "تازہ کریں")}
          </Button>
          {permissions.prepare && (
            <Button
              size="sm"
              onClick={() => {
                setNewCountId("");
                setNewReason("");
                setNewReference("");
                setNewCorrectsId("");
                setCreateOpen(true);
              }}
            >
              <FilePlus2 className="h-4 w-4 me-1" />
              {tx("مسودة تسوية من جرد", "Draft from a count", "گنتی سے مسودہ")}
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {[
          "all",
          "draft",
          "pending_review",
          "returned",
          "applied",
          "no_adjustment",
        ].map(status => (
          <Button
            key={status}
            variant={filter === status ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(status)}
          >
            {status === "all" ? tx("الكل", "All", "سب") : stateText(status)}
          </Button>
        ))}
      </div>
      {listQuery.isFetching && (
        <p role="status" className="text-sm text-muted-foreground">
          {tx(
            "جارٍ تحميل التسويات…",
            "Loading settlements…",
            "تسویے لوڈ ہو رہے ہیں…"
          )}
        </p>
      )}
      {listQuery.isError ? (
        <div
          role="alert"
          className="rounded border border-red-200 p-3 space-y-2"
        >
          <p>
            {tx(
              "تعذر تحميل التسويات. أعد المحاولة.",
              "Could not load settlements. Please retry.",
              "تسویے لوڈ نہیں ہوئے۔ دوبارہ کوشش کریں۔"
            )}
          </p>
          <Button variant="outline" onClick={() => listQuery.refetch()}>
            {tx("إعادة المحاولة", "Retry", "دوبارہ کوشش")}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 text-start">
                  {tx("المسودة / الجرد", "Draft / count", "مسودہ / گنتی")}
                </th>
                <th className="p-3 text-start">
                  {tx("أعدها", "Prepared by", "تیار کنندہ")}
                </th>
                <th className="p-3 text-start">
                  {tx("الحالة", "Status", "حالت")}
                </th>
                <th className="p-3 text-start">
                  {tx("السبب", "Reason", "وجہ")}
                </th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {drafts
                .filter(row => filter === "all" || row.status === filter)
                .map(row => (
                  <tr key={row.id} className="border-t">
                    <td className="p-3">
                      <span className="font-medium">#{row.id}</span>
                      <p className="font-mono text-xs">
                        {row.sourceCountNumber ||
                          `#${row.sourceCountOperationId}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.warehouseName || "—"}
                      </p>
                    </td>
                    <td className="p-3">{row.preparedByName || "—"}</td>
                    <td className="p-3">
                      <Badge className={STATE_COLORS[row.status]}>
                        {stateText(row.status)}
                      </Badge>
                    </td>
                    <td className="p-3 max-w-sm whitespace-pre-wrap">
                      {row.reason}
                    </td>
                    <td className="p-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedId(row.id)}
                      >
                        {tx("فتح", "Open", "کھولیں")}
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!listQuery.isFetching &&
            !drafts.some(row => filter === "all" || row.status === filter) && (
              <p className="text-center p-6 text-muted-foreground">
                {tx(
                  "لا توجد تسويات بهذه الحالة",
                  "No settlements with this status",
                  "اس حالت میں کوئی تسویہ نہیں"
                )}
              </p>
            )}
        </div>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={open => {
          if (!busy) setCreateOpen(open);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {tx(
                "إعداد مسودة تسوية",
                "Prepare a settlement draft",
                "تسویے کا مسودہ تیار کریں"
              )}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {tx(
              "اختر جردًا محفوظًا نهائيًا. تأتي الكميات والتكلفة من مستنده؛ لا تُدخل كميات بديلة في التسوية.",
              "Choose a finalized count. Quantities and costs come from that document; replacement quantities cannot be entered here.",
              "حتمی گنتی منتخب کریں۔ مقدار اور لاگت اسی دستاویز سے لی جاتی ہے۔"
            )}
          </p>
          {countQuery.isLoading && (
            <p role="status">
              {tx(
                "جارٍ تحميل الجرد…",
                "Loading counts…",
                "گنتیاں لوڈ ہو رہی ہیں…"
              )}
            </p>
          )}
          {(countQuery.isError || appliedQuery.isError) && (
            <p role="alert" className="text-red-700">
              {tx(
                "تعذر تحميل المستندات. أغلق النافذة وأعد فتحها للمحاولة.",
                "Could not load documents. Close and reopen this window to retry.",
                "دستاویزات لوڈ نہیں ہوئیں۔ دوبارہ کھول کر کوشش کریں۔"
              )}
            </p>
          )}
          <Label htmlFor="review-source-count">
            {tx("الجرد النهائي *", "Finalized count *", "حتمی گنتی *")}
          </Label>
          <select
            id="review-source-count"
            className="w-full border rounded p-2 bg-background"
            value={newCountId}
            disabled={busy}
            onChange={event => setNewCountId(event.target.value)}
          >
            <option value="">
              {tx("اختر الجرد", "Choose a count", "گنتی منتخب کریں")}
            </option>
            {(countQuery.data || [])
              .filter(row => row.status === "completed")
              .map(row => (
                <option key={row.id} value={row.id}>
                  {row.operationNumber}
                  {row.operationTitle ? ` — ${row.operationTitle}` : ""}
                </option>
              ))}
          </select>
          <Label htmlFor="review-new-reason">
            {tx(
              "سبب التسوية * (10 أحرف على الأقل)",
              "Reason * (at least 10 characters)",
              "وجہ * (کم از کم 10 حروف)"
            )}
          </Label>
          <Textarea
            id="review-new-reason"
            value={newReason}
            disabled={busy}
            maxLength={2000}
            onChange={event => setNewReason(event.target.value)}
          />
          <Label htmlFor="review-new-reference">
            {tx(
              "مرجع إضافي (اختياري)",
              "Additional reference (optional)",
              "اضافی حوالہ (اختیاری)"
            )}
          </Label>
          <Input
            id="review-new-reference"
            value={newReference}
            disabled={busy}
            maxLength={255}
            onChange={event => setNewReference(event.target.value)}
          />
          <Label htmlFor="review-corrects">
            {tx(
              "تسوية سابقة يُصححها هذا الجرد الجديد (اختياري)",
              "Prior settlement corrected by this new count (optional)",
              "اس نئی گنتی سے درست کیا جانے والا پچھلا تسویہ (اختیاری)"
            )}
          </Label>
          <select
            id="review-corrects"
            className="w-full border rounded p-2 bg-background"
            value={newCorrectsId}
            disabled={busy}
            onChange={event => setNewCorrectsId(event.target.value)}
          >
            <option value="">{tx("بدون", "None", "کوئی نہیں")}</option>
            {(appliedQuery.data || [])
              .filter(row => row.status === "applied")
              .map(row => (
                <option key={row.id} value={row.id}>
                  {row.settlementNumber}
                </option>
              ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {tx(
              "بعد تطبيق تسوية، يلزم جرد جديد لأي تصحيح لاحق؛ تبقى التسوية السابقة محفوظة.",
              "After a settlement is applied, later corrections require a new count; the previous settlement remains unchanged.",
              "تسویہ نافذ ہونے کے بعد تصحیح کے لیے نئی گنتی ضروری ہے؛ سابقہ تسویہ محفوظ رہتا ہے۔"
            )}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setCreateOpen(false)}
            >
              {tx("إلغاء", "Cancel", "منسوخ")}
            </Button>
            <Button
              disabled={
                !permissions.prepare ||
                busy ||
                countQuery.isError ||
                appliedQuery.isError ||
                !newCountId ||
                newReason.trim().length < 10
              }
              onClick={() =>
                saveMutation.mutate({
                  sourceCountOperationId: Number(newCountId),
                  reason: newReason.trim(),
                  reference: newReference.trim() || undefined,
                  correctsSettlementId: newCorrectsId
                    ? Number(newCorrectsId)
                    : undefined,
                })
              }
            >
              {busy && <Loader2 className="h-4 w-4 me-1 animate-spin" />}
              {tx(
                "حفظ مسودة دون ترحيل",
                "Save without posting",
                "اسٹاک بدلے بغیر محفوظ"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={selectedId !== null}
        onOpenChange={open => {
          if (!open && !busy) {
            setSelectedId(null);
            setDecision(null);
          }
        }}
      >
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {tx("مراجعة التسوية", "Settlement review", "تسویے کا جائزہ")} #
              {selectedId}
            </DialogTitle>
          </DialogHeader>
          {detailQuery.isFetching && (
            <p role="status">
              {tx(
                "جارٍ تحميل التفاصيل…",
                "Loading details…",
                "تفصیلات لوڈ ہو رہی ہیں…"
              )}
            </p>
          )}
          {detailQuery.isError && (
            <div role="alert">
              <p>
                {tx(
                  "تعذر تحميل التفاصيل",
                  "Could not load details",
                  "تفصیلات لوڈ نہیں ہوئیں"
                )}
              </p>
              <Button variant="outline" onClick={() => detailQuery.refetch()}>
                {tx("إعادة المحاولة", "Retry", "دوبارہ کوشش")}
              </Button>
            </div>
          )}
          {detail && draft && !detailQuery.isError && (
            <>
              <div className="flex flex-wrap gap-3 items-center text-sm">
                <Badge className={STATE_COLORS[draft.status]}>
                  {stateText(draft.status)}
                </Badge>
                <span>{detail.sourceCount.operationNumber}</span>
                <span>
                  {tx("المستودع", "Warehouse", "گودام")}:{" "}
                  {detail.sourceCount.warehouseName || "—"}
                </span>
                <span>
                  {tx("الإصدار", "Version", "نسخہ")} {draft.version}
                </span>
                {draft.appliedSettlementId && (
                  <span>
                    {tx(
                      "رقم التسوية المطبقة",
                      "Applied settlement ID",
                      "نافذ تسویے کا نمبر"
                    )}
                    : #{draft.appliedSettlementId}
                  </span>
                )}
                {draft.correctsSettlementId && (
                  <span>
                    {tx(
                      "تصحيح للتسوية",
                      "Corrects settlement",
                      "تسویے کی تصحیح"
                    )}
                    : #{draft.correctsSettlementId}
                  </span>
                )}
              </div>
              <p
                className={`rounded border p-3 text-sm ${draft.status === "applied" || draft.status === "no_adjustment" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-blue-200 bg-blue-50 text-blue-900"}`}
              >
                {draft.status === "no_adjustment"
                  ? tx(
                      "اعتُمدت المراجعة دون فروقات. لم تُنشأ حركة مخزون، وأُغلقت هذه المراجعة. أي عدّ لاحق يبدأ بجرد جديد.",
                      "Approved without variances. No stock movement was created and this review is closed. A later recount starts with a new count.",
                      "بغیر فرق کے جائزہ منظور۔ اسٹاک کی حرکت نہیں ہوئی اور جائزہ بند ہے۔ بعد کی گنتی نئی دستاویز سے شروع کریں۔"
                    )
                  : draft.status === "applied"
                    ? tx(
                        "تم تطبيق التسوية. لا يمكن تعديلها أو تطبيقها مرة ثانية. أي تصحيح لاحق يبدأ بجرد جديد.",
                        "This settlement is applied and cannot be edited or applied again. Later corrections start with a new count.",
                        "تسویہ نافذ ہو چکا ہے، دوبارہ نافذ یا ترمیم نہیں ہو سکتا۔ تصحیح نئی گنتی سے شروع کریں۔"
                      )
                    : tx(
                        "هذه مراجعة لمستند محفوظ؛ لم يتغير المخزون. التطبيق يحدث مرة واحدة عند الاعتماد الرسمي.",
                        "Stock is unchanged during review. Posting happens once, on formal approval.",
                        "جائزے کے دوران اسٹاک تبدیل نہیں ہوتا۔ منظوری پر صرف ایک بار نافذ ہوگا۔"
                      )}
              </p>
              {draft.returnedReason && (
                <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm whitespace-pre-wrap">
                  {tx("ملاحظات الإعادة: ", "Return notes: ", "واپسی کی وجہ: ")}
                  {draft.returnedReason}
                </p>
              )}
              {draft.sourceChanged && ["draft", "pending_review", "returned"].includes(draft.status) && (
                <p
                  role="alert"
                  className="rounded border border-amber-300 p-3 text-amber-900"
                >
                  {changedText}
                </p>
              )}
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="review-edit-reason">
                    {tx(
                      "سبب التسوية *",
                      "Settlement reason *",
                      "تسویے کی وجہ *"
                    )}
                  </Label>
                  <Textarea
                    id="review-edit-reason"
                    value={editReason}
                    onChange={event => setEditReason(event.target.value)}
                    disabled={!permissions.edit || busy || !!pendingCorrection}
                    maxLength={2000}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="review-edit-reference">
                    {tx("المرجع", "Reference", "حوالہ")}
                  </Label>
                  <Input
                    id="review-edit-reference"
                    value={editReference}
                    onChange={event => setEditReference(event.target.value)}
                    disabled={!permissions.edit || busy || !!pendingCorrection}
                    maxLength={255}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {detail.sourceCount.countType === "opening_balance"
                  ? tx(
                      "الرصيد الافتتاحي يستخدم تكلفة الصنف الحالية المعروضة للمراجعة. يثبت الخادم أساس التكلفة عند الإرسال ويتحقق منه عند الاعتماد؛ لا تُدخل التكلفة من هذه الشاشة.",
                      "Opening balances use the current item cost shown for review. The server records the cost basis on submission and verifies it on approval; cost cannot be entered here.",
                      "ابتدائی بیلنس میں جائزے کے لیے موجودہ لاگت استعمال ہوتی ہے۔ ارسال پر لاگت محفوظ اور منظوری پر تصدیق ہوتی ہے؛ یہاں لاگت درج نہیں ہوتی۔"
                    )
                  : tx(
                      "التقييم المالي من متوسط التكلفة المثبت عند فتح الجرد (Snapshot)، وفق آلية الجرد الحالية. لا تتغير التكلفة من هذه الشاشة.",
                      "Valuation uses the average cost captured when the count opened (snapshot), following the existing count method. Cost cannot be changed here.",
                      "مالی قیمت گنتی کے آغاز کی محفوظ اوسط لاگت سے ہے۔ یہاں لاگت تبدیل نہیں ہوتی۔"
                    )}
              </p>
              {decision === "correction" && (
                <p className="font-medium text-amber-900">
                  {tx(
                    "حدد أسطر خطأ الكتابة في الجرد الأصلي فقط. إعادة العدّ في وقت لاحق تحتاج جردًا جديدًا.",
                    "Select only transcription errors from the original count. A later physical recount requires a new count document.",
                    "صرف اصل گنتی کی تحریری غلطیاں منتخب کریں۔ بعد کی دوبارہ گنتی کے لیے نئی دستاویز ضروری ہے۔"
                  )}
                </p>
              )}
              <div className="border rounded overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {decision === "correction" && <th className="p-2" />}
                      <th className="p-2 text-start">
                        {tx("الصنف / اللوت", "Item / lot", "صنف / لاٹ")}
                      </th>
                      <th className="p-2 text-start">
                        {tx(
                          "رصيد فتح الجرد",
                          "Opening balance",
                          "ابتدائی بیلنس"
                        )}
                      </th>
                      <th className="p-2 text-start">
                        {tx("المعدود المحفوظ", "Saved count", "محفوظ گنتی")}
                      </th>
                      <th className="p-2 text-start">
                        {tx("فرق التسوية", "Adjustment", "فرق")}
                      </th>
                      <th className="p-2 text-start">
                        {detail.sourceCount.countType === "opening_balance"
                          ? tx(
                              "التكلفة الافتتاحية المعروضة",
                              "Displayed opening cost",
                              "دکھائی گئی ابتدائی لاگت"
                            )
                          : tx("تكلفة Snapshot", "Snapshot cost", "محفوظ لاگت")}
                      </th>
                      <th className="p-2 text-start">
                        {tx("قيمة الفرق", "Variance value", "فرق کی مالیت")}
                      </th>
                      {pendingCorrection && permissions.edit && (
                        <th className="p-2 text-start">
                          {tx(
                            "الكمية الصحيحة المطلوبة",
                            "Corrected quantity",
                            "درست مقدار"
                          )}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map(item => (
                      <tr key={item.countItemId} className="border-t">
                        {decision === "correction" && (
                          <td className="p-2">
                            <Checkbox
                              aria-label={`${tx("طلب تصحيح", "Request correction", "تصحیح کی درخواست")} ${item.itemName}`}
                              checked={requestedIds.includes(item.countItemId)}
                              disabled={busy || item.countedQuantity === null}
                              onCheckedChange={checked =>
                                setRequestedIds(ids =>
                                  checked === true
                                    ? [...ids, item.countItemId]
                                    : ids.filter(id => id !== item.countItemId)
                                )
                              }
                            />
                          </td>
                        )}
                        <td className="p-2">
                          {item.itemName}
                          <p className="text-xs font-mono text-muted-foreground">
                            {item.lotCode ||
                              item.lotNumber ||
                              (item.lotId ? `Lot #${item.lotId}` : "—")}
                          </p>
                        </td>
                        <td className="p-2">
                          {numberText(item.systemQuantity)} {item.unit}
                        </td>
                        <td className="p-2">
                          {numberText(item.countedQuantity)} {item.unit}
                        </td>
                        <td className="p-2 font-medium">
                          {numberText(item.diffQuantity)} {item.unit}
                        </td>
                        <td className="p-2">
                          {numberText(item.averageCostSnapshot)}
                        </td>
                        <td className="p-2">{numberText(item.diffValue)}</td>
                        {pendingCorrection && permissions.edit && (
                          <td className="p-2">
                            {pendingCorrection.allowedCountItemIds.includes(
                              item.countItemId
                            ) ? (
                              <Input
                                aria-label={`${tx("الكمية المصححة", "Corrected quantity", "درست مقدار")} ${item.itemName}`}
                                type="number"
                                min="0"
                                step="0.001"
                                value={correctedQty[item.countItemId] ?? ""}
                                disabled={busy}
                                onChange={event =>
                                  setCorrectedQty(values => ({
                                    ...values,
                                    [item.countItemId]: event.target.value,
                                  }))
                                }
                                className="w-32"
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {tx(
                                  "غير مطلوب تصحيحه",
                                  "Not requested",
                                  "درخواست نہیں"
                                )}
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pendingCorrection && (
                <Card className="border-amber-300">
                  <CardContent className="p-4 space-y-3">
                    <h3 className="font-semibold">
                      {tx(
                        "طلب تصحيح موثّق للجرد",
                        "Documented count correction",
                        "گنتی کی ریکارڈ شدہ تصحیح"
                      )}
                    </h3>
                    <p className="whitespace-pre-wrap">
                      {pendingCorrection.requestedReason}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {tx(
                        "المتاح هو تصحيح الأسطر المطلوبة فقط. تبقى الكميات السابقة محفوظة في سجل التصحيح، ولا تتغير أرصدة المخزون.",
                        "Only requested lines can be corrected. Previous quantities remain in the correction history; stock is unchanged.",
                        "صرف مطلوبہ سطریں درست کریں۔ سابقہ مقدار ریکارڈ میں محفوظ اور اسٹاک برقرار رہے گا۔"
                      )}
                    </p>
                    {permissions.edit && (
                      <>
                        <Label htmlFor="count-correction-reason">
                          {tx(
                            "سبب التصحيح * (10 أحرف على الأقل)",
                            "Correction reason * (at least 10 characters)",
                            "تصحیح کی وجہ * (کم از کم 10 حروف)"
                          )}
                        </Label>
                        <Textarea
                          id="count-correction-reason"
                          value={correctionReason}
                          disabled={busy}
                          onChange={event =>
                            setCorrectionReason(event.target.value)
                          }
                        />
                        <Button
                          disabled={
                            busy ||
                            !validCorrections ||
                            correctionReason.trim().length < 10
                          }
                          onClick={() =>
                            correctMutation.mutate({
                              requestId: pendingCorrection.id,
                              reason: correctionReason.trim(),
                              items: pendingCorrection.allowedCountItemIds.map(
                                countItemId => ({
                                  countItemId,
                                  countedQuantity: Number(
                                    correctedQty[countItemId]
                                  ),
                                })
                              ),
                            })
                          }
                        >
                          {tx(
                            "حفظ تصحيح الجرد دون ترحيل",
                            "Save correction without posting",
                            "اسٹاک بدلے بغیر تصحیح محفوظ"
                          )}
                        </Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}
              <div className="flex flex-wrap gap-2">
                {permissions.edit && !pendingCorrection && (
                  <>
                    <Button
                      variant="outline"
                      disabled={
                        busy ||
                        editReason.trim().length < 10 ||
                        (!hasUnsavedChanges && !draft.sourceChanged)
                      }
                      onClick={() =>
                        saveMutation.mutate({
                          draftId: draft.id,
                          expectedVersion: draft.version,
                          sourceCountOperationId: draft.sourceCountOperationId,
                          reason: editReason.trim(),
                          reference: editReference.trim() || undefined,
                          correctsSettlementId:
                            draft.correctsSettlementId || undefined,
                        })
                      }
                    >
                      {tx("حفظ المسودة", "Save draft", "مسودہ محفوظ")}
                    </Button>
                    <Button
                      disabled={
                        busy ||
                        hasUnsavedChanges ||
                        editReason.trim().length < 10 ||
                        detailQuery.isFetching
                      }
                      onClick={() =>
                        submitMutation.mutate({
                          draftId: draft.id,
                          expectedVersion: draft.version,
                        })
                      }
                    >
                      {tx(
                        "إرسال لمراجعة الإدارة",
                        "Submit for management review",
                        "انتظامیہ کے جائزے کے لیے ارسال"
                      )}
                    </Button>
                  </>
                )}
                {canDecide && (
                  <>
                    <Button
                      variant="outline"
                      disabled={busy || detailQuery.isFetching}
                      onClick={() => {
                        setDecision("return");
                        setDecisionReason("");
                      }}
                    >
                      {tx(
                        "إعادة للتعديل",
                        "Return for correction",
                        "ترمیم کے لیے واپس"
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy || detailQuery.isFetching}
                      onClick={() => {
                        setDecision("correction");
                        setDecisionReason("");
                        setRequestedIds([]);
                      }}
                    >
                      {tx(
                        "طلب تصحيح الجرد الأصلي",
                        "Request original count correction",
                        "اصل گنتی کی تصحیح کی درخواست"
                      )}
                    </Button>
                    <Button
                      disabled={
                        !permissions.approve ||
                        busy ||
                        !!draft.sourceChanged ||
                        detailQuery.isFetching
                      }
                      onClick={() => setDecision("approve")}
                    >
                      <CheckCircle2 className="h-4 w-4 me-1" />
                      {hasVariance
                        ? tx(
                            "اعتماد رسمي وتطبيق",
                            "Approve and apply",
                            "منظور اور نافذ کریں"
                          )
                        : tx(
                            "اعتماد دون فروقات",
                            "Approve with no variance",
                            "بغیر فرق کے منظور کریں"
                          )}
                    </Button>
                  </>
                )}
              </div>
              {canDecide && !permissions.approve && (
                <p className="text-sm text-amber-900">
                  {tx(
                    "لا يمكنك اعتماد تسوية شاركت في إعدادها أو تعديلها أو تصحيح جردها أو إرسالها؛ يلزم مراجع آخر مخوّل.",
                    "You cannot approve a settlement you prepared, edited, corrected or submitted. Another authorized reviewer must approve it.",
                    "اپنا تیار، ترمیم، درست یا ارسال کردہ تسویہ منظور نہیں کر سکتے؛ دوسرے مجاز جائزہ کار کی ضرورت ہے۔"
                  )}
                </p>
              )}
              {decision && (
                <Card
                  className={
                    decision === "approve"
                      ? "border-red-300"
                      : "border-amber-300"
                  }
                >
                  <CardContent className="p-4 space-y-3">
                    {decision === "approve" ? (
                      <>
                        <p className="font-semibold text-red-800">
                          {hasVariance
                            ? tx(
                                "سيؤدي التأكيد إلى تطبيق فروقات الجرد فعليًا على أرصدة المخزون وقيمته، مرة واحدة. هل تريد الاعتماد؟",
                                "Confirmation will apply the count variances to stock quantities and value once. Approve now?",
                                "تصدیق سے گنتی کا فرق اسٹاک کی مقدار اور مالیت پر ایک بار نافذ ہوگا۔ منظور کریں؟"
                              )
                            : tx(
                                "لا توجد فروقات كمية. سيؤدي التأكيد إلى اعتماد المراجعة وإغلاقها دون إنشاء حركة أو تغيير أرصدة المخزون.",
                                "There are no quantity variances. Confirmation approves and closes this review without creating a movement or changing stock.",
                                "مقدار میں فرق نہیں۔ تصدیق سے جائزہ منظور اور بند ہوگا، اسٹاک کی حرکت یا تبدیلی نہیں ہوگی۔"
                              )}
                        </p>
                        <Button
                          disabled={
                            busy ||
                            !permissions.approve ||
                            !!draft.sourceChanged ||
                            detailQuery.isFetching
                          }
                          onClick={() =>
                            approveMutation.mutate({
                              draftId: draft.id,
                              expectedVersion: draft.version,
                            })
                          }
                        >
                          {hasVariance
                            ? tx(
                                "تأكيد الاعتماد والتطبيق",
                                "Confirm approval and posting",
                                "منظوری اور نفاذ کی تصدیق"
                              )
                            : tx(
                                "تأكيد الاعتماد دون حركة مخزون",
                                "Confirm approval without stock movement",
                                "اسٹاک کی حرکت کے بغیر منظوری کی تصدیق"
                              )}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Label htmlFor="review-decision-reason">
                          {decision === "correction"
                            ? tx(
                                "سبب طلب التصحيح والأسطر المطلوب تصحيحها *",
                                "Correction instructions *",
                                "تصحیح کی ہدایات *"
                              )
                            : tx(
                                "سبب الإعادة والمطلوب تعديله *",
                                "Return reason and requested changes *",
                                "واپسی کی وجہ اور مطلوبہ ترمیم *"
                              )}
                        </Label>
                        <Textarea
                          id="review-decision-reason"
                          value={decisionReason}
                          disabled={busy}
                          maxLength={2000}
                          onChange={event =>
                            setDecisionReason(event.target.value)
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          {tx(
                            "10 أحرف على الأقل",
                            "At least 10 characters",
                            "کم از کم 10 حروف"
                          )}
                        </p>
                        <Button
                          disabled={
                            busy ||
                            decisionReason.trim().length < 10 ||
                            (decision === "correction" &&
                              requestedIds.length === 0) ||
                            detailQuery.isFetching
                          }
                          onClick={() =>
                            decision === "return"
                              ? returnMutation.mutate({
                                  draftId: draft.id,
                                  expectedVersion: draft.version,
                                  reason: decisionReason.trim(),
                                })
                              : requestCorrectionMutation.mutate({
                                  draftId: draft.id,
                                  expectedVersion: draft.version,
                                  reason: decisionReason.trim(),
                                  countItemIds: requestedIds,
                                })
                          }
                        >
                          {decision === "return"
                            ? tx(
                                "تأكيد الإعادة",
                                "Confirm return",
                                "واپسی کی تصدیق"
                              )
                            : tx(
                                "إرسال طلب التصحيح",
                                "Send correction request",
                                "تصحیح کی درخواست ارسال"
                              )}
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setDecision(null)}
                    >
                      {tx("إلغاء", "Cancel", "منسوخ")}
                    </Button>
                  </CardContent>
                </Card>
              )}
              <details className="border rounded p-3">
                <summary className="cursor-pointer font-medium">
                  {tx(
                    "سجل الإجراءات والتصحيحات",
                    "Action and correction history",
                    "کارروائی اور تصحیح کا ریکارڈ"
                  )}
                </summary>
                <div className="space-y-3 pt-3">
                  {detail.history.map(event => (
                    <div key={event.id} className="border-b pb-2 text-sm">
                      <p className="font-medium">
                        {actionText(event.action)} — {event.actorName || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString(
                          language === "en"
                            ? "en-GB"
                            : language === "ur"
                              ? "ur-PK"
                              : "ar-SA-u-ca-gregory",
                          { timeZone: "Asia/Riyadh" }
                        )}{" "}
                        — {tx("الإصدار", "Version", "نسخہ")} {event.version}
                      </p>
                      <p className="whitespace-pre-wrap">{event.reason}</p>
                    </div>
                  ))}
                  {detail.corrections.map(correction => (
                    <div
                      key={correction.id}
                      className="border rounded p-3 text-sm"
                    >
                      <p className="font-medium">
                        {tx("تصحيح الجرد", "Count correction", "گنتی کی تصحیح")}{" "}
                        #{correction.id} —{" "}
                        {correction.status === "corrected"
                          ? tx("تم التصحيح", "Corrected", "درست")
                          : tx(
                              "بانتظار المستودع",
                              "Awaiting warehouse",
                              "گودام کا منتظر"
                            )}
                      </p>
                      <p>{correction.requestedReason}</p>
                      {correction.correctionReason && (
                        <p>
                          {tx(
                            "سبب التصحيح: ",
                            "Correction reason: ",
                            "تصحیح کی وجہ: "
                          )}
                          {correction.correctionReason}
                        </p>
                      )}
                      <CorrectionChanges
                        before={correction.beforeSnapshot}
                        after={correction.afterSnapshot}
                        items={detail.items}
                        label={tx(
                          "الكمية السابقة ← المصححة",
                          "Previous → corrected quantity",
                          "سابقہ ← درست مقدار"
                        )}
                      />
                    </div>
                  ))}
                </div>
              </details>
            </>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setSelectedId(null);
                setDecision(null);
              }}
            >
              {tx("إغلاق", "Close", "بند کریں")}
            </Button>
            {busy && (
              <span role="status" className="flex items-center text-sm gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {tx("جارٍ تنفيذ الإجراء…", "Processing…", "کارروائی جاری ہے…")}
              </span>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Durable before/after snapshots are evidence, not replacement input values. */
function CorrectionChanges({
  before,
  after,
  items,
  label,
}: {
  before: unknown;
  after: unknown;
  items: CountLine[];
  label: string;
}) {
  const rows = (
    value: unknown
  ): Array<{ countItemId: number; countedQuantity: number | null }> => {
    const source = Array.isArray(value)
      ? value
      : value && typeof value === "object" && "items" in value
        ? (value as { items: unknown }).items
        : [];
    return Array.isArray(source)
      ? source.filter(
          (
            row
          ): row is { countItemId: number; countedQuantity: number | null } =>
            !!row &&
            typeof row === "object" &&
            typeof row.countItemId === "number"
        )
      : [];
  };
  const beforeRows = rows(before),
    afterRows = rows(after);
  if (beforeRows.length === 0 || afterRows.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      <p className="text-muted-foreground">{label}</p>
      {beforeRows.map(row => {
        const current = afterRows.find(
          item => item.countItemId === row.countItemId
        );
        if (!current || current.countedQuantity === row.countedQuantity)
          return null;
        return (
          <p key={row.countItemId}>
            {items.find(item => item.countItemId === row.countItemId)
              ?.itemName || `#${row.countItemId}`}
            :{" "}
            <span dir="ltr" className="font-mono">
              {numberText(row.countedQuantity)} →{" "}
              {numberText(current.countedQuantity)}
            </span>
          </p>
        );
      })}
    </div>
  );
}
