import { trpc } from "@/lib/trpc";
import { independentReadOptions } from "@/lib/read-transport";
import { useTranslation } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BookOpen, Search, ChevronDown, ChevronRight, FolderOpen, Loader2, Plus } from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { getLocalizedCatalogDescription, getLocalizedCatalogName, getLocalizedCatalogUnitName } from "@/i18n/catalogMasterData";

// ── Catalog Item Picker Dialog ─────────────────────────────────────────────
interface CatalogNode {
  id: number;
  code: string | null;
  nameAr: string;
  nameEn: string;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  level: number;
  parentId: number | null;
}

export function CatalogPickerDialog({
  open,
  onClose,
  onSelect,
  requiredUnit,
  onCreateNew,
  suspended = false,
  refreshKey = 0,
}: {
  open: boolean;
  /** Opt-in shortcut used only by the purchase-order form. */
  onCreateNew?: () => void;
  suspended?: boolean;
  refreshKey?: number;
  /** Matching material needs keeps the existing exact-unit rule. */
  requiredUnit?: string;
  onClose: () => void;
onSelect: (item: {
  id: number;
  nameAr: string;
  nameEn: string;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  primaryImageUrl?: string;
  unit?: string;
}) => void;
}) {
  const { t, language, dir, isRTL } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const lastRefreshKey = useRef(refreshKey);
  const pickerVisible = open && !suspended;

  useEffect(() => {
    if (lastRefreshKey.current === refreshKey) return;
    lastRefreshKey.current = refreshKey;
    // A new item may belong to another category; keep the typed search usable.
    setSelectedNodeId(null);
  }, [refreshKey]);

  // debounce: انتظر 350ms بعد توقف الكتابة ثم ابعث للسيرفر
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const { data: allNodes, error: nodesError, refetch: refetchNodes, isFetching: nodesFetching } = trpc.catalog.nodes.list.useQuery(
    { isActive: true },
    { enabled: pickerVisible, retry: false, ...independentReadOptions }
  );

  const { data: catalogUnits, error: unitsError, refetch: refetchUnits, isFetching: unitsFetching } = trpc.catalog.units.list.useQuery(undefined, { enabled: pickerVisible, retry: false, ...independentReadOptions });

  // جمع ID التصنيف المختار + كل أحفاده بشكل تكراري
  const getDescendantIds = (nodeId: number, nodes: CatalogNode[]): number[] => {
    const children = nodes.filter(n => n.parentId === nodeId);
    return [nodeId, ...children.flatMap(c => getDescendantIds(c.id, nodes))];
  };

  const selectedNodeIds = useMemo(() => {
    if (!selectedNodeId || !allNodes) return undefined;
    return getDescendantIds(selectedNodeId, allNodes);
  }, [selectedNodeId, allNodes]);

  // ✅ البحث على السيرفر — يجلب فقط ما يطابق البحث أو التصنيف المختار
  const { data: serverItems, isFetching, error: itemsError, refetch: refetchItems } = trpc.catalog.items.list.useQuery(
    {
      isActive: true,
      limit: 80,
      search: debouncedSearch || undefined,
      nodeIds: selectedNodeIds,
    },
    { enabled: pickerVisible, retry: false, ...independentReadOptions }
  );

  const catalogError = itemsError || nodesError || unitsError;
  const accessDenied = [itemsError, nodesError, unitsError].some(error =>
    error?.data?.code === "FORBIDDEN" || error?.data?.code === "UNAUTHORIZED"
  );
  const retrying = isFetching || nodesFetching || unitsFetching;
  const retryFailedQueries = () => {
    if (nodesError) void refetchNodes();
    if (unitsError) void refetchUnits();
    if (itemsError) void refetchItems();
  };

  // إعادة ضبط الحالة عند كل فتح للنافذة
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setSearchQuery("");
      setDebouncedSearch("");
      setSelectedNodeId(null);
    }
  }, [open]);

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

  const items = (serverItems || []).filter((item: any) => requiredUnit === undefined || item.unit === requiredUnit);

  const renderNode = (node: CatalogNode, depth = 0): React.ReactNode => {
    const children = getChildren(node.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isSelected = selectedNodeId === node.id;

    return (
      <div key={node.id}>
        <div
          className={cn(
            "flex items-center gap-1.5 py-1.5 px-2 rounded cursor-pointer hover:bg-muted/60 transition-colors text-sm",
            isSelected && "bg-primary/10 text-primary font-medium"
          )}
          style={isRTL ? { paddingRight: `${depth * 14 + 8}px` } : { paddingLeft: `${depth * 14 + 8}px` }}
          onClick={() => setSelectedNodeId(isSelected ? null : node.id)}
        >
          <button
            onClick={e => toggle(node.id, e)}
            className={cn("w-4 h-4 shrink-0 text-muted-foreground", !hasChildren && "invisible")}
          >
            {isExpanded
              ? <ChevronDown className="w-3.5 h-3.5" />
              : <ChevronRight className={`w-3.5 h-3.5 ${isRTL ? "rotate-180" : ""}`} />}
          </button>
          {node.code && (
            <span className="text-xs font-mono bg-muted px-1 py-0.5 rounded text-muted-foreground shrink-0">
              {node.code}
            </span>
          )}
          <span className="truncate" dir={language === "ar" ? "rtl" : "ltr"}>{getLocalizedCatalogName(node, language)}</span>
        </div>
        {isExpanded && hasChildren && (
          <div>{children.map(child => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={pickerVisible} onOpenChange={o => { if (!o && !suspended) onClose(); }}>
      <DialogContent dir={language === "en" ? "ltr" : "rtl"} style={onCreateNew ? { width: "min(42rem, calc(100vw - 2rem))", minWidth: 0 } : undefined} className="!max-w-none w-[42rem] max-h-[85vh] flex flex-col p-0 resize overflow-auto min-w-[320px] min-h-[300px]">
        <DialogHeader style={onCreateNew ? { paddingRight: "3rem" } : undefined} className={cn("px-5 pt-5 pb-3 border-b", onCreateNew && "flex-row items-center justify-between gap-2 text-start")}>
          <DialogTitle className={cn("flex items-center gap-2", onCreateNew && "min-w-0 text-sm sm:text-lg")}>
            <BookOpen className="w-4 h-4 shrink-0 text-primary" />
            {t.workflow.purchase.catalogPickItem}
          </DialogTitle>
          {onCreateNew && (
            <Button type="button" size="sm" variant="outline" className="shrink-0 gap-1.5 text-xs sm:text-sm" onClick={onCreateNew}>
              <Plus className="w-4 h-4" />
              {t.workflow.purchase.catalogCreateItem}
            </Button>
          )}
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">

          {/* Sidebar — شجرة التصنيفات */}
          <div style={onCreateNew ? { width: "clamp(7rem, 28vw, 12rem)" } : undefined} className={`w-48 shrink-0 overflow-y-auto p-2 bg-muted/20 ${isRTL ? "border-l" : "border-r"}`}>
            <p className="text-xs text-muted-foreground px-2 pb-2 font-medium">{t.workflow.purchase.categoriesLabel}</p>
            <button
              onClick={() => setSelectedNodeId(null)}
              className={cn(
                "w-full text-start text-sm px-2 py-1.5 rounded hover:bg-muted/60 transition-colors",
                !selectedNodeId && "bg-primary/10 text-primary font-medium"
              )}
            >
              {t.common.all}
            </button>
            {roots.map(node => renderNode(node))}
          </div>

          {/* Main — البحث والنتائج */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Search */}
            <div className="p-3 border-b">
              <div className="relative">
                <Search className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground ${isRTL ? "right-3" : "left-3"}`} />
                <Input
                  ref={inputRef}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={t.common.searchPlaceholder}
                  className={isRTL ? "pr-9" : "pl-9"}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 h-4">
                {isFetching
                  ? t.common.loading
                  : items.length > 0
                    ? `${items.length} ${t.purchaseOrders.items}`
                    : ""}
              </p>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {catalogError && (
                <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive space-y-2">
                  <p>{accessDenied ? t.workflow.purchase.catalogAccessDenied : t.workflow.purchase.catalogLoadFailed}</p>
                  <Button type="button" variant="outline" size="sm" disabled={retrying} onClick={retryFailedQueries}>
                    {t.workflow.purchase.catalogRetry}
                  </Button>
                </div>
              )}
              {isFetching && !serverItems ? (
                <div className="text-center py-10 text-sm text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                  {t.common.loading}
                </div>
              ) : itemsError ? null : items.length === 0 ? (
                <div className="text-center py-10 text-sm text-muted-foreground">
                  {t.common.noData}
                </div>
              ) : (
                items.map((item: any) => (
                  <button
                    key={item.id}
                    onClick={() => {
                        onSelect({
                          id: item.id,
                          nameAr: item.nameAr,
                          nameEn: item.nameEn,
                          descriptionAr: item.descriptionAr,
                          descriptionEn: item.descriptionEn,
                          primaryImageUrl: item.primaryImageUrl || "",
                          unit: item.unit || "",
                        });

                      onClose();
                    }}

                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-primary/5 hover:border-primary/20 border border-transparent transition-colors text-start"
                  >
                    {/* صورة */}
                    <div className="w-10 h-10 rounded-md bg-muted shrink-0 overflow-hidden flex items-center justify-center">
                      {item.primaryImageUrl ? (
                        <img src={item.primaryImageUrl} alt={getLocalizedCatalogName(item, language)} className="w-full h-full object-cover" />
                      ) : (
                        <FolderOpen className="w-4 h-4 text-muted-foreground/40" />
                      )}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0 text-start">
                      <p className="text-sm font-medium truncate" dir={language === "ar" ? "rtl" : "ltr"}>{getLocalizedCatalogName(item, language)}</p>
                      {getLocalizedCatalogDescription(item, language) ? (
                        <p className="text-xs text-muted-foreground truncate" dir={language === "ar" ? "rtl" : "ltr"}>{getLocalizedCatalogDescription(item, language)}</p>
                      ) : getLocalizedCatalogUnitName(item.unit, catalogUnits as any[] | undefined, language) ? (
                        <p className="text-xs text-muted-foreground truncate" dir={language === "ar" ? "rtl" : "ltr"}>{getLocalizedCatalogUnitName(item.unit, catalogUnits as any[] | undefined, language)}</p>
                      ) : null}
                    </div>
                    {/* Code */}
                    {item.code && (
                      <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground shrink-0">
                        {item.code}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


export type CatalogPickerSelection = Parameters<Parameters<typeof CatalogPickerDialog>[0]["onSelect"]>[0];
