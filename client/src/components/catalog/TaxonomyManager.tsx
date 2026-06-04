import React, { useState, useCallback } from "react";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Edit2, Trash2, ChevronRight, Loader2, FolderPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────────
interface TreeNode {
  id: number;
  code: string | null;
  nameAr: string;
  nameEn: string;
  nameUr?: string | null;
  level: number;
  parentId?: number | null;
  isActive: boolean;
}

type DialogMode = "addRoot" | "addChild" | "edit" | null;

// ── Main Component ─────────────────────────────────────────────────────────
export default function TaxonomyManager() {
  const { t } = useTranslation();
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set());
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [formData, setFormData] = useState({ nameAr: "", nameEn: "", nameUr: "", code: "" });
  const [codeError, setCodeError] = useState("");

  // ── Queries ──────────────────────────────────────────────────────────────
  // جلب جميع التصنيفات ثم نفلتر الجذور في الفرونت
  const { data: allNodes, isLoading, refetch } = trpc.catalog.nodes.list.useQuery({});
  const roots = (allNodes || []).filter((n: any) => !n.parentId || n.parentId === null || n.parentId === 0);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMut = trpc.catalog.nodes.create.useMutation({
    onSuccess: () => { refetch(); closeDialog(); toast.success("تم إضافة التصنيف"); },
    onError: (e) => toast.error(e.message),
  });

  const updateMut = trpc.catalog.nodes.update.useMutation({
    onSuccess: () => { refetch(); closeDialog(); toast.success("تم تعديل التصنيف"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = trpc.catalog.nodes.delete.useMutation({
    onSuccess: () => { refetch(); setSelectedNode(null); toast.success("تم حذف التصنيف"); },
    onError: (e) => toast.error(e.message),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  const closeDialog = () => {
    setDialogMode(null);
    setFormData({ nameAr: "", nameEn: "", nameUr: "", code: "" });
    setCodeError("");
  };

  const openAddRoot = () => {
    setSelectedNode(null);
    setFormData({ nameAr: "", nameEn: "", nameUr: "", code: "" });
    setDialogMode("addRoot");
  };

  const openAddChild = (parent: TreeNode) => {
    setSelectedNode(parent);
    setFormData({ nameAr: "", nameEn: "", nameUr: "", code: "" });
    setDialogMode("addChild");
  };

  const openEdit = (node: TreeNode) => {
    setSelectedNode(node);
    setFormData({
      nameAr: node.nameAr,
      nameEn: node.nameEn,
      nameUr: node.nameUr || "",
      code: node.code || "",
    });
    setDialogMode("edit");
  };

  const validateCode = (val: string) => {
    if (val && !/^\d+$/.test(val)) {
      setCodeError("الكود يجب أن يحتوي على أرقام فقط");
      return false;
    }
    setCodeError("");
    return true;
  };

  const toggleExpand = useCallback((nodeId: number) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId);
      return next;
    });
  }, []);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!formData.nameAr || !formData.nameEn) {
      toast.error("الاسم بالعربية والإنجليزية مطلوبان");
      return;
    }
    if (!validateCode(formData.code)) return;

    if (dialogMode === "edit" && selectedNode) {
      await updateMut.mutateAsync({
        id: selectedNode.id,
        nameAr: formData.nameAr,
        nameEn: formData.nameEn,
        nameUr: formData.nameUr || undefined,
        code: formData.code || undefined,
      });
    } else {
      const parentLevel = selectedNode?.level || 0;
      if (parentLevel >= 6) {
        toast.error("الحد الأقصى للمستويات هو 6");
        return;
      }
      await createMut.mutateAsync({
        nameAr: formData.nameAr,
        nameEn: formData.nameEn,
        nameUr: formData.nameUr || undefined,
        code: formData.code || undefined,
        parentId: selectedNode?.id ? Number(selectedNode.id) : undefined,
        level: parentLevel + 1,
      });
    }
  };

  const handleDelete = async (node: TreeNode) => {
    if (!confirm(`هل أنت متأكد من حذف "${node.nameAr}"؟\nلا يمكن الحذف إذا كان فيه فروع أو أصناف مرتبطة.`)) return;
    await deleteMut.mutateAsync(node.id);
  };

  // ── Dialog Title ───────────────────────────────────────────────────────────
  const dialogTitle =
    dialogMode === "addRoot" ? "إضافة تصنيف رئيسي" :
    dialogMode === "addChild" ? `إضافة فرع تحت: ${selectedNode?.nameAr}` :
    dialogMode === "edit" ? `تعديل: ${selectedNode?.nameAr}` : "";

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t.catalog.taxonomy.title}</h3>
        <Button size="sm" className="gap-2" onClick={openAddRoot}>
          <Plus className="w-4 h-4" />
          {t.catalog.taxonomy.addRoot}
        </Button>
      </div>

      {/* Tree */}
      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : roots && roots.length > 0 ? (
            <div className="space-y-1">
              {roots.map(node => (
                <TreeNodeItem
                  key={node.id}
                  node={node as TreeNode}
                  allNodes={(allNodes || []) as TreeNode[]}
                  isExpanded={expandedNodes.has(node.id)}
                  expandedNodes={expandedNodes}
                  onToggle={toggleExpand}
                  onAddChild={openAddChild}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <FolderPlus className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>{t.catalog.taxonomy.empty}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={openAddRoot}>
                إضافة أول تصنيف
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog */}
      <Dialog open={!!dialogMode} onOpenChange={() => closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">

            {/* الكود */}
            <div className="space-y-1">
              <label className="text-sm font-medium">
                الكود
                <span className="text-muted-foreground text-xs mr-2">(يُولَّد تلقائياً إذا تُرك فارغاً)</span>
              </label>
              <Input
                value={formData.code}
                onChange={e => {
                  setFormData({ ...formData, code: e.target.value });
                  validateCode(e.target.value);
                }}
                placeholder={
                  dialogMode === "addRoot" ? "مثال: 1" :
                  dialogMode === "addChild" ? `مثال: ${selectedNode?.code || ""}1` :
                  selectedNode?.code || ""
                }
                dir="ltr"
                className={cn(codeError && "border-red-500")}
              />
              {codeError && <p className="text-xs text-red-500">{codeError}</p>}
              {dialogMode !== "edit" && (
                <p className="text-xs text-muted-foreground">
                  أرقام فقط — النظام سيولد الكود تلقائياً إذا تركته فارغاً
                </p>
              )}
            </div>

            {/* الاسم بالعربية */}
            <div className="space-y-1">
              <label className="text-sm font-medium">{t.catalog.fields.nameAr} *</label>
              <Input
                value={formData.nameAr}
                onChange={e => setFormData({ ...formData, nameAr: e.target.value })}
                placeholder="مثال: قطع ميكانيكية"
                dir="rtl"
              />
            </div>

            {/* الاسم بالإنجليزية */}
            <div className="space-y-1">
              <label className="text-sm font-medium">{t.catalog.fields.nameEn} *</label>
              <Input
                value={formData.nameEn}
                onChange={e => setFormData({ ...formData, nameEn: e.target.value })}
                placeholder="Example: Mechanical Parts"
                dir="ltr"
              />
            </div>

            {/* الاسم بالأردية */}
            <div className="space-y-1">
              <label className="text-sm font-medium">
                {t.catalog.fields.nameUr}
                <span className="text-muted-foreground text-xs mr-2">(اختياري)</span>
              </label>
              <Input
                value={formData.nameUr}
                onChange={e => setFormData({ ...formData, nameUr: e.target.value })}
                placeholder="اختياري"
              />
            </div>

            <Button onClick={handleSubmit} disabled={isPending} className="w-full">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {isPending ? t.common.saving : t.common.save}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Tree Node Item ─────────────────────────────────────────────────────────
interface TreeNodeItemProps {
  node: TreeNode;
  allNodes: TreeNode[];
  isExpanded: boolean;
  expandedNodes: Set<number>;
  onToggle: (id: number) => void;
  onAddChild: (node: TreeNode) => void;
  onEdit: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
  depth?: number;
}

function TreeNodeItem({
  node, allNodes, isExpanded, expandedNodes, onToggle, onAddChild, onEdit, onDelete, depth = 0
}: TreeNodeItemProps) {
  const children = (allNodes || []).filter(n => Number(n.parentId) === Number(node.id));
  const hasChildren = children.length > 0;
  const canAddChild = node.level < 6;

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 py-1.5 px-2 rounded-lg transition-colors hover:bg-muted/50",
        )}
        style={{ paddingRight: `${depth * 20 + 8}px` }}
      >
        {/* زر التوسع */}
        <button
          onClick={() => onToggle(node.id)}
          className={cn(
            "w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors shrink-0",
            !hasChildren && "invisible"
          )}
        >
          <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", isExpanded && "rotate-90")} />
        </button>

        {/* الكود */}
        <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground shrink-0 min-w-[2.5rem] text-center">
          {node.code || "—"}
        </span>

        {/* الاسم */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium truncate">{node.nameAr}</span>
          <span className="text-xs text-muted-foreground mr-2 truncate">{node.nameEn}</span>
        </div>

        {/* مستوى */}
        <span className="text-xs text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          م{node.level}
        </span>

        {/* أزرار الإجراءات */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {canAddChild && (
            <button
              onClick={e => { e.stopPropagation(); onAddChild(node); }}
              className="p-1 rounded hover:bg-green-100 hover:text-green-700 transition-colors"
              title="إضافة فرع"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={e => { e.stopPropagation(); onEdit(node); }}
            className="p-1 rounded hover:bg-blue-100 hover:text-blue-700 transition-colors"
            title="تعديل"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(node); }}
            className="p-1 rounded hover:bg-red-100 hover:text-red-700 transition-colors"
            title="حذف"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* الأبناء */}
      {isExpanded && hasChildren && (
        <div className="border-r-2 border-muted mr-4">
          {children.map(child => (
            <TreeNodeItem
              key={child.id}
              node={child as TreeNode}
              allNodes={allNodes}
              isExpanded={expandedNodes.has(child.id)}
              expandedNodes={expandedNodes}
              onToggle={onToggle}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onDelete={onDelete}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
