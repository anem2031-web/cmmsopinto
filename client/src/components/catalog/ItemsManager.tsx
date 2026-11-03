import { InventoryBookPages } from "@/components/inventory/InventoryBooks";
import CatalogExportButton from "@/components/catalog/CatalogExportButton";
import CatalogImportButton from "@/components/catalog/CatalogImportButton";
import React, { useState, useMemo, useEffect } from "react";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { isCatalogAdminRole, canManageCatalogItemLifecycle, canDeactivateCatalogItem } from "@shared/roles";
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
  Copy,
  RotateCcw,
  Search,
  X,
  FolderTree,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { SupplierPickerSection } from "@/components/catalog/SupplierPicker";
import CatalogTreeFilter, {
  getCatalogNodePathLabel,
  getCatalogSubtreeNodeIds,
  type CatalogTreeNode,
} from "@/components/catalog/CatalogTreeFilter";

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
  const { user } = useAuth();
  const isCatalogAdmin = isCatalogAdminRole(user?.role);
  // تعطيل/إعادة تفعيل الأصناف: Owner/Admin + مدير الصيانة + المستودع الآن.
  const canManageLifecycle = canManageCatalogItemLifecycle(user?.role);
  const { t, language } = useTranslation();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [viewItem, setViewItem] = useState<any | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; alt: string } | null>(null);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [catalogFilterNodeId, setCatalogFilterNodeId] = useState<number | null>(null);

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
  const [isSavingItem, setIsSavingItem] = useState(false);
  const [imageUploadProgress, setImageUploadProgress] = useState(0);
  const [imageSaveStage, setImageSaveStage] = useState<
    "idle" | "uploading" | "linking" | "success" | "error"
  >("idle");
  const [imageSaveMessage, setImageSaveMessage] = useState("");

  const codePreviewQuery = trpc.catalog.items.previewNextCode.useQuery(
    { nodeId: selectedNode?.id || 0 },
    { enabled: !!selectedNode }
  );

  useEffect(() => {
    if (!selectedNode) {
      setGeneratedCode("");
      setCustomCode("");
      return;
    }

    const next = codePreviewQuery.data?.code || "";
    setGeneratedCode(next);

    if (!codeEdited && next) {
      setCustomCode(next);
    }
  }, [selectedNode, codePreviewQuery.data?.code, codeEdited]);

  const handleNodeChange = (id: number, node: CatalogNode) => {
    setSelectedNode(node);
    setCodeEdited(false);
  };

  const { data: units } = trpc.catalog.units.list.useQuery();
  const { data: catalogNodes = [] } = trpc.catalog.nodes.list.useQuery({ isActive: true });

  const catalogTreeNodes = catalogNodes as CatalogTreeNode[];
  const catalogFilterNodeIds = useMemo(
    () => catalogFilterNodeId ? getCatalogSubtreeNodeIds(catalogTreeNodes, catalogFilterNodeId) : [],
    [catalogTreeNodes, catalogFilterNodeId],
  );
  const catalogFilterPath = useMemo(
    () => getCatalogNodePathLabel(catalogTreeNodes, catalogFilterNodeId, language),
    [catalogTreeNodes, catalogFilterNodeId, language],
  );
  const catalogFilterHasChildren = useMemo(
    () => catalogFilterNodeId !== null && catalogTreeNodes.some(node => Number(node.parentId) === catalogFilterNodeId),
    [catalogTreeNodes, catalogFilterNodeId],
  );

  // ── Pagination حقيقي (صفحات) + بحث من السيرفر + فلترة شجرة الأصناف ─────
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce: تأخير إرسال البحث للسيرفر وإعادة الصفحة إلى الأول
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(0);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setPage(0);
  }, [catalogFilterNodeId]);

  const { data: items, isLoading, isFetching, refetch } =
    trpc.catalog.items.list.useQuery({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      isActive: true,
      includeInactive: (isCatalogAdmin || canDeactivateCatalogItem(user?.role)) || undefined,
      search: debouncedSearch || undefined,
      nodeIds: catalogFilterNodeId !== null ? catalogFilterNodeIds : undefined,
    });

  const pageItems = items ?? [];
  const hasNextPage = pageItems.length === PAGE_SIZE;
  const hasPrevPage = page > 0;
  const hasActiveFilters = !!searchQuery.trim() || catalogFilterNodeId !== null;

  const clearItemFilters = () => {
    setSearchQuery("");
    setDebouncedSearch("");
    setCatalogFilterNodeId(null);
    setPage(0);
  };

  // إعادة التحميل من الصفحة الأولى (تُستخدم بعد إضافة/تعديل/حذف صنف)
  const reloadFromStart = () => {
    setPage(0);
    refetch();
  };

  const handleDuplicateFrom = (item: any) => {
    // "إضافة من" تنشئ صنفًا جديدًا مستقلًا اعتمادًا على البيانات الأساسية
    // للصنف الحالي. لا ننسخ الكود أو الصورة أو الموردين؛ الكود يعاد توليده
    // تلقائيًا من التصنيف المختار بنفس آلية الإضافة العادية.
    const itemNode = (catalogNodes as CatalogNode[]).find(
      (node) => Number(node.id) === Number(item.nodeId),
    );

    if (!itemNode) {
      toast.error("تعذر تحميل بيانات تصنيف الصنف. أعد فتح الصفحة وحاول مرة أخرى.");
      return;
    }

    setEditingItem(null);
    setSelectedNode(itemNode);
    setFormData({
      nameAr: item.nameAr || "",
      nameEn: item.nameEn || "",
      nameUr: item.nameUr || "",
      unit: item.unit || "",
      manufacturer: item.manufacturer || "",
    });
    setGeneratedCode("");
    setCustomCode("");
    setCodeEdited(false);
    setSelectedImage(null);
    setImageUploadProgress(0);
    setImageSaveStage("idle");
    setImageSaveMessage("");
    setIsDialogOpen(true);
  };

  // The item and its required image are committed by the same mutation.
  const createMut = trpc.catalog.items.create.useMutation();
  const updateMut = trpc.catalog.items.update.useMutation();

  const deleteMut = trpc.catalog.items.delete.useMutation({
    onSuccess: () => {
      reloadFromStart();
      toast.success("تم تعطيل الصنف");
    },
    onError: (e) => toast.error(e.message),
  });

  const reactivateMut = trpc.catalog.items.reactivate.useMutation({
    onSuccess: () => {
      reloadFromStart();
      toast.success("تمت إعادة تفعيل الصنف");
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
    setImageUploadProgress(0);
    setImageSaveStage("idle");
    setImageSaveMessage("");
  };

  type UploadedCatalogImage = { url: string; fileKey: string };

  const uploadCatalogItemImageFile = (image: File) => {
    setImageSaveStage("uploading");
    setImageUploadProgress(0);
    setImageSaveMessage("جارٍ رفع الصورة...");

    return new Promise<UploadedCatalogImage>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formDataUpload = new FormData();
      formDataUpload.append("file", image);

      xhr.open("POST", "/api/upload");

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        // نحتفظ بآخر 10% لمعالجة الصورة وحفظها في التخزين على السيرفر.
        const pct = Math.min(90, Math.round((event.loaded / event.total) * 90));
        setImageUploadProgress(pct);
        setImageSaveMessage(`جارٍ رفع الصورة... ${pct}%`);
      };

      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          let serverMessage = `فشل رفع الصورة (HTTP ${xhr.status})`;
          try {
            const body = JSON.parse(xhr.responseText);
            if (body?.error) serverMessage = body.error;
          } catch {
            // Keep the HTTP fallback message.
          }
          setImageSaveStage("error");
          setImageUploadProgress(0);
          setImageSaveMessage(serverMessage);
          reject(new Error(serverMessage));
          return;
        }

        try {
          const data = JSON.parse(xhr.responseText);
          if (!data?.url || !data?.fileKey) {
            throw new Error("استجابة رفع الصورة غير مكتملة");
          }
          // وصول الرد يعني أن السيرفر أنهى معالجة الصورة وحفظ الملف في التخزين.
          setImageUploadProgress(95);
          setImageSaveMessage("تم رفع الملف — جارٍ حفظ وربط الصورة بالصنف...");
          resolve({ url: data.url, fileKey: data.fileKey });
        } catch (error) {
          const message = error instanceof Error ? error.message : "استجابة رفع الصورة غير صالحة";
          setImageSaveStage("error");
          setImageUploadProgress(0);
          setImageSaveMessage(message);
          reject(new Error(message));
        }
      };

      xhr.onerror = () => {
        const message = "تعذر الاتصال أثناء رفع الصورة";
        setImageSaveStage("error");
        setImageUploadProgress(0);
        setImageSaveMessage(message);
        reject(new Error(message));
      };

      xhr.send(formDataUpload);
    });
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

    if (!selectedImage && !editingItem?.primaryImageUrl) {
      toast.error("صورة الصنف إلزامية؛ يرجى إضافة صورة قبل الحفظ");
      return;
    }
    if (selectedImage && (!selectedImage.type.startsWith("image/") || selectedImage.size <= 0)) {
      toast.error("يرجى اختيار ملف صورة صالح");
      return;
    }

    const trimmedCode = customCode.trim();
    const existingCode = String(editingItem?.code || "").trim();
    const codeChanged = !editingItem || trimmedCode !== existingCode;
    // Resolve the selected category from the authoritative catalog node list.
    // Item list rows do not include nodeCode, so edit mode must not rely on a
    // synthetic selectedNode object built from item.nodeCode.
    const resolvedSelectedNode = (catalogNodes as CatalogNode[]).find(
      (node) => Number(node.id) === Number(selectedNode.id),
    );
    const nodeCode = String(
      resolvedSelectedNode?.code || codePreviewQuery.data?.nodeCode || selectedNode.code || "",
    ).trim();

    if (trimmedCode && codeChanged) {
      const prefix = `${nodeCode}-`;
      const suffix = trimmedCode.startsWith(prefix) ? trimmedCode.slice(prefix.length) : "";
      if (!nodeCode || !/^\d+(?:-\d+)*$/.test(nodeCode) || !/^\d+$/.test(suffix)) {
        toast.error(`كود الصنف يجب أن يكون بصيغة ${nodeCode || "01-01"}-001`);
        return;
      }
    }

    setIsSavingItem(true);
    setImageSaveStage("idle");
    setImageUploadProgress(0);
    setImageSaveMessage(selectedImage ? "سيتم رفع الصورة ثم حفظها مع بيانات الصنف" : "");
    try {
      const uploaded = selectedImage ? await uploadCatalogItemImageFile(selectedImage) : null;
      const image = selectedImage && uploaded ? {
        fileName: selectedImage.name, fileKey: uploaded.fileKey,
        mimeType: selectedImage.type, fileSize: selectedImage.size,
      } : undefined;
      if (image) setImageSaveStage("linking");
      if (editingItem) {
        await updateMut.mutateAsync({
          id: editingItem.id,
          nodeId: selectedNode.id,
          nameAr: formData.nameAr,
          nameEn: formData.nameEn,
          nameUr: formData.nameUr || undefined,
          code: trimmedCode || undefined,
          unit: formData.unit || undefined,
          manufacturer: formData.manufacturer || undefined,
          image,
        });
      } else {
        if (!image) throw new Error("صورة الصنف إلزامية");
        await createMut.mutateAsync({
          nameAr: formData.nameAr,
          nameEn: formData.nameEn,
          nameUr: formData.nameUr || undefined,
          code: codeEdited ? (trimmedCode || undefined) : undefined,
          nodeId: selectedNode.id,
          unit: formData.unit || undefined,
          manufacturer: formData.manufacturer || undefined,
          image,
        });
      }

      // Refresh only after the atomic item/image save so the returned
      // primaryImageUrl reflects the new image immediately.
      reloadFromStart();
      resetForm();
      setIsDialogOpen(false);
      toast.success(editingItem ? "تم تحديث الصنف" : "تم إضافة الصنف");
    } catch (error) {
      const message = error instanceof Error ? error.message : "حدث خطأ غير متوقع";
      setImageSaveStage("error");
      setImageSaveMessage(message);
      toast.error(message);
    } finally {
      setIsSavingItem(false);
    }
  };

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold shrink-0">{t.catalog.items.title}</h3>

        <div className="flex items-center gap-2 shrink-0">
          {isCatalogAdmin && (
            <CatalogExportButton
              search={searchQuery}
              nodeIds={catalogFilterNodeId !== null ? catalogFilterNodeIds : undefined}
              includeInactive={true}
            />
          )}
          {isCatalogAdmin && <CatalogImportButton />}
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

      {/* البحث النصي + فلتر شجرة الأصناف */}
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)_auto]">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="ابحث بالاسم، الكود، الوحدة، المصنّع..."
            className="pr-9"
            dir="rtl"
          />
        </div>

        <CatalogTreeFilter
          nodes={catalogTreeNodes}
          value={catalogFilterNodeId}
          onChange={setCatalogFilterNodeId}
          language={language}
        />

        <Button
          type="button"
          variant="outline"
          className="gap-2"
          disabled={!hasActiveFilters}
          onClick={clearItemFilters}
        >
          <X className="w-4 h-4" />
          مسح الفلاتر
        </Button>
      </div>

      {catalogFilterNodeId !== null && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <FolderTree className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <span className="font-medium text-foreground">التصنيف: </span>
            <span>{catalogFilterPath || `#${catalogFilterNodeId}`}</span>
            {catalogFilterHasChildren && (
              <span className="me-1"> — يشمل جميع الفروع التابعة</span>
            )}
          </div>
        </div>
      )}

{/* عداد الصفحة الحالية */}

      {!isLoading && (
        <p className="text-xs text-muted-foreground">
          {hasActiveFilters
            ? `صفحة ${page + 1} — ${pageItems.length} صنف مطابق للفلاتر الحالية`
            : `صفحة ${page + 1} — ${pageItems.length} صنف`}
        </p>
      )}

      {/* Items Grid */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : pageItems.length > 0 ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {pageItems.map((item: any) => (
            <ItemCard
              key={item.id}
              item={item}
              categoryPath={getCatalogNodePathLabel(catalogTreeNodes, item.nodeId, language)}
              onView={(item) => setViewItem(item)}
              onImagePreview={(item) => {
                if (item.primaryImageUrl) {
                  setPreviewImage({ url: item.primaryImageUrl, alt: item.nameAr || "صورة الصنف" });
                }
              }}
              onEdit={(item) => {
                // items.list returns catalogItems fields, not nodeCode/nodeName.
                // Reuse the real node already loaded by catalog.nodes.list so
                // code validation always sees the same category shown by the picker.
                const itemNode = (catalogNodes as CatalogNode[]).find(
                  (node) => Number(node.id) === Number(item.nodeId),
                );
                if (!itemNode) {
                  toast.error("تعذر تحميل بيانات تصنيف الصنف. أعد فتح الصفحة وحاول مرة أخرى.");
                  return;
                }
                setSelectedNode(itemNode);
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
              onDuplicate={handleDuplicateFrom}
              canDelete={canDeactivateCatalogItem(user?.role)}
              canReactivate={isCatalogAdmin || canManageLifecycle}
              onDelete={id => {
                if (confirm(t.catalog.confirm.deleteItem)) {
                  deleteMut.mutate(id);
                }
              }}
              onReactivate={id => {
                if (confirm("هل تريد إعادة تفعيل هذا الصنف؟")) {
                  reactivateMut.mutate(id);
                }
              }}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {hasActiveFilters
              ? "لا توجد أصناف مطابقة للفلاتر الحالية"
              : t.catalog.items.empty}
          </CardContent>
        </Card>
      )}

      {/* أزرار التنقل بين الصفحات */}
      {!isLoading && (pageItems.length > 0 || page > 0) && (
        <div className="flex items-center justify-center gap-3 py-4">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasPrevPage || isFetching}
            onClick={() => setPage(p => Math.max(0, p - 1))}
          >
            السابق
          </Button>
          <span className="text-sm text-muted-foreground">صفحة {page + 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNextPage || isFetching}
            onClick={() => setPage(p => p + 1)}
          >
            التالي
          </Button>
        </div>
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

              <div className="w-full h-52 rounded-lg overflow-hidden flex items-center justify-center">
                {viewItem.primaryImageUrl ? (
                  <button
                    type="button"
                    className="flex h-full w-full cursor-zoom-in items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => setPreviewImage({
                      url: viewItem.primaryImageUrl,
                      alt: viewItem.nameAr || "صورة الصنف",
                    })}
                    title="اضغط لعرض الصورة بالحجم الكامل"
                  >
                    <img
                      src={viewItem.primaryImageUrl}
                      alt={viewItem.nameAr}
                      className="max-h-full max-w-full object-contain p-2"
                    />
                  </button>
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

              {viewItem.nodeId && getCatalogNodePathLabel(catalogTreeNodes, viewItem.nodeId, language) && (
                <div>
                  <p className="text-sm text-muted-foreground">التصنيف</p>
                  <p className="flex items-start gap-1.5 text-sm">
                    <FolderTree className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>{getCatalogNodePathLabel(catalogTreeNodes, viewItem.nodeId, language)}</span>
                  </p>
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
      {/* Full-size item image preview */}
      <Dialog
        open={!!previewImage}
        onOpenChange={(open) => { if (!open) setPreviewImage(null); }}
      >
        <DialogContent className="max-w-5xl p-4 sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{previewImage?.alt || "صورة الصنف"}</DialogTitle>
          </DialogHeader>
          {previewImage && (
            <div className="flex max-h-[78vh] min-h-[240px] items-center justify-center overflow-auto rounded-lg">
              <img
                src={previewImage.url}
                alt={previewImage.alt}
                className="max-h-[78vh] max-w-full object-contain"
              />
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setPreviewImage(null)}>
              إغلاق
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isDialogOpen}
        onOpenChange={open => {
          if (!open && isSavingItem) return;
          if (!open) resetForm();
          setIsDialogOpen(open);
        }}
      >
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
                  {" "}— الصيغة: كود التصنيف-تسلسل رقمي (مثال {String(((catalogNodes as CatalogNode[]).find(node => Number(node.id) === Number(selectedNode.id))?.code || codePreviewQuery.data?.nodeCode || selectedNode.code || "11")).trim()}-001)
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
                <span className="text-destructive text-xs mr-2">(إلزامي)</span>
              </label>
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setSelectedImage(file);
                  setImageUploadProgress(0);
                  setImageSaveStage("idle");
                  setImageSaveMessage(file ? "الصورة جاهزة للرفع عند الحفظ" : "");
                }}
                disabled={isSavingItem}
              />
              {editingItem?.primaryImageUrl && !selectedImage && (
                <p className="text-xs text-muted-foreground">الصورة الحالية محفوظة؛ لا يلزم رفعها مجددًا لتعديل بيانات الصنف.</p>
              )}
              {selectedImage && (
                <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate text-muted-foreground" title={selectedImage.name}>
                      {selectedImage.name}
                    </span>
                    {(imageSaveStage === "uploading" || imageSaveStage === "linking" || imageSaveStage === "success") && (
                      <span className="shrink-0 font-medium tabular-nums">{imageUploadProgress}%</span>
                    )}
                  </div>

                  {(imageSaveStage === "uploading" || imageSaveStage === "linking" || imageSaveStage === "success") && (
                    <Progress value={imageUploadProgress} className="h-2" />
                  )}

                  <div className={cn(
                    "flex items-start gap-2 text-xs",
                    imageSaveStage === "success" && "text-emerald-700",
                    imageSaveStage === "error" && "text-destructive",
                    imageSaveStage !== "success" && imageSaveStage !== "error" && "text-muted-foreground",
                  )}>
                    {imageSaveStage === "success" ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : imageSaveStage === "error" ? (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : imageSaveStage === "uploading" || imageSaveStage === "linking" ? (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                    ) : null}
                    <span>{imageSaveMessage || "الصورة جاهزة للرفع عند الحفظ"}</span>
                  </div>
                </div>
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
                {editingItem?.unit && !(units || []).some((u: any) => u.nameAr === editingItem.unit || u.nameEn === editingItem.unit) && (
                  <p className="text-xs text-amber-700">
                    الوحدة الحالية «{editingItem.unit}» غير نشطة/تاريخية. ستبقى محفوظة ما لم تختر وحدة نشطة جديدة.
                  </p>
                )}
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
              disabled={isSavingItem}
              className="w-full"
            >
              {isSavingItem && (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              )}
              {isSavingItem
                ? imageSaveStage === "uploading"
                  ? `رفع الصورة ${imageUploadProgress}%`
                  : imageSaveStage === "linking"
                    ? "حفظ الصورة..."
                    : t.common.saving
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
  categoryPath,
  canDelete,
  canReactivate,
  onDelete,
  onReactivate,
  onView,
  onImagePreview,
  onEdit,
  onDuplicate,
}: {
  item: any;
  categoryPath?: string;
  canDelete: boolean;
  canReactivate: boolean;
  onDelete: (id: number) => void;
  onReactivate: (id: number) => void;
  onView: (item: any) => void;
  onImagePreview: (item: any) => void;
  onEdit: (item: any) => void;
  onDuplicate: (item: any) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [bookOpen,setBookOpen] = useState(false);
  const canReadBook = user && ["owner","admin","warehouse","maintenance_manager","senior_management","observer"].includes(user.role);
  return (
    <Card className={cn("hover:shadow-md transition-shadow", Number(item.isActive) !== 1 && "opacity-80 border-dashed")}>
      <CardContent className="p-4">
        {item.primaryImageUrl ? (
          <button
            type="button"
            className="mb-3 flex h-28 w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={() => onImagePreview(item)}
            title="اضغط لعرض الصورة بالحجم الكامل"
          >
            <img
              src={item.primaryImageUrl}
              alt={item.nameAr}
              className="max-h-full max-w-full object-contain"
            />
          </button>
        ) : (
          <div className="mb-3 flex h-28 w-full items-center justify-center rounded-lg border border-dashed border-muted-foreground/20">
            <ImageIcon className="w-8 h-8 text-muted-foreground/30" />
          </div>
        )}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm">{item.nameAr}</p>
            {canReadBook && Number(item.inventoryPageCount)>0 && <Button variant="ghost" size="sm" aria-label="تفاصيل دفتر الصنف" aria-expanded={bookOpen} onClick={()=>setBookOpen(!bookOpen)}>{bookOpen ? <ChevronDown className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/>}</Button>}
            {Number(item.isActive) !== 1 && (
              <span className="text-[11px] font-medium rounded-full border px-2 py-0.5 text-muted-foreground">
                معطّل
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{item.nameEn}</p>
          {canReadBook && (item.inventoryBookTotals || []).map((total:any)=><p key={`${total.unit}:${total.isFrozen}`} className="text-xs">
            {Number(total.isFrozen)?"تاريخ مجمّد":"الرصيد"}: {Number(total.quantity)} {total.unit || "—"} · وارد {Number(total.incoming)} · منصرف {Number(total.outgoing)}
          </p>)}
          <div className="flex items-center justify-between">
            {item.code && (
              <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-0.5 rounded">{item.code}</span>
            )}
            {item.unit && <span className="text-xs text-muted-foreground">{item.unit}</span>}
          </div>
          {item.manufacturer && (
            <p className="text-xs text-muted-foreground">{t.catalog.fields.manufacturer}: {item.manufacturer}</p>
          )}
          {categoryPath && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground" title={categoryPath}>
              <FolderTree className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="line-clamp-2">{categoryPath}</span>
            </p>
          )}
        </div>

        {bookOpen && canReadBook && <InventoryBookPages catalogItemId={Number(item.id)} />}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => onView(item)}>
            <Eye className="w-3.5 h-3.5" />
            استعراض
          </Button>
          <Button variant="default" size="sm" className="gap-1.5" onClick={() => onEdit(item)}>
            <Pencil className="w-3.5 h-3.5" />
            تعديل
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onDuplicate(item)}>
            <Copy className="w-3.5 h-3.5" />
            {t.catalog.items.addFrom}
          </Button>
          {canDelete && Number(item.isActive) === 1 && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onDelete(item.id)}>
              <Trash2 className="w-3.5 h-3.5" />
              تعطيل
            </Button>
          )}
          {canReactivate && Number(item.isActive) !== 1 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => onReactivate(item.id)}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              إعادة تفعيل
            </Button>
          )}
        </div>

      </CardContent>
    </Card>
  );
}
