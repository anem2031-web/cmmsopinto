import CatalogExportButton from "./CatalogExportButton";
import CatalogImportButton from "./CatalogImportButton";
import React, { useState, useMemo, useEffect } from "react";
import { useTranslation } from "@/contexts/LanguageContext";
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
  Image as ImageIcon,
  Loader2,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Hash,
  Eye,
  Pencil,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SupplierPickerSection } from "@/components/catalog/SupplierPicker";

// ── Types ──────────────────────────────────────────────────────────────────
interface CatalogNode {
  id: number;
  code: string | null;
  nameAr: string;
  nameEn: string;
  level: number;
  parentId: number | null;
}

// ── Node Selector Component ────────────────────────────────────────────────
function NodeSelector({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (id: number, node: CatalogNode) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const { data: allNodes } = trpc.catalog.nodes.list.useQuery({ isActive: true });

  const roots = useMemo(
    () => (allNodes || []).filter((n: CatalogNode) => !n.parentId),
    [allNodes]
  );

  const getChildren = (parentId: number) =>
    (allNodes || []).filter((n: CatalogNode) => n.parentId === parentId);

  const toggle = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedNode = allNodes?.find((n: CatalogNode) => n.id === value);

  const renderNode = (node: CatalogNode, depth = 0): React.ReactNode => {
    const children = getChildren(node.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(node.id);

    return (
      <div key={node.id}>
        <div
          className={cn(
            "flex items-center gap-1.5 py-1.5 px-2 rounded cursor-pointer hover:bg-muted/60 transition-colors",
            value === node.id && "bg-primary/10 text-primary font-medium"
          )}
          style={{ paddingRight: `${depth * 16 + 8}px` }}
          onClick={() => { onChange(node.id, node); setIsOpen(false); }}
        >
          <button onClick={e => toggle(node.id, e)}
            className={cn("w-4 h-4 shrink-0 text-muted-foreground", !hasChildren && "invisible")}>
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
          {node.code && (
            <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground shrink-0">
              {node.code}
            </span>
          )}
          <span className="text-sm truncate">{node.nameAr}</span>
        </div>
        {isExpanded && hasChildren && (
          <div>{children.map(child => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border text-sm transition-colors",
          "hover:bg-muted/50 bg-background",
          !value && "text-muted-foreground",
          isOpen && "border-primary ring-1 ring-primary"
        )}
      >
        <div className="flex items-center gap-2 truncate">
          <FolderOpen className="w-4 h-4 shrink-0 text-muted-foreground" />
          {selectedNode ? (
            <span className="truncate">
              {selectedNode.code && (
                <span className="font-mono text-xs text-muted-foreground ml-1">{selectedNode.code} — </span>
              )}
              {selectedNode.nameAr}
            </span>
          ) : (
            <span>اختر التصنيف *</span>
          )}
        </div>
        <ChevronDown className={cn("w-4 h-4 shrink-0 transition-transform text-muted-foreground", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="absolute z-50 top-full mt-1 w-full bg-background border rounded-md shadow-lg max-h-60 overflow-y-auto">
          <div className="p-1">
            {roots.length > 0
              ? roots.map(node => renderNode(node))
              : <p className="text-sm text-muted-foreground text-center py-4">لا توجد تصنيفات — أضف تصنيفاً أولاً</p>
            }
          </div>
        </div>
      )}
    </div>
  );
}


// ── Main Component ─────────────────────────────────────────────────────────
export default function ItemsManager() {
  const { t } = useTranslation();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [viewItem, setViewItem] = useState<any | null>(null);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState("");  // ← جديد

  const [selectedNode, setSelectedNode] =
    useState<CatalogNode | null>(null);

  const [generatedCode, setGeneratedCode] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);

  const [formData, setFormData] = useState({
    nameAr: "",
    nameEn: "",
    nameUr: "",
    unit: "",
    manufacturer: "",
  });

  const [selectedImage, setSelectedImage] =
    useState<File | null>(null);

  const { data: nodeItems } = trpc.catalog.items.list.useQuery(
    { nodeId: selectedNode?.id, limit: 200 },
    { enabled: !!selectedNode }
  );

  useEffect(() => {
    if (!selectedNode) {
      setGeneratedCode("");
      setCustomCode("");
      return;
    }

    const nodeCode = selectedNode.code || "";
    const items = nodeItems || [];

    const maxSeq =
      items
        .map((s: any) => {
          const code = s.code || "";
          if (nodeCode && code.startsWith(nodeCode)) {
            return parseInt(code.slice(nodeCode.length), 10);
          }
          return 0;
        })
        .filter((n: number) => !isNaN(n) && n > 0)
        .sort((a: number, b: number) => b - a)[0] || 0;

    const seq = String(maxSeq + 1).padStart(3, "0");
    const next = nodeCode ? nodeCode + seq : seq;

    setGeneratedCode(next);

    if (!codeEdited) {
      setCustomCode(next);
    }
  }, [selectedNode, nodeItems]);

  const handleNodeChange = (id: number, node: CatalogNode) => {
    setSelectedNode(node);
    setCodeEdited(false);
  };

  const { data: units } = trpc.catalog.units.list.useQuery();

  const { data: items, isLoading, refetch } =
    trpc.catalog.items.list.useQuery({
      limit: 100,
      isActive: true,
    });

  // ── فلترة البحث — client-side ──────────────────────────
  const filteredItems = useMemo(() => {
    if (!items) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item: any) => {
      return (
        item.nameAr?.toLowerCase().includes(q) ||
        item.nameEn?.toLowerCase().includes(q) ||
        item.code?.toLowerCase().includes(q) ||
        item.unit?.toLowerCase().includes(q) ||
        item.manufacturer?.toLowerCase().includes(q)
      );
    });
  }, [items, searchQuery]);

  const attachmentMut = trpc.attachments.add.useMutation();

  const createMut = trpc.catalog.items.create.useMutation({
    onSuccess: () => {
      refetch();
      resetForm();
      setIsDialogOpen(false);
      toast.success("تم إضافة الصنف");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMut = trpc.catalog.items.update.useMutation({
    onSuccess: () => {
      refetch();
      resetForm();
      setEditingItem(null);
      setIsDialogOpen(false);
      toast.success("تم تحديث الصنف");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = trpc.catalog.items.delete.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("تم حذف الصنف");
    },
    onError: (e) => toast.error(e.message),
  });

  const resetForm = () => {
    setFormData({
      nameAr: "",
      nameEn: "",
      nameUr: "",
      unit: "",
      manufacturer: "",
    });
    setSelectedNode(null);
    setGeneratedCode("");
    setCustomCode("");
    setCodeEdited(false);
    setSelectedImage(null);
    setEditingItem(null);
  };

  const handleCreate = async () => {
    if (!selectedNode) {
      toast.error("يجب اختيار التصنيف");
      return;
    }

    if (!formData.nameAr || !formData.nameEn) {
      toast.error(t.catalog.validation.requiredFields);
      return;
    }

    if (customCode && !/^\d+$/.test(customCode)) {
      toast.error("الكود يجب أن يحتوي على أرقام فقط");
      return;
    }

    if (editingItem) {
      await updateMut.mutateAsync({
        id: editingItem.id,
        nameAr: formData.nameAr,
        nameEn: formData.nameEn,
        nameUr: formData.nameUr || undefined,
        code: customCode || undefined,
        unit: formData.unit || undefined,
        manufacturer: formData.manufacturer || undefined,
      });

      if (selectedImage) {
        const formDataUpload = new FormData();
        formDataUpload.append("file", selectedImage);
        const result = await fetch("/api/upload", {
          method: "POST",
          body: formDataUpload,
        });
        if (!result.ok) throw new Error("فشل رفع الصورة");
        const data = await result.json();
        await attachmentMut.mutateAsync({
          entityType: "catalog_item",
          entityId: editingItem.id,
          fileName: selectedImage.name,
          fileUrl: data.url,
          fileKey: data.fileKey,
          mimeType: selectedImage.type,
          fileSize: selectedImage.size,
        });
      }
      return;
    }

    const createdItem = await createMut.mutateAsync({
      nameAr: formData.nameAr,
      nameEn: formData.nameEn,
      nameUr: formData.nameUr || undefined,
      code: customCode || undefined,
      nodeId: selectedNode.id,
    });

    if (selectedImage) {
      const formDataObj = new FormData();
      formDataObj.append("file", selectedImage);
      const result = await fetch("/api/upload", {
        method: "POST",
        body: formDataObj,
      });
      if (!result.ok) throw new Error("فشل رفع الصورة");
      const data = await result.json();
      await attachmentMut.mutateAsync({
        entityType: "catalog_item",
        entityId: createdItem,
        fileName: selectedImage.name,
        fileUrl: data.url,
        fileKey: data.fileKey,
        mimeType: selectedImage.type,
        fileSize: selectedImage.size,
      });
    }
  };

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold shrink-0">{t.catalog.items.title}</h3>

        {/* شريط البحث */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="ابحث بالاسم، الكود، الوحدة، المصنّع..."
            className="pr-9"
            dir="rtl"
          />
        </div>

<div className="flex items-center gap-2 shrink-0">

  <CatalogExportButton />

  <CatalogImportButton />


  <Button
    size="sm"
    className="gap-2"
    onClick={() => setIsDialogOpen(true)}
  >
    <Plus className="w-4 h-4" />
    {t.catalog.items.addNew}
  </Button>

</div>

</div>

{/* عداد النتائج عند البحث */}

      {searchQuery && (
        <p className="text-xs text-muted-foreground">
          {filteredItems.length} نتيجة من {items?.length ?? 0}
        </p>
      )}

      {/* Items Grid */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : filteredItems.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item: any) => (
            <ItemCard
              key={item.id}
              item={item}
              onView={(item) => setViewItem(item)}
              onEdit={(item) => {
                setSelectedNode({
                  id: item.nodeId,
                  code: item.nodeCode || "",
                  nameAr: item.nodeNameAr || "",
                  nameEn: item.nodeNameEn || "",
                  level: 0,
                  parentId: null,
                });
                setEditingItem(item);
                setFormData({
                  nameAr: item.nameAr || "",
                  nameEn: item.nameEn || "",
                  nameUr: item.nameUr || "",
                  unit: item.unit || "",
                  manufacturer: item.manufacturer || "",
                });
                setCustomCode(item.code || "");
                setCodeEdited(true);
                setIsDialogOpen(true);
              }}
              onDelete={id => {
                if (confirm(t.catalog.confirm.deleteItem)) {
                  deleteMut.mutate(id);
                }
              }}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {searchQuery
              ? `لا توجد نتائج للبحث عن "${searchQuery}"`
              : t.catalog.items.empty}
          </CardContent>
        </Card>
      )}

      {/* View Item Dialog */}
      <Dialog
        open={!!viewItem}
        onOpenChange={(open) => { if (!open) setViewItem(null); }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>استعراض الصنف</DialogTitle>
          </DialogHeader>

          {viewItem && (
            <div className="space-y-4 pt-2">

              <div className="w-full h-52 bg-muted rounded-lg overflow-hidden flex items-center justify-center">
                {viewItem.primaryImageUrl ? (
                  <img
                    src={viewItem.primaryImageUrl}
                    alt={viewItem.nameAr}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImageIcon className="w-12 h-12 text-muted-foreground/30" />
                )}
              </div>

              <div>
                <p className="text-sm text-muted-foreground">الاسم بالعربية</p>
                <p className="font-semibold">{viewItem.nameAr}</p>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">الاسم بالإنجليزية</p>
                <p>{viewItem.nameEn}</p>
              </div>

              {viewItem.code && (
                <div>
                  <p className="text-sm text-muted-foreground">الكود</p>
                  <p className="font-mono">{viewItem.code}</p>
                </div>
              )}

              {viewItem.unit && (
                <div>
                  <p className="text-sm text-muted-foreground">الوحدة</p>
                  <p>{viewItem.unit}</p>
                </div>
              )}

              {viewItem.manufacturer && (
                <div>
                  <p className="text-sm text-muted-foreground">الشركة المصنعة</p>
                  <p>{viewItem.manufacturer}</p>
                </div>
              )}

              {viewItem?.id && (
                <div className="border-t pt-3">
                  <p className="text-sm text-muted-foreground mb-2">الموردون</p>
                  <SupplierPickerSection itemId={viewItem.id} />
                </div>
              )}

            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add / Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={open => { if (!open) resetForm(); setIsDialogOpen(open); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingItem ? "تعديل الصنف" : t.catalog.items.addNew}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">

            <div className="space-y-1">
              <label className="text-sm font-medium">التصنيف *</label>
              <NodeSelector value={selectedNode?.id || null} onChange={handleNodeChange} />
            </div>

            {selectedNode && (
              <div className="space-y-1">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Hash className="w-3.5 h-3.5 text-muted-foreground" />
                  كود الصنف
                  <span className="text-xs text-muted-foreground font-normal">(قابل للتعديل)</span>
                </label>
                <div className="relative">
                  <Input
                    value={customCode}
                    onChange={e => {
                      setCustomCode(e.target.value);
                      setCodeEdited(true);
                    }}
                    dir="ltr"
                    className="font-mono pr-10"
                    placeholder={generatedCode}
                  />
                  {customCode !== generatedCode && generatedCode && (
                    <button
                      onClick={() => { setCustomCode(generatedCode); setCodeEdited(false); }}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-primary hover:underline"
                      title="إعادة التوليد التلقائي"
                    >
                      تلقائي
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  الكود المتوقع: <span className="font-mono text-primary font-medium">{generatedCode}</span>
                  {" "}— أرقام فقط
                </p>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-sm font-medium">{t.catalog.fields.nameAr} *</label>
              <Input value={formData.nameAr}
                onChange={e => setFormData({ ...formData, nameAr: e.target.value })}
                placeholder="مثال: مضخة مياه" dir="rtl" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">{t.catalog.fields.nameEn} *</label>
              <Input value={formData.nameEn}
                onChange={e => setFormData({ ...formData, nameEn: e.target.value })}
                placeholder="Example: Water Pump" dir="ltr" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">
                {t.catalog.fields.nameUr}
                <span className="text-muted-foreground text-xs mr-2">(اختياري)</span>
              </label>
              <Input value={formData.nameUr}
                onChange={e => setFormData({ ...formData, nameUr: e.target.value })}
                placeholder="اختياري" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">
                صورة الصنف
                <span className="text-muted-foreground text-xs mr-2">(اختياري)</span>
              </label>
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setSelectedImage(file);
                }}
              />
              {selectedImage && (
                <p className="text-xs text-muted-foreground">{selectedImage.name}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">{t.catalog.fields.unit}</label>
                <select
                  value={formData.unit}
                  onChange={e => setFormData({ ...formData, unit: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">— اختر الوحدة —</option>
                  {(units || []).map((u: any) => (
                    <option key={u.id} value={u.nameAr}>{u.nameAr} / {u.nameEn}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">{t.catalog.fields.manufacturer}</label>
                <Input value={formData.manufacturer}
                  onChange={e => setFormData({ ...formData, manufacturer: e.target.value })}
                  placeholder="مثال: LG" />
              </div>
            </div>

            {editingItem && (
              <div className="border-t pt-4 mt-2">
                <SupplierPickerSection itemId={editingItem.id} />
              </div>
            )}

            <Button
              onClick={handleCreate}
              disabled={createMut.isPending || updateMut.isPending}
              className="w-full"
            >
              {(createMut.isPending || updateMut.isPending) && (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              )}
              {(createMut.isPending || updateMut.isPending)
                ? t.common.saving
                : editingItem
                  ? "تحديث الصنف"
                  : t.common.save}
            </Button>

          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Item Card ──────────────────────────────────────────────────────────────
function ItemCard({
  item,
  onDelete,
  onView,
  onEdit,
}: {
  item: any;
  onDelete: (id: number) => void;
  onView: (item: any) => void;
  onEdit: (item: any) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="mb-3 w-full h-28 bg-muted rounded-lg flex items-center justify-center">
          {item.primaryImageUrl
            ? <img src={item.primaryImageUrl} alt={item.nameAr} className="w-full h-full object-cover rounded-lg" />
            : <ImageIcon className="w-8 h-8 text-muted-foreground/30" />}
        </div>
        <div className="space-y-2">
          <p className="font-semibold text-sm">{item.nameAr}</p>
          <p className="text-xs text-muted-foreground">{item.nameEn}</p>
          <div className="flex items-center justify-between">
            {item.code && (
              <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-0.5 rounded">{item.code}</span>
            )}
            {item.unit && <span className="text-xs text-muted-foreground">{item.unit}</span>}
          </div>
          {item.manufacturer && (
            <p className="text-xs text-muted-foreground">{t.catalog.fields.manufacturer}: {item.manufacturer}</p>
          )}
        </div>

        <div className="flex gap-2 mt-3">
          <Button variant="secondary" size="sm" className="flex-1 gap-1.5" onClick={() => onView(item)}>
            <Eye className="w-3.5 h-3.5" />
            استعراض
          </Button>
          <Button variant="default" size="sm" className="flex-1 gap-1.5" onClick={() => onEdit(item)}>
            <Pencil className="w-3.5 h-3.5" />
            تعديل
          </Button>
          <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => onDelete(item.id)}>
            <Trash2 className="w-3.5 h-3.5" />
            حذف
          </Button>
        </div>

      </CardContent>
    </Card>
  );
}