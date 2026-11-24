import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Link2,
  Inbox,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/contexts/LanguageContext";
import { getCatalogSuppliersText } from "@/i18n/catalogSuppliers";
import { formatCatalogText, getCatalogError } from "@/i18n/catalogUi";

// ── Types ──────────────────────────────────────────────────────────────────
interface Supplier {
  id: number;
  nameAr: string;
  nameEn: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxNumber: string | null;
  commercialRegistration: string | null;
  country: string | null;
  notes: string | null;
  isManufacturer: boolean;
  isActive: boolean;
}

interface SupplierCandidate {
  id: number;
  receiptId: number | null;
  purchaseOrderId: number | null;
  invoiceNumber: string | null;
  invoicePhotoUrl: string | null;
  extractedName: string;
  extractedNameEn: string | null;
  taxNumber: string | null;
  commercialRegistration: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  createdAt: string;
}

interface FormState {
  nameAr: string;
  nameEn: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  taxNumber: string;
  commercialRegistration: string;
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
  taxNumber: "",
  commercialRegistration: "",
  country: "",
  notes: "",
  isManufacturer: false,
};

// ── Main Component ─────────────────────────────────────────────────────────
export default function SuppliersManager() {
  const { language } = useTranslation();
  const c = getCatalogSuppliersText(language);
  const dir = language === "en" ? "ltr" : "rtl";
  const [dialogMode, setDialogMode] = useState<
    "add" | "edit" | "candidate" | null
  >(null);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [selectedCandidate, setSelectedCandidate] =
    useState<SupplierCandidate | null>(null);
  const [linkCandidate, setLinkCandidate] = useState<SupplierCandidate | null>(
    null
  );
  const [linkSearch, setLinkSearch] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterManufacturer, setFilterManufacturer] = useState<boolean | null>(
    null
  );

  const {
    data: suppliers,
    isLoading,
    refetch,
  } = trpc.catalog.suppliers.list.useQuery({ activeOnly: false });

  const { data: supplierCandidates = [], refetch: refetchCandidates } =
    trpc.catalog.suppliers.candidates.listPending.useQuery();

  const createMut = trpc.catalog.suppliers.create.useMutation({
    onSuccess: () => {
      refetch();
      closeDialog();
      toast.success(c.created);
    },
    onError: e => toast.error(getCatalogError(e, language, c.operationFailed)),
  });

  const updateMut = trpc.catalog.suppliers.update.useMutation({
    onSuccess: () => {
      refetch();
      closeDialog();
      toast.success(c.updated);
    },
    onError: e => toast.error(getCatalogError(e, language, c.operationFailed)),
  });

  const linkCandidateMut =
    trpc.catalog.suppliers.candidates.linkExisting.useMutation({
      onSuccess: () => {
        refetchCandidates();
        refetch();
        setLinkCandidate(null);
        setLinkSearch("");
        toast.success(c.linked);
      },
      onError: e =>
        toast.error(getCatalogError(e, language, c.operationFailed)),
    });

  const approveCandidateMut =
    trpc.catalog.suppliers.candidates.approveNew.useMutation({
      onSuccess: () => {
        refetchCandidates();
        refetch();
        closeDialog();
        toast.success(c.approved);
      },
      onError: e =>
        toast.error(getCatalogError(e, language, c.operationFailed)),
    });

  const deleteMut = trpc.catalog.suppliers.delete.useMutation({
    onSuccess: () => {
      refetch();
      toast.success(c.deleted);
    },
    onError: e => toast.error(getCatalogError(e, language, c.operationFailed)),
  });

  const toggleActiveMut = trpc.catalog.suppliers.update.useMutation({
    onSuccess: () => {
      refetch();
      toast.success(c.statusUpdated);
    },
    onError: e => toast.error(getCatalogError(e, language, c.operationFailed)),
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
        s.taxNumber?.toLowerCase().includes(q) ||
        s.commercialRegistration?.toLowerCase().includes(q) ||
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
    setSelectedCandidate(null);
    setForm(EMPTY_FORM);
  };

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setDialogMode("add");
  };

  const openEdit = (s: Supplier) => {
    setSelected(s);
    setForm({
      nameAr: s.nameAr,
      nameEn: s.nameEn,
      contactName: s.contactName ?? "",
      phone: s.phone ?? "",
      email: s.email ?? "",
      address: s.address ?? "",
      taxNumber: s.taxNumber ?? "",
      commercialRegistration: s.commercialRegistration ?? "",
      country: s.country ?? "",
      notes: s.notes ?? "",
      isManufacturer: Boolean(s.isManufacturer),
    });
    setDialogMode("edit");
  };

  const openCandidateApproval = (candidate: SupplierCandidate) => {
    setSelectedCandidate(candidate);
    setForm({
      ...EMPTY_FORM,
      nameAr: candidate.extractedName || "",
      nameEn: candidate.extractedNameEn || candidate.extractedName || "",
      taxNumber: candidate.taxNumber || "",
      commercialRegistration: candidate.commercialRegistration || "",
      phone: candidate.phone || "",
      email: candidate.email || "",
      address: candidate.address || "",
      notes: candidate.invoiceNumber
        ? `مرشح من فاتورة ${candidate.invoiceNumber}`
        : "مرشح من استلام مشتريات",
    });
    setDialogMode("candidate");
  };

  const handleSubmit = async () => {
    if (!form.nameAr.trim() || !form.nameEn.trim()) {
      toast.error(c.namesRequired);
      return;
    }

    const payload = {
      nameAr: form.nameAr.trim(),
      nameEn: form.nameEn.trim(),
      contactName: form.contactName.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      address: form.address.trim() || undefined,
      taxNumber: form.taxNumber.trim() || undefined,
      commercialRegistration: form.commercialRegistration.trim() || undefined,
      country: form.country.trim() || undefined,
      notes: form.notes.trim() || undefined,
      isManufacturer: form.isManufacturer,
    };

    if (dialogMode === "edit" && selected) {
      await updateMut.mutateAsync({ id: selected.id, ...payload });
    } else if (dialogMode === "candidate" && selectedCandidate) {
      await approveCandidateMut.mutateAsync({
        candidateId: selectedCandidate.id,
        ...payload,
      });
    } else {
      await createMut.mutateAsync(payload);
    }
  };

  const handleDelete = (s: Supplier) => {
    if (confirm(formatCatalogText(c.deleteConfirm, { name: s.nameAr }))) {
      deleteMut.mutate(s.id);
    }
  };

  const handleToggleActive = (s: Supplier) => {
    toggleActiveMut.mutate({ id: s.id, isActive: !s.isActive });
  };

  const isPending =
    createMut.isPending || updateMut.isPending || approveCandidateMut.isPending;

  // ── Stats ─────────────────────────────────────────────────
  const total = suppliers?.length ?? 0;
  const activeCount =
    suppliers?.filter((s: Supplier) => s.isActive).length ?? 0;
  const mfrCount =
    suppliers?.filter((s: Supplier) => s.isManufacturer && s.isActive).length ??
    0;

  return (
    <div className="space-y-5" dir={dir}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            {c.heading}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatCatalogText(c.stats, {
              active: activeCount,
              manufacturers: mfrCount,
              total,
            })}
          </p>
        </div>
        <Button size="sm" className="gap-2" onClick={openAdd}>
          <Plus className="w-4 h-4" />
          {c.add}
        </Button>
      </div>

      {/* 2B-2 — الموردون الجدد لا يوقفون الاستلام؛ يصلون هنا للمراجعة لاحقاً. */}
      {supplierCandidates.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h4 className="font-semibold flex items-center gap-2">
                  <Inbox className="w-4 h-4 text-amber-700" />
                  {c.newSuppliers}
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {c.newSuppliersHint}
                </p>
              </div>
              <Badge variant="outline">
                {supplierCandidates.length} {c.pending}
              </Badge>
            </div>

            <div className="space-y-2">
              {(supplierCandidates as SupplierCandidate[]).map(candidate => (
                <div
                  key={candidate.id}
                  className="rounded-md border bg-background p-3 flex flex-col sm:flex-row sm:items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {candidate.extractedName}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {candidate.invoiceNumber
                        ? formatCatalogText(c.invoice, {
                            number: candidate.invoiceNumber,
                          })
                        : c.invoiceWithoutNumber}
                      {candidate.taxNumber
                        ? formatCatalogText(c.taxInline, {
                            number: candidate.taxNumber,
                          })
                        : ""}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => {
                        setLinkCandidate(candidate);
                        setLinkSearch(candidate.extractedName);
                      }}
                    >
                      <Link2 className="w-3.5 h-3.5" /> {c.linkExisting}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => openCandidateApproval(candidate)}
                    >
                      {c.approveNew}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search + Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={c.search}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="ps-9"
            dir={dir}
          />
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 shrink-0">
          {[
            { label: c.all, value: null },
            { label: c.suppliers, value: false },
            { label: c.manufacturers, value: true },
          ].map(f => (
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
              <p>{formatCatalogText(c.noResults, { search: searchQuery })}</p>
            ) : (
              <>
                <p className="mb-1">{c.empty}</p>
                <p className="text-xs">{c.emptyHint}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={openAdd}
                >
                  {c.addFirst}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add / Edit Dialog */}
      <Dialog
        open={!!dialogMode}
        onOpenChange={open => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent
          className="max-w-lg max-h-[90vh] overflow-y-auto"
          dir={dir}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {dialogMode === "edit" ? (
                <>
                  <Edit2 className="w-4 h-4" /> {c.editSupplier}
                </>
              ) : dialogMode === "candidate" ? (
                <>
                  <CheckCircle2 className="w-4 h-4" /> {c.approveSuggested}
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" /> {c.addNew}
                </>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* الأسماء */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">{c.arabicName}</label>
                <Input
                  value={form.nameAr}
                  onChange={e => setForm({ ...form, nameAr: e.target.value })}
                  placeholder={c.arabicNameExample}
                  dir="rtl"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">{c.englishName}</label>
                <Input
                  value={form.nameEn}
                  onChange={e => setForm({ ...form, nameEn: e.target.value })}
                  placeholder="e.g. Gulf Co."
                  dir="ltr"
                />
              </div>
            </div>

            {/* نوع المورد */}
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
              <Factory className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">{c.manufacturerCompany}</p>
                <p className="text-xs text-muted-foreground">
                  {c.manufacturerHint}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setForm({ ...form, isManufacturer: !form.isManufacturer })
                }
                aria-label={c.manufacturerHint}
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">{c.taxNumber}</label>
                <Input
                  value={form.taxNumber}
                  onChange={e =>
                    setForm({ ...form, taxNumber: e.target.value })
                  }
                  placeholder="3xxxxxxxxxxxxxx"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">{c.registration}</label>
                <Input
                  value={form.commercialRegistration}
                  onChange={e =>
                    setForm({ ...form, commercialRegistration: e.target.value })
                  }
                  placeholder={c.registrationPlaceholder}
                  dir="ltr"
                />
              </div>
            </div>

            {/* معلومات التواصل */}
            <div className="space-y-1">
              <label className="text-sm font-medium">{c.contact}</label>
              <Input
                value={form.contactName}
                onChange={e =>
                  setForm({ ...form, contactName: e.target.value })
                }
                placeholder={c.contactPlaceholder}
                dir={dir}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" /> {c.mobile}
                </label>
                <Input
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  placeholder="05xxxxxxxx"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" /> {c.email}
                </label>
                <Input
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="info@company.com"
                  dir="ltr"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> {c.country}
                </label>
                <Input
                  value={form.country}
                  onChange={e => setForm({ ...form, country: e.target.value })}
                  placeholder={c.countryPlaceholder}
                  dir={dir}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">{c.address}</label>
                <Input
                  value={form.address}
                  onChange={e => setForm({ ...form, address: e.target.value })}
                  placeholder={c.addressPlaceholder}
                  dir={dir}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">{c.notes}</label>
              <Input
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder={c.notesPlaceholder}
                dir={dir}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                onClick={handleSubmit}
                disabled={isPending}
                className="flex-1"
              >
                {isPending && <Loader2 className="w-4 h-4 animate-spin ms-2" />}
                {isPending
                  ? c.saving
                  : dialogMode === "edit"
                    ? c.update
                    : dialogMode === "candidate"
                      ? c.approveNewSupplier
                      : c.addSupplier}
              </Button>
              <Button
                variant="outline"
                onClick={closeDialog}
                disabled={isPending}
              >
                {c.cancel}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!linkCandidate}
        onOpenChange={open => {
          if (!open) {
            setLinkCandidate(null);
            setLinkSearch("");
          }
        }}
      >
        <DialogContent className="max-w-lg" dir={dir}>
          <DialogHeader>
            <DialogTitle>{c.linkHeading}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {c.invoiceSupplier}{" "}
              <strong className="text-foreground">
                {linkCandidate?.extractedName}
              </strong>
            </p>
            <Input
              value={linkSearch}
              onChange={e => setLinkSearch(e.target.value)}
              placeholder={c.linkSearch}
            />
            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {(suppliers || [])
                .filter(
                  (supplier: Supplier) =>
                    supplier.isActive &&
                    (!linkSearch.trim() ||
                      supplier.nameAr
                        .toLowerCase()
                        .includes(linkSearch.trim().toLowerCase()) ||
                      supplier.nameEn
                        .toLowerCase()
                        .includes(linkSearch.trim().toLowerCase()) ||
                      supplier.taxNumber?.includes(linkSearch.trim()))
                )
                .slice(0, 20)
                .map((supplier: Supplier) => (
                  <button
                    key={supplier.id}
                    type="button"
                    disabled={linkCandidateMut.isPending}
                    onClick={() =>
                      linkCandidate &&
                      linkCandidateMut.mutate({
                        candidateId: linkCandidate.id,
                        supplierId: supplier.id,
                      })
                    }
                    className="w-full text-start rounded-md border p-2.5 hover:bg-muted transition-colors"
                  >
                    <p className="text-sm font-medium">{supplier.nameAr}</p>
                    <p className="text-xs text-muted-foreground">
                      {supplier.nameEn}
                      {supplier.taxNumber ? ` · ${supplier.taxNumber}` : ""}
                    </p>
                  </button>
                ))}
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
  const { language } = useTranslation();
  const c = getCatalogSuppliersText(language);
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
            <div
              className={cn(
                "p-1.5 rounded-md shrink-0",
                supplier.isManufacturer
                  ? "bg-amber-100 text-amber-700"
                  : "bg-blue-100 text-blue-700"
              )}
            >
              {supplier.isManufacturer ? (
                <Factory className="w-4 h-4" />
              ) : (
                <Building2 className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">
                {supplier.nameAr}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {supplier.nameEn}
              </p>
            </div>
          </div>

          {/* Active Badge */}
          <button
            onClick={() => onToggleActive(supplier)}
            title={supplier.isActive ? c.deactivate : c.activate}
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
              {c.manufacturer}
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
              <span className="w-3.5 h-3.5 inline-flex items-center justify-center text-[10px]">
                👤
              </span>
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
              <span className="truncate" dir="ltr">
                {supplier.email}
              </span>
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
            {c.edit}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 text-destructive hover:bg-destructive/10 hover:border-destructive"
            onClick={() => onDelete(supplier)}
            aria-label={c.deleteSupplier}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
