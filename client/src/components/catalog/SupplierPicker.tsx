import { useState, useMemo, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  Plus,
  X,
  Star,
  StarOff,
  Truck,
  Loader2,
  Building2,
  Factory,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────
interface Supplier {
  id: number;
  nameAr: string;
  nameEn: string;
  phone: string | null;
  country: string | null;
  isManufacturer: boolean;
}

interface ItemSupplierLink {
  id: number;
  supplierId: number;
  supplierNameAr: string;
  supplierNameEn: string;
  supplierPhone: string | null;
  supplierCountry: string | null;
  supplierItemCode: string | null;
  price: string;
  currency: string;
  isPreferred: boolean;
  notes: string | null;
}

interface SupplierPickerProps {
  itemId: number;
}

// ── Main Component ─────────────────────────────────────────────────────────
export function SupplierPickerSection({ itemId }: SupplierPickerProps) {
  const [showSearch, setShowSearch] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [assignForm, setAssignForm] = useState({
    price: "",
    currency: "SAR",
    supplierItemCode: "",
    notes: "",
    isPreferred: false,
  });

  const {
    data: linkedSuppliers,
    isLoading: linkedLoading,
    refetch: refetchLinked,
  } = trpc.catalog.itemSuppliers.listByItem.useQuery(itemId, {
    enabled: !!itemId,
  });

  const assignMut = trpc.catalog.itemSuppliers.assign.useMutation({
    onSuccess: () => {
      refetchLinked();
      setShowAssignDialog(false);
      setSelectedSupplier(null);
      setAssignForm({ price: "", currency: "SAR", supplierItemCode: "", notes: "", isPreferred: false });
      toast.success("تم ربط المورد بالصنف");
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMut = trpc.catalog.itemSuppliers.remove.useMutation({
    onSuccess: () => {
      refetchLinked();
      toast.success("تم إزالة المورد");
    },
    onError: (e) => toast.error(e.message),
  });

  const setPreferredMut = trpc.catalog.itemSuppliers.setPreferred.useMutation({
    onSuccess: () => {
      refetchLinked();
      toast.success("تم تعيين المورد الأساسي");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSelectSupplier = (s: Supplier) => {
    setSelectedSupplier(s);
    setShowSearch(false);
    setShowAssignDialog(true);
  };

  const handleAssign = async () => {
    if (!selectedSupplier) return;
    if (!assignForm.price || isNaN(Number(assignForm.price))) {
      toast.error("يجب إدخال السعر");
      return;
    }

    await assignMut.mutateAsync({
      itemId,
      supplierId:       selectedSupplier.id,
      price:            Number(assignForm.price),
      currency:         assignForm.currency,
      supplierItemCode: assignForm.supplierItemCode || undefined,
      notes:            assignForm.notes || undefined,
      isPreferred:      assignForm.isPreferred,
    });
  };

  const handleRemove = (link: ItemSupplierLink) => {
    if (confirm(`إزالة المورد "${link.supplierNameAr}" من هذا الصنف؟`)) {
      removeMut.mutate({ itemId, supplierId: link.supplierId });
    }
  };

  return (
    <div className="space-y-3">
      {/* Section Title */}
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <Truck className="w-3.5 h-3.5 text-muted-foreground" />
          الموردون المرتبطون
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 h-7 text-xs"
          onClick={() => setShowSearch(true)}
        >
          <Plus className="w-3 h-3" />
          إضافة مورد
        </Button>
      </div>

      {/* Linked Suppliers List */}
      {linkedLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : linkedSuppliers && linkedSuppliers.length > 0 ? (
        <div className="space-y-2">
          {linkedSuppliers.map((link: ItemSupplierLink) => (
            <LinkedSupplierRow
              key={link.supplierId}
              link={link}
              onRemove={handleRemove}
              onSetPreferred={() =>
                setPreferredMut.mutate({ itemId, supplierId: link.supplierId })
              }
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-dashed text-xs text-muted-foreground">
          <Truck className="w-3.5 h-3.5 shrink-0 opacity-50" />
          لم يُربط بعد أي مورد بهذا الصنف
        </div>
      )}

      {/* Search Dialog */}
      <SupplierSearchDialog
        open={showSearch}
        onClose={() => setShowSearch(false)}
        onSelect={handleSelectSupplier}
        alreadyLinked={linkedSuppliers?.map((l: ItemSupplierLink) => l.supplierId) ?? []}
      />

      {/* Assign Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={(open) => { if (!open) { setShowAssignDialog(false); setSelectedSupplier(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              ربط المورد بالصنف
            </DialogTitle>
          </DialogHeader>

          {selectedSupplier && (
            <div className="space-y-4 pt-1">
              {/* Supplier Info */}
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 border">
                <div className="p-1.5 rounded bg-primary/10">
                  {selectedSupplier.isManufacturer
                    ? <Factory className="w-4 h-4 text-primary" />
                    : <Building2 className="w-4 h-4 text-primary" />}
                </div>
                <div>
                  <p className="text-sm font-medium">{selectedSupplier.nameAr}</p>
                  <p className="text-xs text-muted-foreground">{selectedSupplier.nameEn}</p>
                </div>
              </div>

              {/* Price */}
              <div className="space-y-1">
                <label className="text-sm font-medium">السعر *</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={assignForm.price}
                    onChange={(e) => setAssignForm({ ...assignForm, price: e.target.value })}
                    placeholder="0.00"
                    dir="ltr"
                    className="flex-1"
                  />
                  <select
                    value={assignForm.currency}
                    onChange={(e) => setAssignForm({ ...assignForm, currency: e.target.value })}
                    className="px-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary w-24"
                  >
                    <option value="SAR">ريال</option>
                    <option value="USD">دولار</option>
                    <option value="EUR">يورو</option>
                  </select>
                </div>
              </div>

              {/* Supplier Item Code */}
              <div className="space-y-1">
                <label className="text-sm font-medium">
                  كود الصنف عند المورد
                  <span className="text-muted-foreground text-xs mr-1">(اختياري)</span>
                </label>
                <Input
                  value={assignForm.supplierItemCode}
                  onChange={(e) => setAssignForm({ ...assignForm, supplierItemCode: e.target.value })}
                  placeholder="مثال: SKF-6205-A"
                  dir="ltr"
                />
              </div>

              {/* Preferred Toggle */}
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                <Star className={cn(
                  "w-4 h-4 shrink-0",
                  assignForm.isPreferred ? "text-amber-500" : "text-muted-foreground"
                )} />
                <div className="flex-1">
                  <p className="text-sm font-medium">المورد الأساسي</p>
                  <p className="text-xs text-muted-foreground">يُستخدم كمورد مقترح عند الشراء</p>
                </div>
                <button
                  type="button"
                  onClick={() => setAssignForm({ ...assignForm, isPreferred: !assignForm.isPreferred })}
                  className={cn(
                    "relative w-10 h-5 rounded-full transition-colors",
                    assignForm.isPreferred ? "bg-amber-400" : "bg-muted-foreground/30"
                  )}
                >
                  <span className={cn(
                    "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform",
                    assignForm.isPreferred ? "translate-x-5" : "translate-x-0.5"
                  )} />
                </button>
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <label className="text-sm font-medium">
                  ملاحظات
                  <span className="text-muted-foreground text-xs mr-1">(اختياري)</span>
                </label>
                <Input
                  value={assignForm.notes}
                  onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })}
                  placeholder="أي ملاحظات خاصة بهذا المورد للصنف"
                  dir="rtl"
                />
              </div>

              <Button
                onClick={handleAssign}
                disabled={assignMut.isPending}
                className="w-full"
              >
                {assignMut.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {assignMut.isPending ? "جاري الربط..." : "ربط المورد"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Linked Supplier Row ────────────────────────────────────────────────────
function LinkedSupplierRow({
  link,
  onRemove,
  onSetPreferred,
}: {
  link: ItemSupplierLink;
  onRemove: (l: ItemSupplierLink) => void;
  onSetPreferred: () => void;
}) {
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors",
      link.isPreferred
        ? "border-amber-300 bg-amber-50/60"
        : "hover:bg-muted/30"
    )}>
      {/* Preferred Star */}
      <button
        type="button"
        onClick={onSetPreferred}
        title={link.isPreferred ? "مورد أساسي" : "تعيين كمورد أساسي"}
        className="shrink-0"
      >
        {link.isPreferred ? (
          <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
        ) : (
          <StarOff className="w-4 h-4 text-muted-foreground hover:text-amber-400 transition-colors" />
        )}
      </button>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{link.supplierNameAr}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-primary font-medium">
            {Number(link.price).toLocaleString("ar-SA")} {link.currency}
          </span>
          {link.supplierItemCode && (
            <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {link.supplierItemCode}
            </span>
          )}
          {link.supplierCountry && (
            <span className="text-xs text-muted-foreground">
              {link.supplierCountry}
            </span>
          )}
        </div>
      </div>

      {/* Remove */}
      <button
        type="button"
        onClick={() => onRemove(link)}
        className="shrink-0 p-1 rounded hover:bg-red-100 hover:text-red-600 transition-colors text-muted-foreground"
        title="إزالة المورد"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Supplier Search Dialog ─────────────────────────────────────────────────
function SupplierSearchDialog({
  open,
  onClose,
  onSelect,
  alreadyLinked,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (s: Supplier) => void;
  alreadyLinked: number[];
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: allSuppliers, isLoading } = trpc.catalog.suppliers.list.useQuery(
    { activeOnly: true },
    { enabled: open }
  );

  // focus on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery("");
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!allSuppliers) return [];
    const q = query.trim().toLowerCase();
    return allSuppliers.filter((s: Supplier) => {
      if (alreadyLinked.includes(s.id)) return false;
      if (!q) return true;
      return (
        s.nameAr.toLowerCase().includes(q) ||
        s.nameEn.toLowerCase().includes(q) ||
        s.phone?.toLowerCase().includes(q) ||
        s.country?.toLowerCase().includes(q)
      );
    });
  }, [allSuppliers, query, alreadyLinked]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Search className="w-4 h-4" />
            اختر مورداً
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث عن المورد..."
              className="pr-9"
              dir="rtl"
            />
          </div>

          {/* Results */}
          <div className="max-h-64 overflow-y-auto space-y-1">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length > 0 ? (
              filtered.map((s: Supplier) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelect(s)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-primary/5 hover:border-primary/30 border border-transparent transition-colors text-right"
                >
                  <div className={cn(
                    "p-1.5 rounded-md shrink-0",
                    s.isManufacturer
                      ? "bg-amber-100 text-amber-700"
                      : "bg-blue-100 text-blue-700"
                  )}>
                    {s.isManufacturer
                      ? <Factory className="w-3.5 h-3.5" />
                      : <Building2 className="w-3.5 h-3.5" />}
                  </div>
                  <div className="flex-1 min-w-0 text-right">
                    <p className="text-sm font-medium truncate">{s.nameAr}</p>
                    <p className="text-xs text-muted-foreground truncate">{s.nameEn}</p>
                  </div>
                  {s.country && (
                    <span className="text-xs text-muted-foreground shrink-0">{s.country}</span>
                  )}
                </button>
              ))
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">
                {query
                  ? `لا توجد نتائج لـ "${query}"`
                  : alreadyLinked.length > 0
                    ? "جميع الموردين المتاحين مرتبطون بهذا الصنف"
                    : "لا يوجد موردون — أضفهم من تبويب الموردين أولاً"}
              </div>
            )}
          </div>

          {alreadyLinked.length > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              {alreadyLinked.length} مورد مرتبط مسبقاً لا يظهر في القائمة
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
