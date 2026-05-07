import { trpc } from "@/lib/trpc";
import { mediaUrl } from "@/lib/mediaUrl";
import { useAuth } from "@/_core/hooks/useAuth";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowRight, ShoppingCart, CheckCircle2, Clock, DollarSign, Loader2,
  Camera, Package, User, FileText, AlertCircle, ExternalLink, XCircle, Pencil, Upload
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "@/contexts/LanguageContext";
import { useStaticLabels } from "@/hooks/useContentTranslation";
import DropZone, { type UploadedFile } from "@/components/DropZone";

const PO_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_review: "bg-purple-100 text-purple-700",
  pending_estimate: "bg-amber-100 text-amber-700",
  pending_accounting: "bg-orange-100 text-orange-700",
  pending_management: "bg-orange-100 text-orange-700",
  approved: "bg-teal-100 text-teal-700",
  partial_purchase: "bg-cyan-100 text-cyan-700",
  purchased: "bg-emerald-100 text-emerald-700",
  received: "bg-green-100 text-green-700",
  closed: "bg-gray-100 text-gray-700",
  rejected: "bg-red-100 text-red-700",
  revision_needed: "bg-rose-100 text-rose-700",
};

const ITEM_STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  estimated: "bg-amber-100 text-amber-700",
  approved: "bg-teal-100 text-teal-700",
  rejected: "bg-red-100 text-red-700",
  purchased: "bg-emerald-100 text-emerald-700",
  received: "bg-green-100 text-green-700",
};

function numberToArabicWords(num: number): string {
  if (num === 0) return "صفر ريال";
  const ones = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
  const tens = ["", "عشرة", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
  const teens = ["عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
  const hundreds = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];
  const parts: string[] = [];
  const intPart = Math.floor(num);
  const decPart = Math.round((num - intPart) * 100);
  if (intPart >= 1000000) { const m = Math.floor(intPart / 1000000); parts.push(m === 1 ? "مليون" : m === 2 ? "مليونان" : `${ones[m] || m} ملايين`); }
  const rem = intPart % 1000000;
  if (rem >= 1000) { const t = Math.floor(rem / 1000); if (t === 1) parts.push("ألف"); else if (t === 2) parts.push("ألفان"); else if (t <= 10) parts.push(`${ones[t]} آلاف`); else parts.push(`${t} ألف`); }
  const r = rem % 1000;
  if (r >= 100) parts.push(hundreds[Math.floor(r / 100)]);
  const lastTwo = r % 100;
  if (lastTwo >= 10 && lastTwo <= 19) { parts.push(teens[lastTwo - 10]); }
  else { if (lastTwo % 10 > 0) parts.push(ones[lastTwo % 10]); if (Math.floor(lastTwo / 10) > 0) parts.push(tens[Math.floor(lastTwo / 10)]); }
  let result = parts.join(" و") + " ريال";
  if (decPart > 0) result += ` و${decPart} هللة`;
  return result;
}

export default function PurchaseOrderDetail() {
  const [, params] = useRoute("/purchase-orders/:id");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const { getPOStatusLabel, getPOItemStatusLabel } = useStaticLabels();
  const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";
  const currency = language === "en" ? "SAR" : "ر.س";
  const poId = parseInt(params?.id || "0");

  const { data: po, isLoading, refetch } = trpc.purchaseOrders.getById.useQuery({ id: poId }, { enabled: !!poId });
  const { data: users } = trpc.users.list.useQuery();

  const estimateMut = trpc.purchaseOrders.estimateCost.useMutation({ onSuccess: () => { toast.success(t.common.save); refetch(); }, onError: (e) => toast.error(e.message) });
  const reviewItemsMut = trpc.purchaseOrders.reviewItems.useMutation({ onSuccess: () => { toast.success(t.common.confirm); refetch(); }, onError: (e) => toast.error(e.message) });
  const approveAccMut = trpc.purchaseOrders.approveAccounting.useMutation({ onSuccess: () => { toast.success(t.common.confirm); refetch(); }, onError: (e) => toast.error(e.message) });
  const approveMgmtMut = trpc.purchaseOrders.approveManagement.useMutation({ onSuccess: () => { toast.success(t.common.confirm); refetch(); }, onError: (e) => toast.error(e.message) });
  const rejectMut = trpc.purchaseOrders.reject.useMutation({ onSuccess: () => { toast.success(t.common.confirm); refetch(); }, onError: (e) => toast.error(e.message) });
  const confirmPurchaseMut = trpc.purchaseOrders.confirmItemPurchase.useMutation({ onSuccess: () => { toast.success(t.common.confirm); refetch(); }, onError: (e) => toast.error(e.message) });
  const receiveItemMut = trpc.purchaseOrders.confirmDeliveryToWarehouse.useMutation({ onSuccess: () => { toast.success(t.common.confirm); refetch(); }, onError: (e: any) => toast.error(e.message) });
  const editItemMut = trpc.purchaseOrders.editItem.useMutation({ onSuccess: () => { toast.success(t.common.savedSuccessfully); setEditingItem(null); refetch(); }, onError: (e: any) => toast.error(e.message) });

  const role = user?.role || "";
  const userId = user?.id;

  const [estimates, setEstimates] = useState<Record<number, string>>({});
  const [rejectReason, setRejectReason] = useState("");
  const [custodyAmount, setCustodyAmount] = useState("");
  const [uploadingItem, setUploadingItem] = useState<string | null>(null);
  const [itemPhotos, setItemPhotos] = useState<Record<number, { invoice?: string; purchased?: string; warehouse?: string }>>({})
  const [dropZoneFor, setDropZoneFor] = useState<string | null>(null); // e.g. "123-invoice" or "123-purchased";
  const [receiveData, setReceiveData] = useState<Record<number, { cost: string; supplier: string; supplierItemName: string; warehousePhotoUrl: string }>>({});
  const [editingItem, setEditingItem] = useState<any>(null);
  const [editForm, setEditForm] = useState<{ itemName: string; description: string; quantity: number; estimatedUnitCost: string }>({ itemName: "", description: "", quantity: 1, estimatedUnitCost: "" });
  const [reviewDecisions, setReviewDecisions] = useState<Record<number, { action: "approve" | "reject"; delegateId?: number; rejectionReason?: string }>>({});
  const [revisionNote, setRevisionNote] = useState("");
  const [isRevisionDialogOpen, setIsRevisionDialogOpen] = useState(false);
  const [resubmitNote, setResubmitNote] = useState("");

  const requestRevisionMut = trpc.purchaseOrders.requestRevision.useMutation({
    onSuccess: () => { toast.success("تم إرسال الطلب للمراجعة"); setIsRevisionDialogOpen(false); setRevisionNote(""); refetch(); },
    onError: (e) => toast.error(e.message)
  });

  const resubmitMut = trpc.purchaseOrders.resubmit.useMutation({
    onSuccess: () => { toast.success("تم إعادة تقديم الطلب"); setResubmitNote(""); refetch(); },
    onError: (e) => toast.error(e.message)
  });

  const closeMut = trpc.purchaseOrders.close.useMutation({
    onSuccess: () => { toast.success("تم إغلاق الطلب"); refetch(); },
    onError: (e) => toast.error(e.message)
  });

  const isAdminOrOwner = role === "admin" || role === "owner";
  const isDelegate = role === "delegate" || isAdminOrOwner;
  const isAccountant = role === "accountant" || isAdminOrOwner;
  const isManagement = role === "senior_management" || isAdminOrOwner;
  const isWarehouse = role === "warehouse" || isAdminOrOwner;
  const isManager = role === "maintenance_manager" || role === "purchase_manager" || isAdminOrOwner;
  const visibleItems = useMemo(() => {
    if (!po?.items) return [];
    // Admin/owner see all items; delegate sees only their own
    if (isAdminOrOwner) return po.items;
    if (role === "delegate") return po.items.filter((item: any) => item.delegateId === userId);
    return po.items;
  }, [po?.items, isAdminOrOwner, role, userId]);
  const totalEstimated = useMemo(() => visibleItems.reduce((sum: number, item: any) => sum + (parseFloat(item.estimatedTotalCost || "0")), 0), [visibleItems]);
  const totalActual = useMemo(() => visibleItems.reduce((sum: number, item: any) => sum + (parseFloat(item.actualTotalCost || "0")), 0), [visibleItems]);

  const handleUpload = async (file: File, itemId: number, type: "invoice" | "purchased" | "warehouse"): Promise<string | null> => {
    setUploadingItem(`${itemId}-${type}`);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.url) {
        setItemPhotos(prev => ({ ...prev, [itemId]: { ...prev[itemId], [type]: data.url } }));
        toast.success(t.common.save);
        setUploadingItem(null);
        return data.url;
      }
    } catch { toast.error(t.common.close); }
    setUploadingItem(null);
    return null;
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>;
  if (!po) return <div className="text-center py-12 text-muted-foreground">{t.common.noData}</div>;

  const requestedBy = users?.find((u: any) => u.id === po.requestedById);

  const steps = [
    { key: "draft", label: getPOStatusLabel("draft"), done: true },
    { key: "pending_review", label: getPOStatusLabel("pending_review"), done: !["draft", "revision_needed"].includes(po.status) },
    { key: "pending_estimate", label: getPOStatusLabel("pending_estimate"), done: !["draft", "pending_review", "revision_needed"].includes(po.status) },
    { key: "pending_accounting", label: getPOStatusLabel("pending_accounting"), done: !["draft", "pending_review", "pending_estimate", "revision_needed"].includes(po.status) },
    { key: "pending_management", label: getPOStatusLabel("pending_management"), done: !["draft", "pending_review", "pending_estimate", "pending_accounting", "revision_needed"].includes(po.status) },
    { key: "approved", label: getPOStatusLabel("approved"), done: ["approved", "partial_purchase", "purchased", "received", "closed"].includes(po.status) },
    { key: "purchased", label: getPOStatusLabel("purchased"), done: ["purchased", "received", "closed"].includes(po.status) },
    { key: "received", label: getPOStatusLabel("received"), done: ["received", "closed"].includes(po.status) },
  ];

  const purchasedCount = visibleItems.filter((i: any) => ["purchased", "received"].includes(i.status)).length;
  const pendingCount = visibleItems.filter((i: any) => !["purchased", "received"].includes(i.status)).length;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/purchase-orders")}>
          <ArrowRight className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-mono text-muted-foreground">{po.poNumber}</span>
            <Badge className={PO_STATUS_COLORS[po.status] || "bg-gray-100 text-gray-700"}>{getPOStatusLabel(po.status)}</Badge>
          </div>
          <h1 className="text-xl font-bold mt-1">{t.purchaseOrders.title}</h1>
        </div>
        <div className="flex gap-2">
          {isDelegate && po.status === "pending_estimate" && (
            <Button variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setIsRevisionDialogOpen(true)}>
              <AlertCircle className="w-4 h-4 mr-1.5" /> {t.purchaseOrders.returnForRevision}
            </Button>
          )}
          {po.status !== "closed" && (isAdminOrOwner || po.requestedById === userId) && (
            <Button variant="outline" className="text-muted-foreground" onClick={() => { if (confirm("هل أنت متأكد من إغلاق هذا الطلب؟")) closeMut.mutate({ id: po.id }); }}>
              <XCircle className="w-4 h-4 mr-1.5" /> إغلاق الطلب
            </Button>
          )}
        </div>
      </div>

      {po.status === "revision_needed" && (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="p-4 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-rose-900">{t.purchaseOrders.resubmitDialogTitle}</h3>
                <p className="text-xs text-rose-700 mt-1">
                  {t.purchaseOrders.resubmitDialogDesc}
                </p>
              </div>
            </div>
            {(isAdminOrOwner || po.requestedById === userId) && (
              <div className="flex flex-col gap-2 border-t border-rose-200 pt-3">
                <Label className="text-xs text-rose-800">{t.purchaseOrders.resubmit} ({t.common.optionalNote})</Label>
                <div className="flex gap-2">
                  <Input 
                    placeholder="مثال: تم تعديل الكميات كما هو مطلوب..." 
                    value={resubmitNote} 
                    onChange={e => setResubmitNote(e.target.value)}
                    className="bg-white border-rose-200"
                  />
                  <Button 
                    onClick={() => resubmitMut.mutate({ id: po.id, note: resubmitNote })}
                    disabled={resubmitMut.isPending}
                    className="bg-rose-600 hover:bg-rose-700"
                  >
                    {resubmitMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
                    {t.purchaseOrders.resubmit}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-1 overflow-x-auto pb-1">
            {steps.map((step, i) => (
              <div key={step.key} className="flex items-center gap-1 flex-1 min-w-0">
                <div className={`flex items-center gap-1.5 shrink-0 ${step.done ? "text-primary" : "text-muted-foreground/40"}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    po.status === step.key ? "bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-1" :
                    step.done ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground/40"
                  }`}>
                    {step.done && po.status !== step.key ? "✓" : i + 1}
                  </div>
                  <span className="text-[10px] font-medium whitespace-nowrap hidden sm:inline">{step.label}</span>
                </div>
                {i < steps.length - 1 && <div className={`flex-1 h-0.5 mx-1 rounded ${step.done ? "bg-primary/40" : "bg-muted"}`} />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {po.ticketId && (
        <Card className="border-teal-200 bg-teal-50/50 cursor-pointer hover:bg-teal-50 transition-colors" onClick={() => setLocation(`/tickets/${po.ticketId}`)}>
          <CardContent className="p-3 flex items-center gap-3">
            <FileText className="w-4 h-4 text-teal-600 shrink-0" />
            <span className="text-sm font-medium text-teal-800">{t.purchaseOrders.relatedTicket} #{po.ticketId}</span>
            <ExternalLink className="w-3.5 h-3.5 text-teal-600 mr-auto" />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3 flex items-center gap-2.5">
          <User className="w-4 h-4 text-muted-foreground shrink-0" />
          <div><p className="text-[10px] text-muted-foreground">{t.purchaseOrders.requestedBy}</p><p className="text-sm font-medium">{requestedBy?.name || "-"}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-2.5">
          <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
          <div><p className="text-[10px] text-muted-foreground">{t.tickets.timeline}</p><p className="text-sm font-medium">{new Date(po.createdAt).toLocaleDateString(locale)}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-2.5">
          <Package className="w-4 h-4 text-muted-foreground shrink-0" />
          <div><p className="text-[10px] text-muted-foreground">{t.purchaseOrders.items}</p><p className="text-sm font-medium">{visibleItems.length}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-2.5">
          <ShoppingCart className="w-4 h-4 text-muted-foreground shrink-0" />
          <div><p className="text-[10px] text-muted-foreground">{t.purchaseOrders.confirmPurchase}</p><p className="text-sm font-medium">{purchasedCount} / {visibleItems.length}</p></div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingCart className="w-4 h-4" />
            {t.purchaseOrders.items}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {visibleItems.map((item: any) => {
            const delegate = users?.find((u: any) => u.id === item.delegateId);
            // Admin/owner can act on all items; delegate only sees their own
            const isMyItem = isAdminOrOwner || (isDelegate && item.delegateId === userId);

            return (
              <div key={item.id} className="border rounded-xl p-4 space-y-3 hover:border-primary/20 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h4 className="font-medium text-sm">{item.itemName}</h4>
                      <Badge className={`text-[10px] ${ITEM_STATUS_COLORS[item.status] || "bg-gray-100 text-gray-700"}`}>
                        {getPOItemStatusLabel(item.status)}
                      </Badge>
                    </div>
                    {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                    <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground flex-wrap">
                      <span>{t.purchaseOrders.quantity}: <strong>{item.quantity} {item.unit || ""}</strong></span>
                      {delegate && <span>{t.purchaseOrders.delegate}: <strong>{delegate.name}</strong></span>}
                    </div>
                    {item.notes && <p className="text-xs text-muted-foreground mt-1.5 bg-muted/50 rounded-lg p-2">{item.notes}</p>}
                  </div>
                  {item.photoUrl && <img src={item.photoUrl} alt="" className="w-16 h-16 rounded-lg object-cover border shrink-0" />}
                  {/* Edit button - only for editable statuses */}
                  {po && ['draft', 'pending_estimate', 'pending_accounting'].includes(po.status) && ['pending', 'estimated'].includes(item.status) && (
                    <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => {
                      setEditingItem(item);
                      setEditForm({ itemName: item.itemName, description: item.description || "", quantity: item.quantity, estimatedUnitCost: item.estimatedUnitCost || "" });
                    }}>
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>

                {(item.estimatedUnitCost || item.actualUnitCost) && (
                  <div className="bg-muted/30 rounded-lg p-2.5 space-y-1">
                    {item.estimatedUnitCost && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{t.purchaseOrders.totalEstimated}:</span>
                        <span className="font-medium">{Number(item.estimatedUnitCost).toLocaleString(locale)} {currency} × {item.quantity} = <strong>{parseFloat(item.estimatedTotalCost || "0").toLocaleString(locale)} {currency}</strong></span>
                      </div>
                    )}
                    {item.actualUnitCost && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-emerald-600">{t.purchaseOrders.totalActual}:</span>
                        <span className="font-medium text-emerald-700">{Number(item.actualUnitCost).toLocaleString(locale)} {currency} × {item.quantity} = <strong>{parseFloat(item.actualTotalCost || "0").toLocaleString(locale)} {currency}</strong></span>
                      </div>
                    )}
                    {item.supplierName && (
                      <div className="flex items-center justify-between text-xs pt-1 border-t border-muted">
                        <span className="text-muted-foreground">{t.purchaseOrders.supplier}:</span>
                        <span className="font-medium">{item.supplierName}</span>
                      </div>
                    )}
                  </div>
                )}

                {(item.invoicePhotoUrl || item.purchasedPhotoUrl) && (
                  <div className="flex gap-3 border-t pt-2">
                    {item.invoicePhotoUrl && (
                      <a href={mediaUrl(item.invoicePhotoUrl)} target="_blank" rel="noopener" className="group">
                        <p className="text-[10px] text-muted-foreground mb-1">{t.purchaseOrders.accountingNotes}</p>
                        <img src={mediaUrl(item.invoicePhotoUrl)} className="w-20 h-20 rounded-lg object-cover border group-hover:ring-2 ring-primary/30 transition-all" />
                      </a>
                    )}
                    {item.purchasedPhotoUrl && (
                      <a href={mediaUrl(item.purchasedPhotoUrl)} target="_blank" rel="noopener" className="group">
                        <p className="text-[10px] text-muted-foreground mb-1">{t.tickets.photos}</p>
                        <img src={mediaUrl(item.purchasedPhotoUrl)} className="w-20 h-20 rounded-lg object-cover border group-hover:ring-2 ring-primary/30 transition-all" />
                      </a>
                    )}
                  </div>
                )}

                {isMyItem && item.status === "pending" && po.status === "pending_estimate" && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                    <p className="text-xs font-medium text-amber-800 flex items-center gap-1.5">
                      <DollarSign className="w-3.5 h-3.5" /> {t.purchaseOrders.estimatedUnitCost}:
                    </p>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1 space-y-1">
                        <Label className="text-[11px] text-amber-700">{t.purchaseOrders.estimatedUnitCost} ({currency})</Label>
                        <Input type="number" placeholder="0.00" value={estimates[item.id] || ""} onChange={e => setEstimates(p => ({ ...p, [item.id]: e.target.value }))} className="bg-white" />
                      </div>
                      {estimates[item.id] && parseFloat(estimates[item.id]) > 0 && (
                        <div className="text-xs text-amber-700 pb-2">
                          = {(parseFloat(estimates[item.id]) * item.quantity).toLocaleString(locale)} {currency}
                        </div>
                      )}
                      <Button size="sm" onClick={() => {
                        if (!estimates[item.id] || parseFloat(estimates[item.id]) <= 0) { toast.error(t.purchaseOrders.estimatedUnitCost); return; }
                        estimateMut.mutate({ purchaseOrderId: po.id, items: [{ id: item.id, estimatedUnitCost: estimates[item.id] }] });
                      }} disabled={estimateMut.isPending} className="shrink-0">
                        {estimateMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : t.common.save}
                      </Button>
                    </div>
                  </div>
                )}

                {isMyItem && item.status === "approved" && ["approved", "partial_purchase"].includes(po.status) && (
                  <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 space-y-3">
                    <p className="text-xs font-medium text-teal-800 flex items-center gap-1.5">
                      <ShoppingCart className="w-3.5 h-3.5" /> {t.purchaseOrders.confirmPurchase}:
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-[11px] text-teal-700">{t.purchaseOrders.accountingNotes}</Label>
                        {itemPhotos[item.id]?.invoice ? (
                          <div className="relative mt-1">
                            <img src={itemPhotos[item.id]!.invoice} alt="" className="w-full h-20 rounded-lg object-cover border" />
                            <Button variant="destructive" size="icon" className="absolute top-1 left-1 h-5 w-5 rounded-full" onClick={() => { setItemPhotos(p => ({ ...p, [item.id]: { ...p[item.id], invoice: undefined } })); setDropZoneFor(null); }}>
                              <XCircle className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : dropZoneFor === `${item.id}-invoice` ? (
                          <DropZone
                            maxFiles={1}
                            accept="image/*,application/pdf"
                            label="اسحب صورة الفاتورة"
                            sublabel="صورة أو PDF"
                            onFilesUploaded={(files: UploadedFile[]) => {
                              const done = files.find(f => f.status === "done" && f.url);
                              if (done?.url) { setItemPhotos(p => ({ ...p, [item.id]: { ...p[item.id], invoice: done.url } })); setDropZoneFor(null); }
                            }}
                          />
                        ) : (
                          <div className="flex gap-1 mt-1">
                            <Button variant="outline" size="sm" className="flex-1 h-20 border-dashed gap-1" onClick={() => {
                              const input = document.createElement("input");
                              input.type = "file"; input.accept = "image/*";
                              input.onchange = (e: any) => { if (e.target.files[0]) handleUpload(e.target.files[0], item.id, "invoice"); };
                              input.click();
                            }} disabled={uploadingItem === `${item.id}-invoice`}>
                              {uploadingItem === `${item.id}-invoice` ? <Loader2 className="w-4 h-4 animate-spin" /> : <><FileText className="w-4 h-4" /><span className="text-[10px]">{t.common.upload}</span></>}
                            </Button>
                            <Button variant="outline" size="sm" className="h-20 px-2 border-dashed" onClick={() => setDropZoneFor(`${item.id}-invoice`)} title="سحب وإفلات">
                              <Upload className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <div>
                        <Label className="text-[11px] text-teal-700">{t.tickets.photos}</Label>
                        {itemPhotos[item.id]?.purchased ? (
                          <div className="relative mt-1">
                            <img src={itemPhotos[item.id]!.purchased} alt="" className="w-full h-20 rounded-lg object-cover border" />
                            <Button variant="destructive" size="icon" className="absolute top-1 left-1 h-5 w-5 rounded-full" onClick={() => { setItemPhotos(p => ({ ...p, [item.id]: { ...p[item.id], purchased: undefined } })); setDropZoneFor(null); }}>
                              <XCircle className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : dropZoneFor === `${item.id}-purchased` ? (
                          <DropZone
                            maxFiles={1}
                            accept="image/*"
                            label="اسحب صورة الصنف"
                            sublabel="صورة واحدة"
                            onFilesUploaded={(files: UploadedFile[]) => {
                              const done = files.find(f => f.status === "done" && f.url);
                              if (done?.url) { setItemPhotos(p => ({ ...p, [item.id]: { ...p[item.id], purchased: done.url } })); setDropZoneFor(null); }
                            }}
                          />
                        ) : (
                          <div className="flex gap-1 mt-1">
                            <Button variant="outline" size="sm" className="flex-1 h-20 border-dashed gap-1" onClick={() => {
                              const input = document.createElement("input");
                              input.type = "file"; input.accept = "image/*";
                              input.onchange = (e: any) => { if (e.target.files[0]) handleUpload(e.target.files[0], item.id, "purchased"); };
                              input.click();
                            }} disabled={uploadingItem === `${item.id}-purchased`}>
                              {uploadingItem === `${item.id}-purchased` ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Camera className="w-4 h-4" /><span className="text-[10px]">{t.common.upload}</span></>}
                            </Button>
                            <Button variant="outline" size="sm" className="h-20 px-2 border-dashed" onClick={() => setDropZoneFor(`${item.id}-purchased`)} title="سحب وإفلات">
                              <Upload className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                    <Button size="sm" className="w-full gap-1.5" onClick={() => {
                      confirmPurchaseMut.mutate({
                        itemId: item.id,
                        invoicePhotoUrl: itemPhotos[item.id]?.invoice || "",
                        purchasedPhotoUrl: itemPhotos[item.id]?.purchased || "",
                      });
                    }} disabled={confirmPurchaseMut.isPending}>
                      {confirmPurchaseMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      {t.purchaseOrders.confirmPurchase}
                    </Button>
                  </div>
                )}

                {isWarehouse && item.status === "purchased" && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-3">
                    <p className="text-xs font-medium text-green-800 flex items-center gap-1.5">
                      <Package className="w-3.5 h-3.5" /> {t.purchaseOrders.receiveItem}:
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-green-700">{t.purchaseOrders.actualUnitCost} ({currency}) *</Label>
                        <Input type="number" className="bg-white" value={receiveData[item.id]?.cost || ""} onChange={e => setReceiveData(p => ({ ...p, [item.id]: { ...p[item.id], cost: e.target.value, supplier: p[item.id]?.supplier || "", supplierItemName: p[item.id]?.supplierItemName || "", warehousePhotoUrl: p[item.id]?.warehousePhotoUrl || "" } }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-green-700">{t.purchaseOrders.supplier} *</Label>
                        <Input className="bg-white" value={receiveData[item.id]?.supplier || ""} onChange={e => setReceiveData(p => ({ ...p, [item.id]: { ...p[item.id], cost: p[item.id]?.cost || "", supplier: e.target.value, supplierItemName: p[item.id]?.supplierItemName || "", warehousePhotoUrl: p[item.id]?.warehousePhotoUrl || "" } }))} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-green-700">اسم الصنف كما في الفاتورة (اختياري)</Label>
                      <Input className="bg-white" placeholder={item.name} value={receiveData[item.id]?.supplierItemName || ""} onChange={e => setReceiveData(p => ({ ...p, [item.id]: { ...p[item.id], cost: p[item.id]?.cost || "", supplier: p[item.id]?.supplier || "", supplierItemName: e.target.value, warehousePhotoUrl: p[item.id]?.warehousePhotoUrl || "" } }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-green-700">صورة تأكيد الاستلام *</Label>
                      {itemPhotos[item.id]?.warehouse ? (
                        <div className="relative mt-1">
                          <img src={itemPhotos[item.id]!.warehouse} alt="" className="w-full h-20 rounded-lg object-cover border border-green-300" />
                          <Button variant="destructive" size="icon" className="absolute top-1 left-1 h-5 w-5 rounded-full" onClick={() => {
                            setItemPhotos(p => ({ ...p, [item.id]: { ...p[item.id], warehouse: undefined } }));
                            setReceiveData(p => ({ ...p, [item.id]: { ...p[item.id], warehousePhotoUrl: "" } }));
                            setDropZoneFor(null);
                          }}>
                            <XCircle className="w-3 h-3" />
                          </Button>
                        </div>
                      ) : dropZoneFor === `${item.id}-warehouse` ? (
                        <DropZone
                          maxFiles={1}
                          accept="image/*"
                          label="اسحب صورة الاستلام"
                          sublabel="صورة واحدة"
                          onFilesUploaded={(files: UploadedFile[]) => {
                            const done = files.find(f => f.status === "done" && f.url);
                            if (done?.url) {
                              setItemPhotos(p => ({ ...p, [item.id]: { ...p[item.id], warehouse: done.url } }));
                              setReceiveData(p => ({ ...p, [item.id]: { ...p[item.id], warehousePhotoUrl: done.url! } }));
                              setDropZoneFor(null);
                            }
                          }}
                        />
                      ) : (
                        <div className="flex gap-1 mt-1">
                          <Button variant="outline" size="sm" className="flex-1 h-20 border-dashed gap-1 border-green-300 text-green-700" onClick={() => {
                            const input = document.createElement("input");
                            input.type = "file"; input.accept = "image/*";
                            input.onchange = async (e: any) => {
                              if (e.target.files[0]) {
                                const url = await handleUpload(e.target.files[0], item.id, "warehouse");
                                if (url) setReceiveData(p => ({ ...p, [item.id]: { ...p[item.id], warehousePhotoUrl: url } }));
                              }
                            };
                            input.click();
                          }} disabled={uploadingItem === `${item.id}-warehouse`}>
                            {uploadingItem === `${item.id}-warehouse` ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Camera className="w-4 h-4" /><span className="text-[10px]">التقط صورة</span></>}
                          </Button>
                          <Button variant="outline" size="sm" className="h-20 px-2 border-dashed border-green-300" onClick={() => setDropZoneFor(`${item.id}-warehouse`)} title="سحب وإفلات">
                            <Upload className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <Button size="sm" className="w-full gap-1.5" onClick={() => {
                      const d = receiveData[item.id];
                      if (!d?.cost || !d?.supplier) { toast.error(t.purchaseOrders.supplier); return; }
                      if (!d?.warehousePhotoUrl) { toast.error("صورة الصنف مطلوبة"); return; }
                      receiveItemMut.mutate({ itemId: item.id, actualUnitCost: d.cost, supplierName: d.supplier, supplierItemName: d.supplierItemName, warehousePhotoUrl: d.warehousePhotoUrl });
                    }} disabled={receiveItemMut.isPending}>
                      {receiveItemMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
                      {t.purchaseOrders.receiveItem}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-5 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <DollarSign className="w-4 h-4" /> {t.purchaseOrders.totalEstimated}
          </h3>
          {totalEstimated > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t.purchaseOrders.totalEstimated}:</span>
                <span className="font-bold text-lg">{totalEstimated.toLocaleString(locale)} {currency}</span>
              </div>
              <p className="text-xs text-muted-foreground text-left">({numberToArabicWords(totalEstimated)})</p>
            </div>
          )}
          {totalActual > 0 && (
            <div className="space-y-1 pt-3 border-t">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t.purchaseOrders.totalActual}:</span>
                <span className="font-bold text-lg text-emerald-700">{totalActual.toLocaleString(locale)} {currency}</span>
              </div>
              <p className="text-xs text-emerald-600 text-left">({numberToArabicWords(totalActual)})</p>
            </div>
          )}
          {totalEstimated > 0 && totalActual > 0 && (
            <div className="pt-3 border-t">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t.reports.comparison}:</span>
                <span className={totalActual > totalEstimated ? "text-red-600 font-semibold" : "text-emerald-600 font-semibold"}>
                  {totalActual > totalEstimated ? "+" : "-"}{Math.abs(totalActual - totalEstimated).toLocaleString(locale)} {currency}
                  ({totalEstimated > 0 ? ((Math.abs(totalActual - totalEstimated) / totalEstimated) * 100).toFixed(1) : 0}%)
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {isManager && po.status === "pending_review" && (() => {
        const delegates = users?.filter((u: any) => u.role === "delegate") || [];
        const allDecided = po.items?.every((item: any) => reviewDecisions[item.id]?.action) || false;
        const isValid = po.items?.every((item: any) => {
          const d = reviewDecisions[item.id];
          if (!d) return false;
          if (d.action === "approve") return !!d.delegateId;
          if (d.action === "reject") return !!(d.rejectionReason?.trim());
          return false;
        }) || false;
        return (
          <Card className="border-purple-200 bg-purple-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-purple-800">مراجعة الأصناف وتعيين المندوبين</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {po.items?.map((item: any) => {
                const decision = reviewDecisions[item.id] || {};
                return (
                  <div key={item.id} className="border rounded-lg p-3 space-y-3 bg-white">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{item.itemName}</p>
                        {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                        <p className="text-xs text-muted-foreground mt-0.5">{t.purchaseOrders.quantity}: <strong>{item.quantity} {item.unit || ""}</strong></p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Button
                        size="sm"
                        variant={decision.action === "approve" ? "default" : "outline"}
                        className="flex-1"
                        onClick={() => setReviewDecisions(p => ({ ...p, [item.id]: { ...p[item.id], action: "approve" } }))}
                      >
                        {t.common.confirm}
                      </Button>
                      <Button
                        size="sm"
                        variant={decision.action === "reject" ? "destructive" : "outline"}
                        className="flex-1"
                        onClick={() => setReviewDecisions(p => ({ ...p, [item.id]: { ...p[item.id], action: "reject" } }))}
                      >
                        {t.tickets.reject}
                      </Button>
                    </div>
                    {decision.action === "approve" && (
                      <div className="space-y-1">
                        <Label className="text-xs">{t.purchaseOrders.delegate} *</Label>
                        <Select
                          value={decision.delegateId ? String(decision.delegateId) : ""}
                          onValueChange={v => setReviewDecisions(p => ({ ...p, [item.id]: { ...p[item.id], delegateId: parseInt(v) } }))}
                        >
                          <SelectTrigger className="bg-white"><SelectValue placeholder={t.purchaseOrders.delegate} /></SelectTrigger>
                          <SelectContent>
                            {delegates.map((d: any) => <SelectItem key={d.id} value={String(d.id)}>{d.name || d.email}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {decision.action === "reject" && (
                      <div className="space-y-1">
                        <Label className="text-xs">{t.purchaseOrders.justification} *</Label>
                        <Input
                          placeholder="سبب الرفض"
                          value={decision.rejectionReason || ""}
                          onChange={e => setReviewDecisions(p => ({ ...p, [item.id]: { ...p[item.id], rejectionReason: e.target.value } }))}
                          className="bg-white"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              <Button
                className="w-full gap-1.5"
                disabled={!allDecided || !isValid || reviewItemsMut.isPending}
                onClick={() => {
                  const items = (po.items || []).map((item: any) => {
                    const d = reviewDecisions[item.id];
                    return {
                      id: item.id,
                      action: d.action as "approve" | "reject",
                      delegateId: d.action === "approve" ? d.delegateId : undefined,
                      rejectionReason: d.action === "reject" ? d.rejectionReason : undefined,
                    };
                  });
                  reviewItemsMut.mutate({ poId: po.id, items });
                }}
              >
                {reviewItemsMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {t.common.submit}
              </Button>
            </CardContent>
          </Card>
        );
      })()}

      {isAccountant && po.status === "pending_accounting" && (
        <Card className="border-orange-200 bg-orange-50/50">
          <CardHeader className="pb-2"><CardTitle className="text-base text-orange-800">{t.purchaseOrders.accountingApproval}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-orange-800">مبلغ العهدة المُصرف للمندوب (ر.س.) - اختياري</label>
              <Input type="number" placeholder="مثال: 500" value={custodyAmount} onChange={e => setCustodyAmount(e.target.value)} className="bg-white" />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => approveAccMut.mutate({ id: po.id, custodyAmount: custodyAmount || undefined })} disabled={approveAccMut.isPending} className="flex-1 gap-1.5">
                {approveAccMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {t.common.confirm}
              </Button>
              <Button variant="destructive" onClick={() => {
                if (!rejectReason.trim()) { toast.error(t.purchaseOrders.justification); return; }
                rejectMut.mutate({ id: po.id, reason: rejectReason });
              }} disabled={rejectMut.isPending} className="gap-1">
                <XCircle className="w-4 h-4" /> {t.tickets.reject}
              </Button>
            </div>
            <Input placeholder={t.purchaseOrders.justification} value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          </CardContent>
        </Card>
      )}

      {isManagement && po.status === "pending_management" && (
        <Card className="border-orange-200 bg-orange-50/50">
          <CardHeader className="pb-2"><CardTitle className="text-base text-orange-800">{t.purchaseOrders.managementApproval}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Button onClick={() => approveMgmtMut.mutate({ id: po.id })} disabled={approveMgmtMut.isPending} className="flex-1 gap-1.5">
                {approveMgmtMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {t.common.confirm}
              </Button>
              <Button variant="destructive" onClick={() => {
                if (!rejectReason.trim()) { toast.error(t.purchaseOrders.justification); return; }
                rejectMut.mutate({ id: po.id, reason: rejectReason });
              }} disabled={rejectMut.isPending} className="gap-1">
                <XCircle className="w-4 h-4" /> {t.tickets.reject}
              </Button>
            </div>
            <Input placeholder={t.purchaseOrders.justification} value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          </CardContent>
        </Card>
      )}

      {po.custodyAmount && !isWarehouse && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <span className="text-amber-700 text-sm font-bold">ع</span>
            </div>
            <div>
              <p className="text-xs text-amber-700 font-medium">مبلغ العهدة المُصرف للمندوب</p>
              <p className="text-lg font-bold text-amber-800">{Number(po.custodyAmount).toLocaleString("ar-SA")} ر.س.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {po.notes && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">{t.purchaseOrders.justification}:</p>
            <p className="text-sm">{po.notes}</p>
          </CardContent>
        </Card>
      )}

      {po.comments && po.comments.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              سجل الملاحظات والتعديلات
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {po.comments.map((comment: any) => (
                <div key={comment.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold">{comment.userName}</span>
                      <Badge variant="outline" className="text-[10px] py-0 h-4">{comment.userRole}</Badge>
                      {comment.actionType === "return_for_revision" && <Badge className="bg-rose-100 text-rose-700 text-[10px] py-0 h-4">طلب مراجعة</Badge>}
                      {comment.actionType === "resubmitted" && <Badge className="bg-blue-100 text-blue-700 text-[10px] py-0 h-4">إعادة تقديم</Badge>}
                    </div>
                    <span className="text-[10px] text-muted-foreground">{new Date(comment.createdAt).toLocaleString(locale)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground bg-muted/30 p-2 rounded-lg border-l-2 border-primary/20">
                    {comment.note}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={isRevisionDialogOpen} onOpenChange={setIsRevisionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.purchaseOrders.revisionDialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {t.purchaseOrders.revisionDialogDesc}
            </p>
            <div className="space-y-2">
              <Label>{t.purchaseOrders.revisionReason} *</Label>
              <Textarea 
                placeholder="مثال: يرجى تعديل الكمية في الصنف الأول لتكون 5 بدلاً من 10..." 
                value={revisionNote}
                onChange={e => setRevisionNote(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRevisionDialogOpen(false)}>{t.common.cancel}</Button>
            <Button 
              variant="destructive" 
              disabled={revisionNote.length < 5 || requestRevisionMut.isPending}
              onClick={() => requestRevisionMut.mutate({ id: po.id, note: revisionNote })}
            >
              {requestRevisionMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t.purchaseOrders.returnForRevision}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Item Dialog */}
      <Dialog open={!!editingItem} onOpenChange={(open) => { if (!open) setEditingItem(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4" />
              {t.common.edit} - {editingItem?.itemName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t.purchaseOrders.itemName}</Label>
              <Input value={editForm.itemName} onChange={e => setEditForm(p => ({ ...p, itemName: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>{t.common.description}</Label>
              <Textarea value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t.purchaseOrders.quantity}</Label>
                <Input type="number" min={1} value={editForm.quantity} onChange={e => setEditForm(p => ({ ...p, quantity: parseInt(e.target.value) || 1 }))} />
              </div>
              <div className="space-y-2">
                <Label>{t.purchaseOrders.estimatedUnitCost}</Label>
                <Input type="number" step="0.01" value={editForm.estimatedUnitCost} onChange={e => setEditForm(p => ({ ...p, estimatedUnitCost: e.target.value }))} placeholder="0.00" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingItem(null)}>{t.common.cancel}</Button>
            <Button onClick={() => {
              if (!editingItem) return;
              editItemMut.mutate({
                id: editingItem.id,
                purchaseOrderId: po.id,
                itemName: editForm.itemName,
                description: editForm.description,
                quantity: editForm.quantity,
                estimatedUnitCost: editForm.estimatedUnitCost || undefined,
              });
            }} disabled={editItemMut.isPending}>
              {editItemMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
