import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus,
  Trash2,
  Edit2,
  Loader2,
  Truck,
  Phone,
  Mail,
  MapPin,
  Search,
  Factory,
  CheckCircle2,
  XCircle,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────
interface Supplier {
  id: number;
  nameAr: string;
  nameEn: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  country: string | null;
  notes: string | null;
  isManufacturer: boolean;
  isActive: boolean;
}

interface FormState {
  nameAr: string;
  nameEn: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  country: string;
  notes: string;
  isManufacturer: boolean;
}

const EMPTY_FORM: FormState = {
  nameAr: "",
  nameEn: "",
  contactName: "",
  phone: "",
  email: "",
  address: "",
  country: "",
  notes: "",
  isManufacturer: false,
};

// ── Main Component ─────────────────────────────────────────────────────────
export default function SuppliersManager() {
  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterManufacturer, setFilterManufacturer] = useState<boolean | null>(null);

  const {
    data: suppliers,
    isLoading,
    refetch,
  } = trpc.catalog.suppliers.list.useQuery({ activeOnly: false });

  const createMut = trpc.catalog.suppliers.create.useMutation({
    onSuccess: () => {
      refetch();
      closeDialog();
      toast.success("تم إضافة المورد بنجاح");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMut = trpc.catalog.suppliers.update.useMutation({
    onSuccess: () => {
      refetch();
      closeDialog();
      toast.success("تم تعديل المورد");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = trpc.catalog.suppliers.delete.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("تم حذف المورد");
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleActiveMut = trpc.catalog.suppliers.update.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("تم تحديث حالة المورد");
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Filtering ────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!suppliers) return [];
    return suppliers.filter((s: Supplier) => {
      const q = searchQuery.trim().toLowerCase();
      const matchSearch =
        !q ||
        s.nameAr.toLowerCase().includes(q) ||
        s.nameEn.toLowerCase().includes(q) ||
        s.phone?.toLowerCase().includes(q) ||
        s.contactName?.toLowerCase().includes(q) ||
      s.country?.toLowerCase().includes(q) ||
        s.address?.toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q);

      const matchFilter =
        filterManufacturer === null ||
        Boolean(s.isManufacturer) === filterManufacturer;

      return matchSearch && matchFilter;
    });
  }, [suppliers, searchQuery, filterManufacturer]);

  // ── Handlers ─────────────────────────────────────────────
  const closeDialog = () => {
    setDialogMode(null);
    setSelected(null);
    setForm(EMPTY_FORM);
  };

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setDialogMode("add");
  };

  const openEdit = (s: Supplier) => {
    setSelected(s);
    setForm({
      nameAr:         s.nameAr,
      nameEn:         s.nameEn,
      contactName:    s.contactName    ?? "",
      phone:          s.phone          ?? "",
      email:          s.email          ?? "",
      address:        s.address        ?? "",
      country:        s.country        ?? "",
      notes:          s.notes          ?? "",
      isManufacturer: s.isManufacturer,
    });
    setDialogMode("edit");
  };

  const handleSubmit = async () => {
    if (!form.nameAr.trim() || !form.nameEn.trim()) {
      toast.error("الاسم بالعربية والإنجليزية مطلوبان");
      return;
    }

    const payload = {
      nameAr:         form.nameAr.trim(),
      nameEn:         form.nameEn.trim(),
      contactName:    form.contactName.trim()  || undefined,
      phone:          form.phone.trim()        || undefined,
      email:          form.email.trim()        || undefined,
      address:        form.address.trim()      || undefined,
      country:        form.country.trim()      || undefined,
      notes:          form.notes.trim()        || undefined,
      isManufacturer: form.isManufacturer,
    };

    if (dialogMode === "edit" && selected) {
      await updateMut.mutateAsync({ id: selected.id, ...payload });
    } else {
      await createMut.mutateAsync(payload);
    }
  };

  const handleDelete = (s: Supplier) => {
    if (confirm(`هل تريد حذف المورد "${s.nameAr}"؟\nسيتم إخفاؤه ولن يُحذف إذا كان مرتبطاً بأصناف.`)) {
      deleteMut.mutate(s.id);
    }
  };

  const handleToggleActive = (s: Supplier) => {
    toggleActiveMut.mutate({ id: s.id, isActive: !s.isActive });
  };

  const isPending = createMut.isPending || updateMut.isPending;

  // ── Stats ─────────────────────────────────────────────────
  const total        = suppliers?.length ?? 0;
  const activeCount  = suppliers?.filter((s: Supplier) => s.isActive).length ?? 0;
  const mfrCount     = suppliers?.filter((s: Supplier) => s.isManufacturer && s.isActive).length ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            إدارة الموردين
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {activeCount} نشط · {mfrCount} شركة مصنّعة · {total} إجمالي
          </p>
        </div>
        <Button size="sm" className="gap-2" onClick={openAdd}>
          <Plus className="w-4 h-4" />
          إضافة مورد
        </Button>
      </div>

      {/* Search + Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="ابحث بالاسم، الجوال، المسؤول، الدولة..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pr-9"
            dir="rtl"
          />
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 shrink-0">
          {[
            { label: "الكل",       value: null },
            { label: "موردون",     value: false },
            { label: "مصنّعون",    value: true  },
          ].map((f) => (
            <button
              key={String(f.value)}
              onClick={() => setFilterManufacturer(f.value)}
              className={cn(
                "px-3 py-1.5 text-xs rounded-full border transition-colors",
                filterManufacturer === f.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted border-border"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((supplier: Supplier) => (
            <SupplierCard
              key={supplier.id}
              supplier={supplier}
              onEdit={openEdit}
              onDelete={handleDelete}
              onToggleActive={handleToggleActive}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            <Truck className="w-10 h-10 mx-auto mb-3 opacity-20" />
            {searchQuery ? (
              <p>لا توجد نتائج للبحث عن "{searchQuery}"</p>
            ) : (
              <>
                <p className="mb-1">لا يوجد موردون بعد</p>
                <p className="text-xs">أضف أول مورد لتبدأ بربطه بأصناف الكاتلوج</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={openAdd}>
                  إضافة أول مورد
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={!!dialogMode} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {dialogMode === "edit" ? (
                <><Edit2 className="w-4 h-4" /> تعديل المورد</>
              ) : (
                <><Plus className="w-4 h-4" /> إضافة مورد جديد</>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* الأسماء */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">الاسم بالعربية *</label>
                <Input
                  value={form.nameAr}
                  onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
                  placeholder="مثال: شركة الخليج"
                  dir="rtl"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">الاسم بالإنجليزية *</label>
                <Input
                  value={form.nameEn}
                  onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                  placeholder="e.g. Gulf Co."
                  dir="ltr"
                />
              </div>
            </div>

            {/* نوع المورد */}
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
              <Factory className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">شركة مصنّعة</p>
                <p className="text-xs text-muted-foreground">هل هذا المورد شركة تصنيع مباشر؟</p>
              </div>
              <button
                type="button"
                onClick={() => setForm({ ...form, isManufacturer: !form.isManufacturer })}
                className={cn(
                  "relative w-10 h-5 rounded-full transition-colors",
                  form.isManufacturer ? "bg-primary" : "bg-muted-foreground/30"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform",
                    form.isManufacturer ? "translate-x-5" : "translate-x-0.5"
                  )}
                />
              </button>
            </div>

            {/* معلومات التواصل */}
            <div className="space-y-1">
              <label className="text-sm font-medium">مسؤول التواصل</label>
              <Input
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                placeholder="اسم الشخص المسؤول"
                dir="rtl"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" /> الجوال
                </label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="05xxxxxxxx"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" /> البريد الإلكتروني
                </label>
                <Input
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="info@company.com"
                  dir="ltr"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> الدولة
                </label>
                <Input
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                  placeholder="مثال: السعودية"
                  dir="rtl"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">العنوان</label>
                <Input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="المدينة والشارع"
                  dir="rtl"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">ملاحظات</label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="أي ملاحظات إضافية"
                dir="rtl"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                onClick={handleSubmit}
                disabled={isPending}
                className="flex-1"
              >
                {isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {isPending ? "جاري الحفظ..." : dialogMode === "edit" ? "تحديث المورد" : "إضافة المورد"}
              </Button>
              <Button variant="outline" onClick={closeDialog} disabled={isPending}>
                إلغاء
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Supplier Card ──────────────────────────────────────────────────────────
function SupplierCard({
  supplier,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  supplier: Supplier;
  onEdit: (s: Supplier) => void;
  onDelete: (s: Supplier) => void;
  onToggleActive: (s: Supplier) => void;
}) {
  return (
    <Card
      className={cn(
        "transition-shadow hover:shadow-md",
        !supplier.isActive && "opacity-60"
      )}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className={cn(
              "p-1.5 rounded-md shrink-0",
              supplier.isManufacturer
                ? "bg-amber-100 text-amber-700"
                : "bg-blue-100 text-blue-700"
            )}>
              {supplier.isManufacturer
                ? <Factory className="w-4 h-4" />
                : <Building2 className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{supplier.nameAr}</p>
              <p className="text-xs text-muted-foreground truncate">{supplier.nameEn}</p>
            </div>
          </div>

          {/* Active Badge */}
          <button
            onClick={() => onToggleActive(supplier)}
            title={supplier.isActive ? "إيقاف المورد" : "تفعيل المورد"}
            className="shrink-0"
          >
            {supplier.isActive ? (
              <CheckCircle2 className="w-4 h-4 text-green-500 hover:text-green-700 transition-colors" />
            ) : (
              <XCircle className="w-4 h-4 text-muted-foreground hover:text-red-500 transition-colors" />
            )}
          </button>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5">
          {supplier.isManufacturer && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
              مصنّع
            </span>
          )}
          {supplier.country && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border">
              {supplier.country}
            </span>
          )}
        </div>

        {/* Contact Info */}
        <div className="space-y-1">
          {supplier.contactName && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 inline-flex items-center justify-center text-[10px]">👤</span>
              {supplier.contactName}
            </p>
          )}
          {supplier.phone && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 dir-ltr">
              <Phone className="w-3 h-3 shrink-0" />
              <span dir="ltr">{supplier.phone}</span>
            </p>
          )}
          {supplier.email && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 truncate">
              <Mail className="w-3 h-3 shrink-0" />
              <span className="truncate" dir="ltr">{supplier.email}</span>
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 h-8"
            onClick={() => onEdit(supplier)}
          >
            <Edit2 className="w-3.5 h-3.5" />
            تعديل
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 text-destructive hover:bg-destructive/10 hover:border-destructive"
            onClick={() => onDelete(supplier)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
