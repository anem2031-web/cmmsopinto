import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Plus, ShoppingCart, Trash2, User, Package, Search } from "lucide-react";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/contexts/LanguageContext";
import { useStaticLabels } from "@/hooks/useContentTranslation";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { ExportButton } from "@/components/common/ExportButton";

const PO_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_estimate: "bg-amber-100 text-amber-700",
  pending_accounting: "bg-orange-100 text-orange-700",
  pending_management: "bg-orange-100 text-orange-700",
  approved: "bg-teal-100 text-teal-700",
  partial_purchase: "bg-cyan-100 text-cyan-700",
  purchased: "bg-emerald-100 text-emerald-700",
  received: "bg-green-100 text-green-700",
  closed: "bg-gray-100 text-gray-700",
  rejected: "bg-red-100 text-red-700",
};

// الأدوار التي تملك صلاحية رؤية فلتر المستخدم
const FULL_ACCESS_ROLES = ["owner", "admin", "maintenance_manager", "purchase_manager", "senior_management", "executive_director", "accountant"];

export default function PurchaseOrders() {
  const [, setLocation] = useLocation();
  const { t, language } = useTranslation();
  const { getPOStatusLabel } = useStaticLabels();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  // فلاتر
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [requestedById, setRequestedById] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const canDelete = user && ["owner", "admin"].includes(user.role);
  const canFilterByUser = user && FULL_ACCESS_ROLES.includes(user.role);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<any>(null);

  // جلب قائمة المستخدمين للفلتر (فقط للأدوار الكاملة الصلاحيات)
  const { data: allUsers = [] } = trpc.users.list.useQuery(undefined, {
    enabled: !!canFilterByUser,
  });

  // بناء الفلاتر المُرسلة للسيرفر
  const queryInput = {
    ...(statusFilter !== "all" && { status: statusFilter }),
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
    ...(canFilterByUser && requestedById !== "all" && { requestedById: Number(requestedById) }),
  };

  const { data: pos, isLoading } = trpc.purchaseOrders.list.useQuery(
    Object.keys(queryInput).length > 0 ? queryInput : undefined
  );

  const deleteMutation = trpc.purchaseOrders.delete.useMutation({
    onSuccess: () => {
      toast.success(t.common.deletedSuccessfully);
      utils.purchaseOrders.list.invalidate();
      setDeleteOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const openDelete = (po: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedPO(po);
    setDeleteOpen(true);
  };

  const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";
  const currency = t.common.currency;

  // البحث الديناميكي: رقم الطلب، اسم المنشئ، عدد الأصناف، أسماء الأصناف (مترجمة)، الحالة، الملاحظات، التاريخ
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredPos = (pos ?? []).filter((po: any) => {
    if (!normalizedSearch) return true;
    // اختر الأسماء بلغة المستخدم الحالية، وإلا ارجع للأصلية
    const localizedNames: string[] =
      language === "en" && (po.itemNames_en ?? []).length > 0 ? po.itemNames_en :
      language === "ur" && (po.itemNames_ur ?? []).length > 0 ? po.itemNames_ur :
      language === "ar" && (po.itemNames_ar ?? []).length > 0 ? po.itemNames_ar :
      (po.itemNames ?? []);
    const haystack: string[] = [
      po.poNumber,
      po.requestedByName,
      String(po.itemCount ?? ""),
      ...localizedNames,
      ...(po.itemNames ?? []), // أضف الأصلي دائماً للبحث الشامل
      getPOStatusLabel(po.status),
      po.notes,
      po.totalEstimatedCost != null ? String(po.totalEstimatedCost) : "",
      po.totalActualCost != null ? String(po.totalActualCost) : "",
      po.createdAt ? new Date(po.createdAt).toLocaleDateString(locale) : "",
    ].filter(Boolean).map(String);
    return haystack.some(field => field.toLowerCase().includes(normalizedSearch));
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.purchaseOrders.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.purchaseOrders.justification}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <ExportButton endpoint="purchase-orders" filename="purchase-orders" />
          <Button onClick={() => setLocation("/purchase-orders/new")} className="gap-2">
            <Plus className="w-4 h-4" /> {t.purchaseOrders.createNew}
          </Button>
        </div>
      </div>

      {/* خانة البحث الديناميكية */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t.common.searchPlaceholder}
          className="pr-9 max-w-md"
        />
      </div>

      {/* شريط الفلترة */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* فلتر الحالة */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t.common.status}</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder={t.common.status} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.common.all}</SelectItem>
              {Object.keys(t.poStatus).map(k => <SelectItem key={k} value={k}>{getPOStatusLabel(k)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* فلتر من تاريخ */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t.common.fromDate}</span>
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-[160px]"
          />
        </div>

        {/* فلتر إلى تاريخ */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t.common.toDate}</span>
          <Input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-[160px]"
          />
        </div>

        {/* فلتر المنشئ — فقط للأدوار الكاملة الصلاحيات */}
        {canFilterByUser && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t.common.createdBy}</span>
            <Select value={requestedById} onValueChange={setRequestedById}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder={t.common.all} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.common.all}</SelectItem>
                {allUsers.map((u: any) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.name || u.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* زر مسح الفلاتر */}
        {(statusFilter !== "all" || dateFrom || dateTo || requestedById !== "all" || searchQuery) && (
          <Button
            variant="ghost"
            size="sm"
            className="self-end text-muted-foreground"
            onClick={() => {
              setStatusFilter("all");
              setDateFrom("");
              setDateTo("");
              setRequestedById("all");
              setSearchQuery("");
            }}
          >
            {t.common.clearFilters}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>)}</div>
      ) : !filteredPos?.length ? (
        <Card><CardContent className="p-12 text-center">
          <ShoppingCart className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="font-semibold text-lg mb-1">{t.purchaseOrders.noPOs}</h3>
          <p className="text-sm text-muted-foreground">{t.common.noData}</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filteredPos.map(po => (
            <Card key={po.id} className="hover:shadow-lg hover:border-primary/20 transition-all duration-200 cursor-pointer" onClick={() => setLocation(`/purchase-orders/${po.id}`)}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-muted-foreground">{po.poNumber}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
                      {/* منشئ الطلب */}
                      {po.requestedByName && (
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {po.requestedByName}
                        </span>
                      )}
                      {/* عدد الأصناف */}
                      <span className="flex items-center gap-1">
                        <Package className="w-3 h-3" />
                        {(po as any).itemCount ?? 0} {t.purchaseOrders.items}
                      </span>
                      {po.totalEstimatedCost && <span>{t.purchaseOrders.totalEstimated}: {Number(po.totalEstimatedCost).toLocaleString(locale)} {currency}</span>}
                      {po.totalActualCost && <span>{t.purchaseOrders.totalActual}: {Number(po.totalActualCost).toLocaleString(locale)} {currency}</span>}
                      <span>
                        {new Date(po.createdAt).toLocaleDateString(locale)}
                        {((po as any).delegateCount ?? 0) > 1 && <span className="text-amber-600 font-medium"> - متعدد</span>}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canDelete && !["funded", "partially_purchased", "completed"].includes(po.status) && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={(e) => openDelete(po, e)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                    <Badge className={`status-badge ${PO_STATUS_COLORS[po.status] || "bg-gray-100 text-gray-700"}`}>
                      {getPOStatusLabel(po.status)}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t.common.confirmDelete}</DialogTitle>
            <DialogDescription>
              {t.common.deleteWarning} <strong>{selectedPO?.poNumber}</strong>? {t.common.cannotUndo}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t.common.cancel}</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate({ id: selectedPO.id })} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? t.common.deleting : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
