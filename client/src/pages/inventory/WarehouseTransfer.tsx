import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { useEffect, useMemo, useState, useRef } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowRight, ArrowLeftRight, Loader2, PackageSearch, AlertTriangle,
  Search, QrCode, X, Plus, Trash2, CheckCircle2, XCircle,
  SendHorizontal, History, Boxes, TrendingUp, ShieldAlert, Filter, ChevronLeft,
} from "lucide-react";
import BarcodeScanner from "@/components/common/BarcodeScanner";
import { fmtDate } from "@/lib/printInventoryOperationDocuments";
import { requiresBranchTransferConfirmation } from "@shared/branch-transfer-confirmation";
import { BranchTransferConfirmation } from "@/components/inventory/BranchTransferConfirmation";
import { useAuth } from "@/_core/hooks/useAuth";
import { buildPmv2TransferCart } from "@/lib/pmv2-transfer-plan";

const MAX_ITEMS_PER_TRANSFER = 20;

interface CartItem {
  inventoryId: number;
  itemName: string;
  internalCode?: string;
  manufacturerBarcode?: string;
  unit?: string;
  balanceAtAddTime: number;
  quantity: number;
  lotTrackingToken?: string;
  lotCode?: string;
  lotBalanceAtAddTime?: number;
  notes?: string;
  materialNeedId?: number;
  originalQuantity?: number;
}

interface MaterialTransferHandoffContext {
  source: "pmv2" | "tickets";
  revision?: number;
  ticketId?: number;
  requestItemId: number;
  requestId: number;
  taskNumber: string;
  materialName: string;
  fromWarehouseId: number;
  toWarehouseId: number;
  inventoryId: number;
  quantity: number;
  unit: string;
}

function parsePositiveInt(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readMaterialTransferHandoff(): MaterialTransferHandoffContext | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const ticketSource = params.has("ticketTeamNeedId");
  if (ticketSource && params.has("pmv2RequestItemId")) return null;
  const requestItemId = parsePositiveInt(params.get(ticketSource ? "ticketTeamNeedId" : "pmv2RequestItemId"));
  const requestId = parsePositiveInt(params.get(ticketSource ? "ticketTeamAssignmentId" : "pmv2RequestId"));
  const fromWarehouseId = parsePositiveInt(params.get("fromWarehouseId"));
  const toWarehouseId = parsePositiveInt(params.get("toWarehouseId"));
  const inventoryId = parsePositiveInt(params.get("inventoryId"));
  const quantity = Number(params.get("quantity"));
  if (
    !requestItemId ||
    !requestId ||
    !fromWarehouseId ||
    !toWarehouseId ||
    !inventoryId ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return null;
  }
  return {
    source: ticketSource ? "tickets" : "pmv2",
    revision: ticketSource ? Number(params.get("ticketTeamRevision")) : undefined,
    ticketId: ticketSource ? Number(params.get("ticketId")) : undefined,
    requestItemId,
    requestId,
    taskNumber: params.get(ticketSource ? "ticketNumber" : "pmv2TaskNumber")?.trim() || (ticketSource ? "تذكرة الصيانة" : "PM V2"),
    materialName: params.get(ticketSource ? "ticketMaterialName" : "pmv2MaterialName")?.trim() || (ticketSource ? "مادة تذكرة الصيانة" : "مادة PM V2"),
    fromWarehouseId,
    toWarehouseId,
    inventoryId,
    quantity,
    unit: params.get("unit")?.trim() || "",
  };
}

function buildMaterialTransferNote(
  userNote: string | undefined,
  handoff: MaterialTransferHandoffContext,
) {
  const reference = `مرجع ${handoff.source === "tickets" ? "تذكرة الصيانة" : "PM V2"}: ${handoff.taskNumber} — طلب مواد #${handoff.requestId} / بند #${handoff.requestItemId}`;
  return userNote?.trim() ? `${userNote.trim()}\n${reference}` : reference;
}

export default function WarehouseTransfer() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const canOperateWarehouse = user?.role === "warehouse" || user?.role === "admin" || user?.role === "owner";
  const materialHandoff = useMemo(() => readMaterialTransferHandoff(), []);
  const utils = trpc.useUtils();
  const ticketOperation = useRef<{ fingerprint: string; key: string } | null>(null);

  const { data: warehousesList } = trpc.warehouse.list.useQuery();
  const { data: inventoryList } = trpc.inventory.list.useQuery();
  const { data: usersList } = trpc.users.list.useQuery();
  const { data: cardsList, refetch: refetchCards } = trpc.transfers.listCards.useQuery({});
  const { data: lotTrackingStatus } = trpc.inventoryCount.lotTrackingStatus.useQuery();
  const lotsEnabled = !!lotTrackingStatus?.enabled;
  const resolveTransferLotMut = trpc.transfers.resolveLot.useMutation();
  const linkConfirmedPmv2TransfersMut = trpc.pmv2.warehouse.linkConfirmedTransfers.useMutation();
  const preparePmv2TransferMut = trpc.pmv2.warehouse.prepareTransferHandoff.useMutation();
  const [pmv2Prepared, setPmv2Prepared] = useState(false);

  const [fromWarehouseId, setFromWarehouseId] = useState<string>("");
  const [toWarehouseId, setToWarehouseId] = useState<string>("");
  const [operationNotes, setOperationNotes] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"name" | "code" | "qr">("name");
  const [foundItem, setFoundItem] = useState<any>(null);
  const [qty, setQty] = useState("");
  const [itemNotes, setItemNotes] = useState("");
  const [transferLotInfo, setTransferLotInfo] = useState<any>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [branchConfirmation, setBranchConfirmation] = useState<string | null>(null);
  const transferBusy = useRef(false);
  const [lastResult, setLastResult] = useState<{ batchNumber: string; results: any[] } | null>(null);

  const [historyWarehouseFilter, setHistoryWarehouseFilter] = useState<string>("all");
  const [historySearch, setHistorySearch] = useState("");
  const [historySearchMode, setHistorySearchMode] = useState<"name" | "code" | "qr">("name");
  const [openDetailKey, setOpenDetailKey] = useState<string | null>(null);
  const [pmv2HandoffInitialized, setPmv2HandoffInitialized] = useState(false);
  const [materialLinkRetry, setMaterialLinkRetry] = useState<{
    requestItemId: number;
    transferNumbers: string[];
  } | null>(null);
  const [materialTransferPosted, setMaterialTransferPosted] = useState(false);

  useEffect(() => {
    if (!materialHandoff || pmv2HandoffInitialized || !inventoryList) return;
    if(materialHandoff.source==="pmv2") {
      setPmv2HandoffInitialized(true);
      void preparePmv2TransferMut.mutateAsync({requestItemId:materialHandoff.requestItemId}).then(handoff=>{
        const prepared=buildPmv2TransferCart(handoff,materialHandoff,inventoryList as any[],MAX_ITEMS_PER_TRANSFER);
        setFromWarehouseId(String(handoff.sourceWarehouse.id));setToWarehouseId(String(handoff.destinationWarehouse.id));setCart(prepared);setFoundItem(null);setPmv2Prepared(true);
      }).catch(error=>toast.error(error?.message||"تعذر تحميل توزيع مواد PMV2 المعتمد"));
      return;
    }
    const item = (inventoryList as any[]).find(
      (candidate: any) =>
        Number(candidate.id) === materialHandoff.inventoryId &&
        Number(candidate.warehouseId) === materialHandoff.fromWarehouseId,
    );
    setFromWarehouseId(String(materialHandoff.fromWarehouseId));
    setToWarehouseId(String(materialHandoff.toWarehouseId));
    if (!item) {
      toast.error(materialHandoff?.source === "tickets" ? "تعذر العثور على بطاقة المخزون المطلوبة للتذكرة؛ ارجع إلى الطلب وحدّث الرصيد" : "تعذر العثور على بطاقة المخزون التي جهزها طلب PM V2؛ ارجع إلى الطلب وحدّث الرصيد");
      setPmv2HandoffInitialized(true);
      return;
    }
    setFoundItem(item);
    setTransferLotInfo(null);
    setSearchQuery("");
    setQty(String(Math.min(materialHandoff.quantity, Number(item.quantity || 0))));
    setPmv2HandoffInitialized(true);
  }, [inventoryList, materialHandoff, pmv2HandoffInitialized]);

  const sourceItems = useMemo(() => {
    if (!fromWarehouseId || !inventoryList) return [];
    return (inventoryList as any[]).filter(
      (i) => String(i.warehouseId) === fromWarehouseId && (i.quantity || 0) > 0
    );
  }, [fromWarehouseId, inventoryList]);

  const remainingBalance = (item: any) => {
    const alreadyInCart = cart.filter(c => c.inventoryId === item.id).reduce((s, c) => s + c.quantity, 0);
    return (item.quantity || 0) - alreadyInCart;
  };

  const remainingPmv2HandoffQuantity = () => {
    if (!materialHandoff) return null;
    const alreadyInCart = cart
      .filter((item) => item.materialNeedId === materialHandoff.requestItemId)
      .reduce((sum, item) => sum + Number(item.originalQuantity ?? item.quantity ?? 0), 0);
    return Math.max(0, Number((materialHandoff.quantity - alreadyInCart).toFixed(3)));
  };

  const searchResults = useMemo(() => {
    if (!fromWarehouseId || !searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();
    return sourceItems
      .filter((item: any) => {
        if (searchMode === "code" || searchMode === "qr") {
          return (
            String(item.internalCode ?? "").toLowerCase().includes(q) ||
            String(item.manufacturerBarcode ?? "").toLowerCase().includes(q)
          );
        }
        return String(item.itemName ?? "").toLowerCase().includes(q);
      })
      .slice(0, 8);
  }, [sourceItems, searchQuery, searchMode, fromWarehouseId]);

  const warehouseName = (id: number) =>
    (warehousesList as any[])?.find((w: any) => w.id === id)?.nameAr || `#${id}`;

  const userName = (id: number) =>
    (usersList as any[])?.find((u: any) => u.id === id)?.name || `#${id}`;

  function selectItem(item: any) {
    if(pmv2Prepared) {toast.error("توزيع الصنف والبدائل محمّل من احتياج PMV2؛ ارجع إلى الطلب لتحديثه");return;}
    if (materialHandoff && Number(item.id) !== materialHandoff.inventoryId) {
      toast.error(materialHandoff?.source === "tickets" ? "هذا التحويل مرتبط بصنف التذكرة؛ ارجع للطلب لبدء تحويل مادة أخرى" : "هذا التحويل بدأ من طلب PM V2 لصنف محدد؛ ارجع للطلب لبدء تحويل مادة أخرى");
      return;
    }
    setFoundItem(item);
    setTransferLotInfo(null);
    setSearchQuery("");
    setQty("");
  }

  async function handleQRScan(code: string) {
    if(pmv2Prepared) {toast.error("تم تحديد اللوتات المعتمدة لاحتياج PMV2 تلقائيًا");return;}
    if (materialHandoff && materialTransferPosted) {
      toast.error(materialHandoff?.source === "tickets" ? "تم تنفيذ التحويل؛ ارجع إلى مواد التذكرة لإعادة فحص المتبقي قبل تحويل جديد" : "تم تنفيذ تحويل مرتبط بهذا السياق بالفعل؛ ارجع إلى طلب PM V2 لإعادة فحص المتبقي قبل تحويل جديد");
      return;
    }
    if (lotsEnabled) {
      if (!fromWarehouseId) {
        toast.error("اختر المخزن المصدر أولاً");
        return;
      }
      setTransferLotInfo(null);
      try {
        const resolved = await resolveTransferLotMut.mutateAsync({
          fromWarehouseId: Number(fromWarehouseId),
          trackingToken: code,
          fromInventoryId: foundItem?.id,
        });
        const item = sourceItems.find((i: any) => i.id === resolved.inventoryId);
        if (!item) {
          toast.error("الدفعة صحيحة لكن صنفها غير ظاهر ضمن رصيد المخزن المصدر؛ حدّث الصفحة");
          return;
        }
        setFoundItem(item);
        setTransferLotInfo(resolved);
        setSearchQuery("");
        const materialRemaining = remainingPmv2HandoffQuantity();
        setQty(
          materialRemaining == null
            ? ""
            : String(
                Math.min(
                  materialRemaining,
                  Number(resolved.availableQuantity || 0),
                  remainingBalance(item),
                ),
              ),
        );
        toast.success(`تم التحقق من الدفعة ${resolved.lotCode}: ${item.itemName}`);
      } catch (err: any) {
        toast.error(err?.message || "QR الدفعة أو رقم اللوت غير صالح للتحويل");
      }
      return;
    }

    const found = sourceItems.find((i: any) =>
      i.internalCode === code || i.manufacturerBarcode === code || String(i.id) === code
    );
    if (found) {
      selectItem(found);
      toast.success(`تم العثور على الصنف: ${found.itemName}`);
    } else {
      toast.error(`لم يتم العثور على صنف بهذا الرقم بالمخزن المصدر`);
    }
  }

  function addItemToCart() {
    if(pmv2Prepared) return;
    if (materialHandoff && materialTransferPosted) {
      toast.error(materialHandoff?.source === "tickets" ? "تم تنفيذ التحويل؛ ارجع إلى مواد التذكرة لإعادة فحص المتبقي قبل تحويل جديد" : "تم تنفيذ تحويل مرتبط بهذا السياق بالفعل؛ ارجع إلى طلب PM V2 لإعادة فحص المتبقي قبل تحويل جديد");
      return;
    }
    if (!foundItem) { toast.error("اختر صنفاً أولاً"); return; }
    if (cart.length >= MAX_ITEMS_PER_TRANSFER) {
      toast.error(`الحد الأقصى ${MAX_ITEMS_PER_TRANSFER} ${lotsEnabled ? "بند/دفعة" : "صنف"} بالعملية الواحدة`);
      return;
    }
    if (lotsEnabled && !transferLotInfo) {
      toast.error("يجب مسح QR الدفعة أو إدخال رقم اللوت قبل إضافة بند التحويل");
      return;
    }
    if (lotsEnabled && cart.some(c => c.lotTrackingToken === transferLotInfo?.trackingToken)) {
      toast.error("هذه الدفعة مضافة للعملية بالفعل؛ احذف البند أولاً إذا أردت تغيير كميته");
      return;
    }
    const qtyNum = parseFloat(qty);
    if (!qtyNum || qtyNum <= 0) { toast.error("أدخل كمية صحيحة أكبر من صفر"); return; }
    const remaining = remainingBalance(foundItem);
    if (qtyNum > remaining) {
      toast.error(`الكمية أكبر من الرصيد المتاح (${remaining} ${foundItem.unit || ""})`);
      return;
    }
    if (lotsEnabled && qtyNum > Number(transferLotInfo?.availableQuantity || 0)) {
      toast.error(`الكمية أكبر من رصيد الدفعة الممسوحة (${transferLotInfo?.availableQuantity || 0} ${foundItem.unit || ""})`);
      return;
    }

    const materialRemaining = remainingPmv2HandoffQuantity();
    if (materialHandoff) {
      if (Number(foundItem.id) !== materialHandoff.inventoryId) {
        toast.error(materialHandoff?.source === "tickets" ? "الصنف المحدد لا يطابق احتياج التذكرة" : "الصنف المحدد لا يطابق طلب PM V2");
        return;
      }
      if (materialRemaining == null || materialRemaining <= 0) {
        toast.error("تمت إضافة كامل الكمية القابلة للتحويل لهذا الطلب");
        return;
      }
      if (qtyNum > materialRemaining) {
        toast.error(`الكمية أكبر من القابل للتحويل لهذا الطلب (${materialRemaining} ${materialHandoff.unit || foundItem.unit || ""})`);
        return;
      }
    }

    setCart(prev => [...prev, {
      inventoryId: foundItem.id,
      itemName: foundItem.itemName,
      internalCode: foundItem.internalCode,
      manufacturerBarcode: foundItem.manufacturerBarcode,
      unit: foundItem.unit,
      balanceAtAddTime: foundItem.quantity,
      quantity: qtyNum,
      lotTrackingToken: lotsEnabled ? transferLotInfo?.trackingToken : undefined,
      lotCode: lotsEnabled ? transferLotInfo?.lotCode : undefined,
      lotBalanceAtAddTime: lotsEnabled ? Number(transferLotInfo?.availableQuantity || 0) : undefined,
      notes: itemNotes.trim() || undefined,
      materialNeedId: materialHandoff?.requestItemId,
    }]);

    const remainingAfterAdd = materialHandoff && materialRemaining != null
      ? Number(Math.max(0, materialRemaining - qtyNum).toFixed(3))
      : 0;
    setFoundItem(materialHandoff && remainingAfterAdd > 0 ? foundItem : null);
    setTransferLotInfo(null);
    setQty(materialHandoff && remainingAfterAdd > 0 ? String(remainingAfterAdd) : "");
    setItemNotes("");
    setSearchQuery("");
    toast.success(lotsEnabled ? "تم إضافة الدفعة للعملية" : "تم إضافة الصنف — يمكنك إضافة صنف آخر أو تنفيذ العملية");
  }

  function removeFromCart(idx: number) {
    if(pmv2Prepared) {toast.error("يجب تحويل كامل توزيع احتياج PMV2؛ ارجع إلى الطلب لتحديث التوزيع");return;}
    setCart(prev => prev.filter((_, i) => i !== idx));
  }

  const createBatchMut = trpc.transfers.createBatch.useMutation();

  async function linkMaterialTransfers(payload: { requestItemId: number; transferNumbers: string[] }) {
    try {
      const linked = await linkConfirmedPmv2TransfersMut.mutateAsync(payload);
      setMaterialLinkRetry(null);
      toast.success(
        linked.status === "issued_to_team"
          ? "تم ربط التحويل بطلب PM V2 وتغطية الكمية المطلوبة بالكامل"
          : `تم ربط التحويل بطلب PM V2 — المتبقي ${linked.remainingQuantity}`,
      );
      return true;
    } catch (error: any) {
      setMaterialLinkRetry(payload);
      toast.warning(
        `تم تنفيذ التحويل في المخزون، لكن تعذر تحديث PM V2: ${error?.message || "خطأ غير معروف"}. أعد محاولة الربط قبل مغادرة الصفحة.`,
      );
      return false;
    }
  }

  const transferFingerprint = JSON.stringify([fromWarehouseId, toWarehouseId, operationNotes, cart]);
  const sourceWarehouse = warehousesList?.find(w => String(w.id) === fromWarehouseId);
  const targetWarehouse = warehousesList?.find(w => String(w.id) === toWarehouseId);
  async function handleSubmitAll(confirmedFingerprint?: string) {
    if (transferBusy.current) return;
    if (materialHandoff && materialTransferPosted) {
      toast.error(materialHandoff?.source === "tickets" ? "تم تنفيذ التحويل؛ ارجع إلى مواد التذكرة لإعادة فحص المتبقي قبل تحويل جديد" : "تم تنفيذ تحويل مرتبط بهذا السياق بالفعل؛ ارجع إلى طلب PM V2 لإعادة فحص المتبقي قبل تحويل جديد");
      return;
    }
    if (!fromWarehouseId || !toWarehouseId) { toast.error("اختر المخزن المصدر والمخزن الهدف"); return; }
    if (fromWarehouseId === toWarehouseId) { toast.error("لا يمكن التحويل لنفس المخزن"); return; }
    if (cart.length === 0) { toast.error("أضف صنفاً واحداً على الأقل"); return; }
    if (materialHandoff) {
      const materialCartQuantity = Number(
        cart
          .filter((item) => item.materialNeedId === materialHandoff.requestItemId)
          .reduce((sum, item) => sum + Number(item.originalQuantity ?? item.quantity ?? 0), 0)
          .toFixed(3),
      );
      if (Math.abs(materialCartQuantity - materialHandoff.quantity) > 0.0005) {
        toast.error(`يجب تحويل كامل النقص المرتبط بالمهمة (${materialHandoff.quantity} ${materialHandoff.unit || "وحدة"}) في هذه العملية`);
        return;
      }
    }

    if (requiresBranchTransferConfirmation(sourceWarehouse, targetWarehouse) && confirmedFingerprint !== transferFingerprint) {
      setBranchConfirmation(transferFingerprint);
      return;
    }
    setBranchConfirmation(null);
    transferBusy.current = true;
    setIsSubmitting(true);
    try {
      const form = {
        fromWarehouseId: Number(fromWarehouseId),
        toWarehouseId: Number(toWarehouseId),
        notes: operationNotes.trim() || undefined,
        items: cart.map(c => ({
          fromInventoryId: c.inventoryId,
          quantity: c.quantity,
          lotTrackingToken: lotsEnabled ? c.lotTrackingToken : undefined,
          notes:
            materialHandoff && c.materialNeedId === materialHandoff.requestItemId
              ? buildMaterialTransferNote(c.notes, materialHandoff)
              : c.notes,
        })),
      };
      const fingerprint = JSON.stringify(form);
      if (materialHandoff?.source === "tickets" && ticketOperation.current?.fingerprint !== fingerprint) ticketOperation.current = { fingerprint, key: 'mtt:' + crypto.randomUUID() };
      const res = materialHandoff?.source === "tickets"
        ? await utils.client.ticketTeamExecution.transferFromForm.mutate({ assignmentId: materialHandoff.requestId, needId: materialHandoff.requestItemId, expectedRevision: materialHandoff.revision!, operationKey: ticketOperation.current!.key, form: { ...form, items: form.items.map(item => ({ ...item, lotTrackingToken: item.lotTrackingToken! })) } })
        : await createBatchMut.mutateAsync(form);
      if (materialHandoff?.source === "tickets") setMaterialTransferPosted(true);

      const resultsWithNames = res.results.map((r: any, idx: number) => ({
        ...r,
        itemName: cart[idx]?.itemName || `صنف #${r.fromInventoryId}`,
        lotCode: r.lotCode || cart[idx]?.lotCode || null,
        materialNeedId: cart[idx]?.materialNeedId,
      }));
      setLastResult({ batchNumber: res.batchNumber, results: resultsWithNames });

      const successCount = resultsWithNames.filter((r: any) => r.success).length;
      const failCount = resultsWithNames.length - successCount;
      if (failCount === 0) {
        toast.success(`تمت العملية ${res.batchNumber} بنجاح (${successCount} صنف)`);
        setCart([]);
        setOperationNotes("");
      } else {
        toast.warning(`العملية ${res.batchNumber}: نجح ${successCount} وفشل ${failCount}`);
        setCart(prev => prev.filter((_, idx) => !resultsWithNames[idx]?.success));
      }
      refetchCards();

      const materialTransferNumbers = resultsWithNames
        .filter(
          (result: any) =>
            result.success &&
            result.materialNeedId === materialHandoff?.requestItemId &&
            result.transferNumber,
        )
        .map((result: any) => String(result.transferNumber));
      if (materialHandoff?.source === "pmv2" && materialTransferNumbers.length > 0) {
        // The physical stock move already happened. Freeze this handoff immediately,
        // even if the PM V2 projection link fails, so a stale URL/context cannot
        // be reused for a second transfer before the queue rechecks the remaining need.
        setMaterialTransferPosted(true);
        setCart([]);
        setFoundItem(null);
        setTransferLotInfo(null);
        setQty("");
        setSearchQuery("");
        await linkMaterialTransfers({
          requestItemId: materialHandoff.requestItemId,
          transferNumbers: materialTransferNumbers,
        });
      }
    } catch (err: any) {
      toast.error(err.message || "فشل تنفيذ العملية");
    } finally {
      transferBusy.current = false;
      setIsSubmitting(false);
    }
  }

  // ── إحصائيات وفلترة تبويب السجل ──
  const historyStats = useMemo(() => {
    const list = (cardsList as any[]) || [];
    return {
      total: list.length,
      totalItems: list.reduce((s, c) => s + (c.itemsCount || 0), 0),
      mismatchOps: list.filter((c: any) => (c.mismatchCount || 0) > 0).length,
    };
  }, [cardsList]);

  const filteredHistory = useMemo(() => {
    let list = (cardsList as any[]) || [];
    if (historyWarehouseFilter !== "all") {
      const wid = Number(historyWarehouseFilter);
      list = list.filter((c: any) => c.fromWarehouseId === wid || c.toWarehouseId === wid);
    }
    if (historySearch.trim()) {
      const q = historySearch.trim().toLowerCase();
      list = list.filter((c: any) => {
        const items: any[] = c.itemsSummary || [];
        if (historySearchMode === "code" || historySearchMode === "qr") {
          return items.some((it: any) =>
            String(it.internalCode ?? "").toLowerCase().includes(q) ||
            String(it.manufacturerBarcode ?? "").toLowerCase().includes(q) ||
            String(it.lotCode ?? "").toLowerCase().includes(q) ||
            String(it.lotTrackingToken ?? "").toLowerCase().includes(q)
          );
        }
        // وضع "بالاسم": يبحث باسم أي صنف داخل العملية، أو برقم العملية، أو بالملاحظات
        return (
          items.some((it: any) => String(it.itemName ?? "").toLowerCase().includes(q)) ||
          c.displayNumber?.toLowerCase().includes(q) ||
          (c.notes || "").toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [cardsList, historyWarehouseFilter, historySearch, historySearchMode]);

  const { data: detail, isLoading: loadingDetail } = trpc.transfers.getBatchDetail.useQuery(
    { key: openDetailKey! }, { enabled: !!openDetailKey }
  );

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/warehouses")}>
          <ArrowRight className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5 text-primary" /> التحويل بين المخازن
          </h1>
          <p className="text-sm text-muted-foreground">تنفيذ عمليات تحويل جديدة، ومراجعة سجل كل العمليات السابقة</p>
        </div>
      </div>

      {materialHandoff && materialTransferPosted && (
        <Card className="border-amber-300 bg-amber-50/70">
          <CardContent className="p-4 text-sm text-amber-900">
            <p className="font-semibold">تم تنفيذ تحويل من هذا السياق</p>
            <p className="mt-1">
              {materialHandoff.source === "tickets" ? "ارجع إلى مواد تذاكر الصيانة لإعادة فحص الرصيد قبل بدء تحويل آخر." : "ارجع إلى طلبات مواد PM V2 لإعادة فحص الكمية المتبقية والرصيد الحالي قبل بدء تحويل آخر."}
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-3 w-full border-amber-300"
              onClick={() => navigate(materialHandoff?.source === "tickets" ? `/scheduled-maintenance/warehouse-requests?source=tickets&ticketId=${materialHandoff.ticketId}` : "/scheduled-maintenance/warehouse-requests")}
            >
              {materialHandoff.source === "tickets" ? "العودة إلى مواد تذاكر الصيانة وإعادة الفحص" : "العودة إلى طلبات مواد PM V2 وإعادة الفحص"}
            </Button>
          </CardContent>
        </Card>
      )}

      {materialHandoff && (
        <Card className="border-blue-200 bg-blue-50/60">
          <CardContent className="p-4 text-sm text-blue-900">
            <p className="font-semibold">{materialHandoff.source === "tickets" ? "تحويل مرتبط بمواد تذكرة الصيانة" : "تحويل مرتبط بطلب مواد PM V2"}</p>
            <p className="mt-1">
              المهمة {materialHandoff.taskNumber} — {materialHandoff.materialName}
            </p>
            <p className="mt-1 text-xs">
              الكمية المطلوب تحويلها كاملة الآن: {materialHandoff.quantity} {materialHandoff.unit || "وحدة"}. يمكنك تقسيمها على أكثر من Lot داخل نفس العملية، لكن يجب أن يساوي الإجمالي كامل النقص.
            </p>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue={canOperateWarehouse ? "perform" : "history"}>
        <TabsList className={`grid w-full max-w-md ${canOperateWarehouse ? "grid-cols-2" : "grid-cols-1"}`}>
          {canOperateWarehouse && <TabsTrigger value="perform" className="gap-1.5">
            <SendHorizontal className="w-3.5 h-3.5" /> تنفيذ تحويل
          </TabsTrigger>}
          <TabsTrigger value="history" className="gap-1.5">
            <History className="w-3.5 h-3.5" /> سجل التحويلات
          </TabsTrigger>
        </TabsList>

        {/* ══════════════════════ تبويب 1: تنفيذ تحويل ══════════════════════ */}
        {canOperateWarehouse && <TabsContent value="perform" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">من مخزن *</Label>
                  <Select
                    value={fromWarehouseId}
                    onValueChange={(v) => { setFromWarehouseId(v); setCart([]); setFoundItem(null); setTransferLotInfo(null); setSearchQuery(""); }}
                    disabled={!!materialHandoff || cart.length > 0}
                  >
                    <SelectTrigger><SelectValue placeholder="اختر المخزن المصدر" /></SelectTrigger>
                    <SelectContent>
                      {(warehousesList as any[] || []).map((w: any) => (
                        <SelectItem key={w.id} value={String(w.id)}>{w.nameAr}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">إلى مخزن *</Label>
                  <Select value={toWarehouseId} onValueChange={setToWarehouseId} disabled={!!materialHandoff}>
                    <SelectTrigger><SelectValue placeholder="اختر المخزن الهدف" /></SelectTrigger>
                    <SelectContent>
                      {(warehousesList as any[] || [])
                        .filter((w: any) => String(w.id) !== fromWarehouseId)
                        .map((w: any) => (
                          <SelectItem key={w.id} value={String(w.id)}>{w.nameAr}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {cart.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  لتغيير المخزن المصدر، أفرغ السلة أولاً أو نفّذ العملية الحالية.
                </p>
              )}

              <div className="space-y-2 p-3 border rounded-lg bg-muted/20">
                <p className="text-sm font-medium">إضافة صنف</p>

                {!fromWarehouseId && (
                  <p className="text-xs text-muted-foreground">اختر المخزن المصدر أولاً</p>
                )}

                {fromWarehouseId && (
                  <>
                    <div className="flex gap-2">
                      <Button size="sm" variant={searchMode === "name" ? "default" : "outline"}
                        onClick={() => { setSearchMode("name"); setSearchQuery(""); }} className="gap-1">
                        <Search className="w-3.5 h-3.5" /> بالاسم
                      </Button>
                      <Button size="sm" variant={searchMode === "code" ? "default" : "outline"}
                        onClick={() => { setSearchMode("code"); setSearchQuery(""); }} className="gap-1">
                        <QrCode className="w-3.5 h-3.5" /> بالرقم
                      </Button>
                      <Button size="sm" variant={searchMode === "qr" ? "default" : "outline"}
                        onClick={() => { setSearchMode("qr"); setSearchQuery(""); }} className="gap-1">
                        <QrCode className="w-3.5 h-3.5" /> {lotsEnabled ? "QR الدفعة / رقم اللوت" : "QR Code"}
                      </Button>
                    </div>

                    {searchMode === "qr" && !foundItem && (
                      <BarcodeScanner
                        onScan={handleQRScan}
                        placeholder={lotsEnabled ? "امسح QR الدفعة أو أدخل رقم اللوت..." : "امسح QR Code الصنف..."}
                      />
                    )}

                    {(searchMode === "name" || searchMode === "code") && !foundItem && (
                      <div className="relative">
                        <Input
                          placeholder={searchMode === "name" ? "ابحث باسم الصنف..." : "ابحث برقم الصنف أو الباركود..."}
                          value={searchQuery}
                          onChange={e => setSearchQuery(e.target.value)}
                          dir="rtl"
                        />
                        {searchResults.length > 0 && (
                          <div className="absolute top-full right-0 left-0 z-50 bg-white border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                            {searchResults.map((item: any) => {
                              const remaining = remainingBalance(item);
                              return (
                                <button
                                  key={item.id}
                                  className="w-full text-right px-3 py-2 hover:bg-muted/50 text-sm flex items-center justify-between disabled:opacity-40"
                                  onClick={() => selectItem(item)}
                                  disabled={remaining <= 0}
                                >
                                  <span className="font-medium">{item.itemName}</span>
                                  <span className="text-xs text-muted-foreground">متاح: {remaining} {item.unit}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {searchQuery.trim() && searchResults.length === 0 && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <PackageSearch className="w-3.5 h-3.5" /> لا نتائج مطابقة
                          </p>
                        )}
                      </div>
                    )}

                    {foundItem && (
                      <div className="space-y-3">
                        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-semibold text-sm">{foundItem.itemName}</p>
                              <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                                {foundItem.internalCode && (
                                  <p>الكود: <span className="font-mono">{foundItem.internalCode}</span></p>
                                )}
                                <p>الرصيد الحالي بالمخزن المصدر: <strong className="text-foreground">{foundItem.quantity} {foundItem.unit}</strong></p>
                                <p>المتاح فعلياً للتحويل الآن: <strong className="text-foreground">{remainingBalance(foundItem)} {foundItem.unit}</strong></p>
                              </div>
                            </div>
                            {!materialHandoff && (
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setFoundItem(null); setTransferLotInfo(null); setQty(""); setItemNotes(""); }}>
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {lotsEnabled && (
                          <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
                            <Label className="text-xs flex items-center gap-1">
                              <QrCode className="w-3.5 h-3.5" /> QR الدفعة / رقم اللوت *
                            </Label>
                            {!transferLotInfo && (
                              <BarcodeScanner
                                onScan={handleQRScan}
                                placeholder="امسح QR الدفعة أو أدخل رقم اللوت المراد نقله..."
                              />
                            )}
                            {resolveTransferLotMut.isPending && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin" /> جاري التحقق من الدفعة...
                              </p>
                            )}
                            {transferLotInfo && (
                              <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-2 flex items-center justify-between gap-2">
                                <span>
                                  <strong>{transferLotInfo.lotCode}</strong> — المتاح في المخزن المصدر: {transferLotInfo.availableQuantity} {foundItem.unit || "وحدة"}
                                </span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => setTransferLotInfo(null)}
                                >
                                  تغيير
                                </Button>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <Label className="text-xs">الكمية المراد تحويلها *</Label>
                          <Input
                            type="number" min={0.001} step="any" value={qty}
                            onChange={e => setQty(e.target.value)} placeholder="0" dir="ltr" className="font-mono"
                          />
                          {qty && parseFloat(qty) > remainingBalance(foundItem) && (
                            <p className="text-xs text-destructive flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> أكبر من المتاح
                            </p>
                          )}
                          {lotsEnabled && transferLotInfo && qty && parseFloat(qty) > Number(transferLotInfo.availableQuantity || 0) && (
                            <p className="text-xs text-destructive flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> أكبر من رصيد الدفعة الممسوحة
                            </p>
                          )}
                          {materialHandoff && qty && parseFloat(qty) > Number(remainingPmv2HandoffQuantity() || 0) && (
                            <p className="text-xs text-destructive flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> {materialHandoff.source === "tickets" ? "أكبر من كمية احتياج التذكرة القابلة للتحويل" : "أكبر من الكمية القابلة للتحويل لهذا طلب PM V2"}
                            </p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">ملاحظة على هذا الصنف (اختياري)</Label>
                          <Input value={itemNotes} onChange={e => setItemNotes(e.target.value)} placeholder="سبب خاص بهذا الصنف..." />
                        </div>

                        <Button
                          className="w-full gap-2"
                          variant="outline"
                          onClick={addItemToCart}
                          disabled={materialTransferPosted || resolveTransferLotMut.isPending || (lotsEnabled && !transferLotInfo)}
                        >
                          <Plus className="w-4 h-4" /> إضافة هذا الصنف للعملية
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {cart.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {lotsEnabled ? "البنود/الدفعات المضافة" : "الأصناف المضافة"} ({cart.length}/{MAX_ITEMS_PER_TRANSFER})
                  </p>
                  <div className="space-y-1.5">
                    {cart.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-2 p-2.5 border rounded-md bg-background">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{item.itemName}</p>
                          <p className="text-xs text-muted-foreground">
                            الكمية: {item.quantity} {item.unit || ""}
                            {item.lotCode ? ` — الدفعة: ${item.lotCode}` : ""}
                            {item.notes ? ` — ${item.notes}` : ""}
                          </p>
                          {item.materialNeedId && (
                            <Badge variant="outline" className="mt-1 border-blue-200 bg-blue-50 text-blue-700">
                              {materialHandoff?.source === "tickets" ? "مرتبط بتذكرة الصيانة" : "مرتبط بطلب PM V2"}
                            </Badge>
                          )}
                        </div>
                        <Button variant="ghost" size="icon" disabled={pmv2Prepared} className="h-7 w-7 shrink-0 text-destructive" onClick={() => removeFromCart(idx)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">ملاحظات عامة على العملية (اختياري)</Label>
                <Textarea
                  value={operationNotes} onChange={e => setOperationNotes(e.target.value)}
                  placeholder="سبب التحويل بشكل عام..." rows={2}
                />
              </div>

              <BranchTransferConfirmation open={branchConfirmation !== null} sourceName={sourceWarehouse?.nameAr || ""} targetName={targetWarehouse?.nameAr || ""}
                onOpenChange={open => { if (!open) setBranchConfirmation(null); }}
                onConfirm={() => { void handleSubmitAll(branchConfirmation || undefined); }} />
              <Button className="w-full gap-1.5" onClick={() => void handleSubmitAll()} disabled={materialTransferPosted || isSubmitting || cart.length === 0}>
                {isSubmitting
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <><ArrowLeftRight className="w-4 h-4" /> تنفيذ تحويل {cart.length > 0 ? `(${cart.length} ${lotsEnabled ? "بند" : "صنف"})` : ""}</>}
              </Button>

              {lastResult && (
                <div className="space-y-1.5 pt-2 border-t">
                  <p className="text-xs font-medium text-muted-foreground">
                    نتيجة عملية {lastResult.batchNumber}
                  </p>
                  {lastResult.results.map((r: any, i: number) => (
                    <div key={i} className={`flex items-center gap-2 text-xs p-2 rounded ${r.success ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
                      {r.success ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                      <span className="font-medium">{r.itemName}</span>
                      {r.lotCode && <span className="font-mono">{r.lotCode}</span>}
                      <span className="text-muted-foreground">— {r.message}</span>
                    </div>
                  ))}
                  {materialLinkRetry && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={linkConfirmedPmv2TransfersMut.isPending}
                      onClick={() => linkMaterialTransfers(materialLinkRetry)}
                    >
                      {linkConfirmedPmv2TransfersMut.isPending && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                      إعادة ربط التحويل بطلب PM V2
                    </Button>
                  )}
                  {materialHandoff && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => navigate(materialHandoff?.source === "tickets" ? `/scheduled-maintenance/warehouse-requests?source=tickets&ticketId=${materialHandoff.ticketId}` : "/scheduled-maintenance/warehouse-requests")}
                    >
                      {materialHandoff.source === "tickets" ? "العودة إلى مواد تذاكر الصيانة" : "العودة إلى طلبات مواد PM V2"}
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>}

        {/* ══════════════════════ تبويب 2: سجل التحويلات (بطاقة واحدة لكل عملية) ══════════════════════ */}
        <TabsContent value="history" className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Card className="border-blue-200 bg-blue-50/50">
              <CardContent className="p-3 text-center">
                <Boxes className="w-5 h-5 mx-auto text-blue-600 mb-1" />
                <p className="text-2xl font-bold text-blue-800">{historyStats.total}</p>
                <p className="text-[10px] text-blue-600">إجمالي عمليات التحويل</p>
              </CardContent>
            </Card>
            <Card className="border-emerald-200 bg-emerald-50/50">
              <CardContent className="p-3 text-center">
                <TrendingUp className="w-5 h-5 mx-auto text-emerald-600 mb-1" />
                <p className="text-2xl font-bold text-emerald-800">{historyStats.totalItems}</p>
                <p className="text-[10px] text-emerald-600">إجمالي عدد الأصناف المحوَّلة</p>
              </CardContent>
            </Card>
            <Card className="border-amber-200 bg-amber-50/50">
              <CardContent className="p-3 text-center">
                <ShieldAlert className="w-5 h-5 mx-auto text-amber-600 mb-1" />
                <p className="text-2xl font-bold text-amber-800">{historyStats.mismatchOps}</p>
                <p className="text-[10px] text-amber-600">عمليات فيها تنبيه عدم تطابق</p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              {/* أزرار طريقة البحث — نفس تصميم "إضافة صنف" بالضبط */}
              <div className="flex gap-1.5">
                <Button size="sm" variant={historySearchMode === "name" ? "default" : "outline"}
                  onClick={() => { setHistorySearchMode("name"); setHistorySearch(""); }} className="gap-1">
                  <Search className="w-3.5 h-3.5" /> بالاسم
                </Button>
                <Button size="sm" variant={historySearchMode === "code" ? "default" : "outline"}
                  onClick={() => { setHistorySearchMode("code"); setHistorySearch(""); }} className="gap-1">
                  <QrCode className="w-3.5 h-3.5" /> بالرقم
                </Button>
                <Button size="sm" variant={historySearchMode === "qr" ? "default" : "outline"}
                  onClick={() => { setHistorySearchMode("qr"); setHistorySearch(""); }} className="gap-1">
                  <QrCode className="w-3.5 h-3.5" /> QR Code
                </Button>
              </div>

              <Select value={historyWarehouseFilter} onValueChange={setHistoryWarehouseFilter}>
                <SelectTrigger className="w-full sm:w-[220px] gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="كل المخازن" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المخازن</SelectItem>
                  {(warehousesList as any[] || []).map((w: any) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.nameAr}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {historySearchMode === "qr" ? (
              <BarcodeScanner
                onScan={(code) => { setHistorySearch(code); setHistorySearchMode("code"); }}
                placeholder={lotsEnabled ? "امسح/أدخل كود الدفعة للبحث في السجل..." : "امسح QR Code الصنف..."}
              />
            ) : (
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                  placeholder={
                    historySearchMode === "name"
                      ? "ابحث باسم الصنف، رقم العملية، أو الملاحظات..."
                      : "ابحث برقم الصنف أو الباركود..."
                  }
                  className="pr-9 pl-9"
                />
                {historySearch && (
                  <button className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setHistorySearch("")}>
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>

          {filteredHistory.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center text-muted-foreground">
                <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">
                  {(cardsList as any[])?.length ? "لا نتائج مطابقة للفلاتر الحالية" : "لا توجد تحويلات بعد"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredHistory.map((c: any) => (
                <button key={c.key} className="w-full text-right" onClick={() => setOpenDetailKey(c.key)}>
                  <Card className="hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <ArrowLeftRight className="w-4 h-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded font-semibold">{c.displayNumber}</span>
                              <Badge variant="secondary" className="text-[10px]">
                                {c.itemsCount} {c.itemsCount === 1 ? "صنف" : "أصناف"}
                              </Badge>
                              {c.mismatchCount > 0 && (
                                <span className="flex items-center gap-1 text-amber-600 text-[10px] font-medium">
                                  <AlertTriangle className="w-3 h-3" /> {c.mismatchCount} تنبيه
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 text-sm">
                              <span className="font-medium">{warehouseName(c.fromWarehouseId)}</span>
                              <ArrowLeftRight className="w-3 h-3 text-muted-foreground shrink-0" />
                              <span className="font-medium">{warehouseName(c.toWarehouseId)}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(c.createdAt)} — {userName(c.createdById)}</p>
                            {c.itemsSummary?.length > 0 && (
                              <p className="text-xs text-muted-foreground mt-1 truncate">
                                {c.itemsSummary.slice(0, 2).map((it: any) => it.itemName).join("، ")}
                                {c.itemsSummary.length > 2 && ` +${c.itemsSummary.length - 2} أصناف أخرى`}
                              </p>
                            )}
                          </div>
                        </div>
                        <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0" />
                      </div>
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ══ نافذة تفاصيل العملية ══ */}
      <Dialog open={!!openDetailKey} onOpenChange={(v) => !v && setOpenDetailKey(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4 text-primary" /> تفاصيل عملية التحويل
            </DialogTitle>
          </DialogHeader>

          {loadingDetail && (
            <div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          )}

          {detail && (
            <div className="space-y-4">
              {/* ملخص العملية */}
              <div className="p-3 bg-muted/30 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm bg-background px-2 py-0.5 rounded font-semibold border">
                    {detail.displayNumber}
                  </span>
                  <span className="text-xs text-muted-foreground">{fmtDate(detail.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{warehouseName(detail.fromWarehouseId)}</Badge>
                  <ArrowLeftRight className="w-3.5 h-3.5 text-muted-foreground" />
                  <Badge variant="outline">{warehouseName(detail.toWarehouseId)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">نفّذها: {userName(detail.createdById)}</p>
                {detail.notes && (
                  <p className="text-xs text-muted-foreground border-t pt-2">ملاحظات عامة: {detail.notes}</p>
                )}
              </div>

              {/* قائمة الأصناف */}
              <div className="space-y-1.5">
                <p className="text-sm font-medium">الأصناف ({detail.items.length})</p>
                <div className="max-h-72 overflow-y-auto divide-y border rounded-md">
                  {detail.items.map((item: any, idx: number) => (
                    <div key={idx} className="p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-sm">{item.itemName}</p>
                        <span className="font-mono text-xs text-muted-foreground">{item.transferNumber}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        {item.internalCode && <span>الكود: <span className="font-mono">{item.internalCode}</span></span>}
                        {item.lotCode && <span>الدفعة: <span className="font-mono">{item.lotCode}</span></span>}
                        <span>الكمية: <strong className="text-foreground">{item.quantity} {item.unit}</strong></span>
                        {item.categoryMismatch ? (
                          <span className="flex items-center gap-1 text-amber-600 font-medium">
                            <AlertTriangle className="w-3 h-3" /> تصنيف غير مطابق
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-emerald-600 font-medium">
                            <CheckCircle2 className="w-3 h-3" /> مطابق
                          </span>
                        )}
                      </div>
                      {item.notes && <p className="text-xs text-muted-foreground">ملاحظة: {item.notes}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
