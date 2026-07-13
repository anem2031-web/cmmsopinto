import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { mediaUrl } from "@/lib/mediaUrl";
import { trpc } from "@/lib/trpc";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, Search, Edit, Trash2, Package, AlertTriangle,
  CheckCircle, Wrench, XCircle, ShieldCheck, ShieldOff, History, Eye,
} from "lucide-react";
import DropZone from "@/components/common/DropZone";

type AssetStatus = "active" | "inactive" | "under_maintenance" | "disposed";

interface AssetFormData {
  name: string;
  description: string;
  category: string;
  brand: string;
  model: string;
  serialNumber: string;
  rfidTag: string;
  siteId: string;
  sectionId: string;
  locationDetail: string;
  status: AssetStatus;
  purchaseDate: string;
  purchaseCost: string;
  warrantyExpiry: string;
  warrantyNotes: string;
  photoUrl: string;
  notes: string;
  categoryId: string;
}

const defaultForm: AssetFormData = {
  name: "", description: "", category: "", brand: "", model: "",
  serialNumber: "", rfidTag: "", siteId: "", sectionId: "", locationDetail: "", status: "active",
  purchaseDate: "", purchaseCost: "", warrantyExpiry: "", warrantyNotes: "",
  photoUrl: "", notes: "", categoryId: "",
};

export default function Assets() {
  const { t: tr } = useLanguage();
  const { t } = useLanguage();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<AssetFormData>(defaultForm);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  const [showRfidScanner, setShowRfidScanner] = useState(false);
  const [rfidInput, setRfidInput] = useState("");
  const [rfidResult, setRfidResult] = useState<any | null>(null);
  const [rfidError, setRfidError] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editCategoryId, setEditCategoryId] = useState<number | null>(null);
  const [editCategoryName, setEditCategoryName] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [warrantyFilter, setWarrantyFilter] = useState(false);

  const utils = trpc.useUtils();
  const { data: categories = [] } = trpc.assetCategories.list.useQuery();
  const createCategoryMut = trpc.assetCategories.create.useMutation({ onSuccess: () => { utils.assetCategories.list.invalidate(); setNewCategoryName(""); toast.success("تم إضافة الفئة"); }, onError: () => toast.error("حدث خطأ، حاول مرة أخرى") });
  const updateCategoryMut = trpc.assetCategories.update.useMutation({ onSuccess: () => { utils.assetCategories.list.invalidate(); setEditCategoryId(null); setEditCategoryName(""); toast.success("تم تعديل الفئة"); }, onError: () => toast.error("حدث خطأ، حاول مرة أخرى") });
  const deleteCategoryMut = trpc.assetCategories.delete.useMutation({ onSuccess: () => { utils.assetCategories.list.invalidate(); toast.success("تم حذف الفئة"); }, onError: () => toast.error("حدث خطأ، حاول مرة أخرى") });

  const { data: assets = [], isLoading } = trpc.assets.list.useQuery({
    status: statusFilter !== "all" ? statusFilter : undefined,
    siteId: siteFilter !== "all" ? Number(siteFilter) : undefined,
    sectionId: sectionFilter !== "all" ? Number(sectionFilter) : undefined,
    search: search || undefined,
  });

  const { data: sites = [] } = trpc.sites.list.useQuery();
  const { data: sections } = trpc.sections.list.useQuery(undefined);

  const createMut = trpc.assets.create.useMutation({
    onSuccess: () => {
      toast.success(t.assets.assetCreated);
      utils.assets.list.invalidate();
      setShowForm(false);
      setForm(defaultForm);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMut = trpc.assets.update.useMutation({
    onSuccess: () => {
      toast.success(t.assets.assetUpdated);
      utils.assets.list.invalidate();
      setShowForm(false);
      setEditId(null);
      setForm(defaultForm);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = trpc.assets.delete.useMutation({
    onSuccess: () => {
      toast.success(t.assets.assetDeleted);
      utils.assets.list.invalidate();
      setDeleteId(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    const payload = {
      name: form.name,
      description: form.description || undefined,
      category: form.category || undefined,
      brand: form.brand || undefined,
      model: form.model || undefined,
      serialNumber: form.serialNumber || undefined,
      rfidTag: form.rfidTag || undefined,
      siteId: form.siteId ? Number(form.siteId) : undefined,
      sectionId: form.sectionId ? Number(form.sectionId) : undefined,
      locationDetail: form.locationDetail || undefined,
      status: form.status,
      purchaseDate: form.purchaseDate || undefined,
      purchaseCost: form.purchaseCost || undefined,
      warrantyExpiry: form.warrantyExpiry || undefined,
      warrantyNotes: form.warrantyNotes || undefined,
      photoUrl: form.photoUrl || undefined,
      notes: form.notes || undefined,
      categoryId: form.categoryId ? Number(form.categoryId) : undefined,
    };
    if (editId) {
      updateMut.mutate({ id: editId, ...payload });
    } else {
      createMut.mutate(payload);
    }
  };

  const openEdit = (asset: any) => {
    setEditId(asset.id);
    setForm({
      name: asset.name ?? "",
      description: asset.description ?? "",
      category: asset.category ?? "",
      brand: asset.brand ?? "",
      model: asset.model ?? "",
      serialNumber: asset.serialNumber ?? "",
      rfidTag: asset.rfidTag ?? "",
      siteId: asset.siteId ? String(asset.siteId) : "",
      sectionId: asset.sectionId ? String(asset.sectionId) : "",
      locationDetail: asset.locationDetail ?? "",
      status: asset.status ?? "active",
      purchaseDate: asset.purchaseDate ? new Date(asset.purchaseDate).toISOString().split("T")[0] : "",
      purchaseCost: asset.purchaseCost ?? "",
      warrantyExpiry: asset.warrantyExpiry ? new Date(asset.warrantyExpiry).toISOString().split("T")[0] : "",
      warrantyNotes: asset.warrantyNotes ?? "",
      photoUrl: asset.photoUrl ?? "",
      notes: asset.notes ?? "",
      categoryId: asset.categoryId ? String(asset.categoryId) : "",
    });
    setShowForm(true);
  };

  const statusConfig: Record<AssetStatus, { label: string; color: string; icon: any }> = {
    active: { label: t.assets.active, color: "bg-green-100 text-green-800", icon: CheckCircle },
    inactive: { label: t.assets.inactive, color: "bg-gray-100 text-gray-800", icon: XCircle },
    under_maintenance: { label: t.assets.under_maintenance, color: "bg-yellow-100 text-yellow-800", icon: Wrench },
    disposed: { label: t.assets.disposed, color: "bg-red-100 text-red-800", icon: Trash2 },
  };

  // Stats
  const stats = useMemo(() => ({
    total: assets.length,
    active: assets.filter((a: any) => a.status === "active").length,
    underMaintenance: assets.filter((a: any) => a.status === "under_maintenance").length,
    warrantyExpiringSoon: assets.filter((a: any) => {
      if (!a.warrantyExpiry) return false;
      const days = (new Date(a.warrantyExpiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      return days > 0 && days <= 90;
    }).length,
  }), [assets]);

  const isWarrantyExpired = (date: string | null) => {
    if (!date) return false;
    return new Date(date) < new Date();
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t.assets.title}</h1>
          <p className="text-muted-foreground text-sm">{t.assets.description}</p>
        </div>
        <Button onClick={() => { setEditId(null); setForm(defaultForm); setShowForm(true); }}>
          <Plus className="h-4 w-4 ml-2" />
          {t.assets.addAsset}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Package className="h-8 w-8 text-blue-500" />
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground">{t.assets.totalAssets}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle className="h-8 w-8 text-green-500" />
            <div>
              <p className="text-2xl font-bold">{stats.active}</p>
              <p className="text-xs text-muted-foreground">{t.assets.activeAssets}</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all ${statusFilter === "under_maintenance" ? "ring-2 ring-yellow-400" : "hover:shadow-md"}`}
          onClick={() => { setWarrantyFilter(false); setStatusFilter(prev => prev === "under_maintenance" ? "all" : "under_maintenance"); }}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <Wrench className="h-8 w-8 text-yellow-500" />
            <div>
              <p className="text-2xl font-bold">{stats.underMaintenance}</p>
              <p className="text-xs text-muted-foreground">{t.assets.underMaintenance}</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all ${warrantyFilter ? "ring-2 ring-orange-400" : "hover:shadow-md"}`}
          onClick={() => { setStatusFilter("all"); setWarrantyFilter(prev => !prev); }}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-orange-500" />
            <div>
              <p className="text-2xl font-bold">{stats.warrantyExpiringSoon}</p>
              <p className="text-xs text-muted-foreground">{t.assets.warrantyExpiringSoon}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t.common.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.common.all}</SelectItem>
            <SelectItem value="active">{t.assets.active}</SelectItem>
            <SelectItem value="inactive">{t.assets.inactive}</SelectItem>
            <SelectItem value="under_maintenance">{t.assets.under_maintenance}</SelectItem>
            <SelectItem value="disposed">{t.assets.disposed}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={siteFilter} onValueChange={v => { setSiteFilter(v); setSectionFilter("all"); }}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="الموقع" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل المواقع</SelectItem>
            {sites.map((s: any) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {siteFilter !== "all" && (
          <Select value={sectionFilter} onValueChange={setSectionFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="القسم" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأقسام</SelectItem>
              {sections?.filter((s: any) => s.siteId === Number(siteFilter)).map((s: any) => (
                <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="تصفية حسب الفئة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الفئات</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setShowRfidScanner(true)}>
          {t.assets.scanRfid || "مسح RFID"}
        </Button>
      </div>

      {/* Assets Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4 h-40 bg-muted/30" />
            </Card>
          ))}
        </div>
      ) : assets.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>{t.assets.noAssets}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {assets.filter((asset: any) => {
            if (categoryFilter !== "all" && String(asset.categoryId) !== categoryFilter) return false;
            if (warrantyFilter) {
              if (!asset.warrantyExpiry) return false;
              const days = (new Date(asset.warrantyExpiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
              return days > 0 && days <= 90;
            }
            return true;
          }).map((asset: any) => {
            const cfg = statusConfig[asset.status as AssetStatus] ?? statusConfig.active;
            const StatusIcon = cfg.icon;
            const wExpired = isWarrantyExpired(asset.warrantyExpiry);
            return (
              <Card key={asset.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">{asset.assetNumber}</p>
                      <CardTitle className="text-base truncate">{asset.name}</CardTitle>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                      <StatusIcon className="h-3 w-3" />
                      {cfg.label}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {asset.categoryId && (() => { const cat = categories.find((c) => c.id === asset.categoryId); return cat ? <p className="text-xs text-blue-600 font-medium">{cat.name}</p> : null; })()}
                  {asset.category && (
                    <p className="text-sm text-muted-foreground">{asset.category}</p>
                  )}
                  {(asset.brand || asset.model) && (
                    <p className="text-sm">{[asset.brand, asset.model].filter(Boolean).join(" · ")}</p>
                  )}
                  {asset.serialNumber && (
                    <p className="text-xs text-muted-foreground">S/N: {asset.serialNumber}</p>
                  )}
                  {asset.warrantyExpiry && (
                    <div className={`flex items-center gap-1 text-xs ${wExpired ? "text-red-600" : "text-green-600"}`}>
                      {wExpired ? <ShieldOff className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                      {wExpired ? t.assets.warrantyExpired : t.assets.warrantyActive}
                      {" · "}{new Date(asset.warrantyExpiry).toLocaleDateString()}
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={(e) => { e.stopPropagation(); navigate(`/asset/${asset.id}`); }}>
                      <Eye className="h-3 w-3 ml-1" />
                      استعراض
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1" onClick={(e) => { e.stopPropagation(); openEdit(asset); }}>
                      <Edit className="h-3 w-3 ml-1" />
                      {t.common.edit}
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteId(asset.id); }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={(o) => { if (!o) { setShowForm(false); setEditId(null); setForm(defaultForm); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? t.assets.editAsset : t.assets.addAsset}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>{t.assets.assetName} *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>الفئة</Label>
              <Select value={form.categoryId || "none"} onValueChange={v => setForm(f => ({ ...f, categoryId: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="اختر الفئة (اختياري)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون فئة</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t.assets.status}</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as AssetStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t.assets.active}</SelectItem>
                  <SelectItem value="inactive">{t.assets.inactive}</SelectItem>
                  <SelectItem value="under_maintenance">{t.assets.under_maintenance}</SelectItem>
                  <SelectItem value="disposed">{t.assets.disposed}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t.assets.brand}</Label>
              <Input value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} />
            </div>
            <div>
              <Label>{t.assets.model}</Label>
              <Input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
            </div>
            <div>
              <Label>{t.assets.serialNumber}</Label>
              <Input value={form.serialNumber} onChange={e => setForm(f => ({ ...f, serialNumber: e.target.value }))} />
            </div>
            <div>
              <Label>{t.assets.rfidTag || "RFID Tag"}</Label>
              <Input value={form.rfidTag} onChange={e => setForm(f => ({ ...f, rfidTag: e.target.value }))} placeholder="مثال: 001A2B3C" />
            </div>
            <div>
              <Label>{t.assets.location}</Label>
              <Select value={form.siteId || "none"} onValueChange={v => setForm(f => ({ ...f, siteId: v === "none" ? "" : v, sectionId: "" }))}>
                <SelectTrigger><SelectValue placeholder={t.common.none} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t.common.none}</SelectItem>
                  {sites.map((s: any) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.siteId && form.siteId !== "none" && (
              <div>
                <Label>القسم</Label>
                <Select value={form.sectionId || "none"} onValueChange={v => setForm(f => ({ ...f, sectionId: v === "none" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="اختر القسم (اختياري)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون قسم</SelectItem>
                    {sections?.filter((s: any) => s.siteId === Number(form.siteId)).map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>{t.assets.locationDetail}</Label>
              <Input value={form.locationDetail} onChange={e => setForm(f => ({ ...f, locationDetail: e.target.value }))} />
            </div>
            <div>
              <Label>{t.assets.purchaseDate}</Label>
              <Input type="date" value={form.purchaseDate} onChange={e => setForm(f => ({ ...f, purchaseDate: e.target.value }))} />
            </div>
            <div>
              <Label>{t.assets.purchaseCost}</Label>
              <Input type="number" value={form.purchaseCost} onChange={e => setForm(f => ({ ...f, purchaseCost: e.target.value }))} />
            </div>
            <div>
              <Label>{t.assets.warrantyExpiry}</Label>
              <Input type="date" value={form.warrantyExpiry} onChange={e => setForm(f => ({ ...f, warrantyExpiry: e.target.value }))} />
            </div>
            <div>
              <Label>{t.assets.warrantyNotes}</Label>
              <Input value={form.warrantyNotes} onChange={e => setForm(f => ({ ...f, warrantyNotes: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>{t.common.description}</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="col-span-2">
              <Label>{t.common.notes}</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
            {/* Photo Upload via DropZone */}
            <div className="col-span-2">
              <Label>{t.assets.uploadPhoto}</Label>
              {form.photoUrl ? (
                <div className="flex items-center gap-3 mt-1">
                  <img src={form.photoUrl} alt="asset" className="h-16 w-16 object-cover rounded border" />
                  <Button variant="outline" size="sm" onClick={() => setForm(f => ({ ...f, photoUrl: "" }))}>
                    {t.common.delete}
                  </Button>
                </div>
              ) : (
                <DropZone
                  onFilesUploaded={(files) => {
                    if (files[0]) setForm(f => ({ ...f, photoUrl: files[0].url ?? "" }));
                  }}
                  accept="image/*"
                  maxFiles={1}
                  className="mt-1"
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditId(null); setForm(defaultForm); }}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleSubmit} disabled={!form.name || createMut.isPending || updateMut.isPending}>
              {createMut.isPending || updateMut.isPending ? t.common.saving : t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.assets.deleteAsset}</DialogTitle>
          </DialogHeader>
          <p>{t.assets.confirmDelete}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>{t.common.cancel}</Button>
            <Button variant="destructive" onClick={() => deleteId && deleteMut.mutate({ id: deleteId })} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? t.common.deleting : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RFID Scanner Dialog */}
      <Dialog open={showRfidScanner} onOpenChange={(o) => { if (!o) { setShowRfidScanner(false); setRfidInput(""); setRfidResult(null); setRfidError(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.assets.scanRfid || "مسح RFID"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t.assets.rfidTag || "RFID Tag"}</Label>
              <Input
                value={rfidInput}
                onChange={(e) => {
                  setRfidInput(e.target.value);
                  setRfidError("");
                  setRfidResult(null);
                }}
                placeholder="001A2B3C"
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-1">الرجاء إدخال رقم RFID أو استخدم قارئ USB</p>
            </div>
            {rfidError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {rfidError}
              </div>
            )}
            {rfidResult && (
              <Card>
                <CardContent className="p-4 space-y-2">
                  <p className="text-sm font-semibold">{rfidResult.name}</p>
                  <p className="text-xs text-muted-foreground">{t.assets.assetNumber}: {rfidResult.assetNumber}</p>
                  {rfidResult.category && <p className="text-xs text-muted-foreground">{t.assets.category}: {rfidResult.category}</p>}
                  {rfidResult.serialNumber && <p className="text-xs text-muted-foreground">S/N: {rfidResult.serialNumber}</p>}
                </CardContent>
              </Card>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowRfidScanner(false); setRfidInput(""); setRfidResult(null); setRfidError(""); }}>
              {t.common.cancel}
            </Button>
            <Button onClick={async () => {
              if (!rfidInput.trim()) {
                setRfidError("الرجاء إدخال RFID");
                return;
              }
              try {
                const response = await fetch(`/api/trpc/assets.getByRfid?input=${encodeURIComponent(JSON.stringify({ rfidTag: rfidInput }))}`);
                if (!response.ok) throw new Error("الأصل غير موجود");
                const data = await response.json();
                setRfidResult(data.result?.data);
                setRfidError("");
              } catch (err: any) {
                setRfidError(err.message || "الأصل غير موجود");
                setRfidResult(null);
              }
            }}>
              {t.assets.scanRfid || "بحث"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category Management Section */}
      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="font-bold text-base">إدارة الفئات</h3>

        {/* Dropdown */}
        <div className="space-y-1">
          <label className="text-sm font-medium">الفئة</label>
          <select
            className="w-full border rounded px-3 py-2 text-sm bg-background"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            <option value="all">-- جميع الفئات --</option>
            {categories.map((c) => (
              <option key={c.id} value={String(c.id)}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Add new category */}
        <div className="flex gap-2">
          <input
            className="flex-1 border rounded px-3 py-2 text-sm bg-background"
            placeholder="اسم الفئة الجديدة"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
          />
          <button
            className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:opacity-90"
            onClick={() => { if (newCategoryName.trim()) createCategoryMut.mutate({ name: newCategoryName.trim() }); }}
          >
            إضافة
          </button>
        </div>

        {/* Categories list */}
        <div className="space-y-2">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center gap-2 border rounded px-3 py-2">
              {editCategoryId === c.id ? (
                <>
                  <input
                    className="flex-1 border rounded px-2 py-1 text-sm bg-background"
                    value={editCategoryName}
                    onChange={(e) => setEditCategoryName(e.target.value)}
                  />
                  <button
                    className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs"
                    onClick={() => { if (editCategoryName.trim()) updateCategoryMut.mutate({ id: c.id, name: editCategoryName.trim() }); }}
                  >
                    حفظ
                  </button>
                  <button
                    className="px-3 py-1 border rounded text-xs"
                    onClick={() => { setEditCategoryId(null); setEditCategoryName(""); }}
                  >
                    إلغاء
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{c.name}</span>
                  <button
                    className="px-3 py-1 border rounded text-xs hover:bg-muted"
                    onClick={() => { setEditCategoryId(c.id); setEditCategoryName(c.name); }}
                  >
                    تعديل
                  </button>
                  <button
                    className="px-3 py-1 border border-red-300 text-red-600 rounded text-xs hover:bg-red-50"
                    onClick={() => deleteCategoryMut.mutate({ id: c.id })}
                  >
                    حذف
                  </button>
                </>
              )}
            </div>
          ))}
          {categories.length === 0 && (
            <p className="text-sm text-muted-foreground">لا توجد فئات بعد</p>
          )}
        </div>
      </div>
    </div>
  );
}
