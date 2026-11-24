import { getCatalogItemsText } from "@/i18n/catalogItems";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronDown, ChevronRight, FolderTree, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type CatalogTreeNode = {
  id: number;
  parentId?: number | null;
  code?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
  nameUr?: string | null;
  sortOrder?: number | null;
};

export function getCatalogSubtreeNodeIds(nodes: CatalogTreeNode[], rootId: number): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const parentId = Number(node.parentId);
    const children = childrenByParent.get(parentId) || [];
    children.push(Number(node.id));
    childrenByParent.set(parentId, children);
  }

  const result: number[] = [];
  const queue = [Number(rootId)];
  const visited = new Set<number>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    result.push(currentId);
    for (const childId of childrenByParent.get(currentId) || []) queue.push(childId);
  }

  return result;
}

function nodeLabel(node: CatalogTreeNode, language: string): string {
  if (language === "en") return node.nameEn || node.nameAr || node.nameUr || `#${node.id}`;
  if (language === "ur") return node.nameUr || node.nameAr || node.nameEn || `#${node.id}`;
  return node.nameAr || node.nameEn || node.nameUr || `#${node.id}`;
}

export function getCatalogNodePath(
  nodes: CatalogTreeNode[],
  nodeId: number | null | undefined,
): CatalogTreeNode[] {
  if (!nodeId) return [];
  const nodeById = new Map(nodes.map(node => [Number(node.id), node]));
  const path: CatalogTreeNode[] = [];
  const visited = new Set<number>();
  let current = nodeById.get(Number(nodeId));

  while (current && !visited.has(Number(current.id))) {
    path.push(current);
    visited.add(Number(current.id));
    current = current.parentId ? nodeById.get(Number(current.parentId)) : undefined;
  }

  return path.reverse();
}

export function getCatalogNodePathLabel(
  nodes: CatalogTreeNode[],
  nodeId: number | null | undefined,
  language: string,
): string {
  return getCatalogNodePath(nodes, nodeId)
    .map(node => nodeLabel(node, language))
    .join(language === "en" ? " > " : " › ");
}

export default function CatalogTreeFilter({
  nodes,
  value,
  onChange,
  language,
}: {
  nodes: CatalogTreeNode[];
  value: number | null;
  onChange: (nodeId: number | null) => void;
  language: string;
}) {
  const text = getCatalogItemsText(language);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());

  const nodeById = useMemo(
    () => new Map(nodes.map(node => [Number(node.id), node])),
    [nodes],
  );

  const childrenByParent = useMemo(() => {
    const map = new Map<number | null, CatalogTreeNode[]>();
    for (const node of nodes) {
      const rawParentId = node.parentId ? Number(node.parentId) : null;
      const parentId = rawParentId && nodeById.has(rawParentId) ? rawParentId : null;
      const list = map.get(parentId) || [];
      list.push(node);
      map.set(parentId, list);
    }

    for (const list of map.values()) {
      list.sort((a, b) => {
        const sortDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
        if (sortDiff) return sortDiff;
        const codeDiff = String(a.code || "").localeCompare(String(b.code || ""), undefined, { numeric: true });
        if (codeDiff) return codeDiff;
        return nodeLabel(a, language).localeCompare(nodeLabel(b, language), language === "en" ? "en" : "ar");
      });
    }

    return map;
  }, [nodes, nodeById, language]);

  const selectedPath = useMemo(
    () => getCatalogNodePath(nodes, value),
    [nodes, value],
  );
  const selectedPathLabel = selectedPath.map(node => nodeLabel(node, language)).join(language === "en" ? " > " : " › ");

  const normalizedSearch = search.trim().toLowerCase();
  const visibleNodeIds = useMemo(() => {
    if (!normalizedSearch) return null;
    const visible = new Set<number>();

    const addAncestors = (node: CatalogTreeNode) => {
      const visited = new Set<number>();
      let current: CatalogTreeNode | undefined = node;
      while (current && !visited.has(Number(current.id))) {
        visible.add(Number(current.id));
        visited.add(Number(current.id));
        current = current.parentId ? nodeById.get(Number(current.parentId)) : undefined;
      }
    };

    const addDescendants = (nodeId: number) => {
      const queue = [nodeId];
      const visited = new Set<number>();
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        visible.add(currentId);
        for (const child of childrenByParent.get(currentId) || []) queue.push(Number(child.id));
      }
    };

    for (const node of nodes) {
      const haystack = `${node.nameAr || ""} ${node.nameEn || ""} ${node.nameUr || ""} ${node.code || ""}`.toLowerCase();
      if (!haystack.includes(normalizedSearch)) continue;
      addAncestors(node);
      addDescendants(Number(node.id));
    }

    return visible;
  }, [nodes, normalizedSearch, nodeById, childrenByParent]);

  const toggleExpanded = (nodeId: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const chooseNode = (nodeId: number | null) => {
    onChange(nodeId);
    setOpen(false);
  };

  const renderNode = (node: CatalogTreeNode, depth: number): ReactNode => {
    const nodeId = Number(node.id);
    if (visibleNodeIds && !visibleNodeIds.has(nodeId)) return null;

    const children = childrenByParent.get(nodeId) || [];
    const hasChildren = children.length > 0;
    const expanded = !!normalizedSearch || expandedIds.has(nodeId);
    const selected = value === nodeId;

    return (
      <div key={nodeId}>
        <div
          className={cn(
            "mb-1 flex items-center gap-1 rounded-md border px-1.5 py-1 transition-colors",
            selected
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-transparent hover:border-border hover:bg-muted/50",
          )}
          style={{ paddingInlineStart: `${depth * 16 + 6}px` }}
        >
          <button
            type="button"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-muted disabled:opacity-30"
            disabled={!hasChildren}
            onClick={() => hasChildren && toggleExpanded(nodeId)}
            aria-label={expanded ? text.collapseCategory : text.expandCategory}
          >
            {hasChildren
              ? (expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)
              : <span className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() => chooseNode(nodeId)}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-1 py-1 text-start"
            title={hasChildren ? text.categoryIncludesDescendants : text.chooseCategory}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {node.code ? `${node.code} · ` : ""}{nodeLabel(node, language)}
              </span>
              {hasChildren && (
                <span className="block text-[11px] text-muted-foreground">{text.includesDescendants}</span>
              )}
            </span>
            {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </button>
        </div>

        {hasChildren && expanded && children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  const roots = childrenByParent.get(null) || [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full min-h-10 justify-between gap-2 font-normal">
          <span className="flex min-w-0 items-center gap-2">
            <FolderTree className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className={cn("truncate", !selectedPathLabel && "text-muted-foreground")}>
              {selectedPathLabel || text.allItemTree}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent dir={language === "en" ? "ltr" : "rtl"} className="w-[min(520px,calc(100vw-2rem))] p-3" align="start">
        <div className="space-y-2">
          <div>
            <p className="text-sm font-semibold">{text.treeSearchTitle}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{text.treeSearchHelp}</p>
          </div>

          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={text.treeSearchPlaceholder}
            className="h-9"
          />

          {value !== null && (
            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-2 text-xs">
              <span className="min-w-0 truncate">
                <span className="font-semibold">{text.selectedCategory}</span> {selectedPathLabel || `#${value}`}
              </span>
              <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 gap-1" onClick={() => chooseNode(null)}>
                <X className="h-3.5 w-3.5" />
                {text.all}
              </Button>
            </div>
          )}

          <div className="max-h-80 overflow-y-auto rounded-md border bg-background p-2">
            {roots.length === 0 ? (
              <p className="py-5 text-center text-sm text-muted-foreground">{text.noActiveCategories}</p>
            ) : visibleNodeIds && visibleNodeIds.size === 0 ? (
              <p className="py-5 text-center text-sm text-muted-foreground">{text.noMatchingCategory}</p>
            ) : (
              roots.map(node => renderNode(node, 0))
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
