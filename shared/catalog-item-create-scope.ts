import { APP_ROLE } from "./roles";

export type ScopeNode = {
  id: number;
  parentId: number | null;
  code?: string | null;
  level?: number | null;
};

export const IT_CATALOG_CREATION_DENIED =
  "يمكن لمدير تقنية المعلومات إضافة أصناف جديدة ضمن تصنيف تقنية المعلومات (10) وتفرعاته فقط";

/** Identity is the canonical root record, never its ID, display name or a prefix. */
export function isItCatalogCreationRoot(
  node:
    | {
        code?: string | null;
        level?: number | null;
        parentId?: number | null;
      }
    | null
    | undefined
): boolean {
  return node?.code === "10" && node.level === 1 && node.parentId === null;
}

/** Presentation scope for new items only. Existing item reads/edits are unrestricted. */
export function getCatalogCreationNodeIds(
  role: string | undefined,
  nodes: readonly ScopeNode[]
): Set<number> | null {
  if (role !== APP_ROLE.IT_MANAGER) return null;
  const roots = nodes.filter(isItCatalogCreationRoot);
  if (roots.length !== 1) return new Set();
  const byId = new Map<number, ScopeNode>();
  const children = new Map<number, number[]>();
  for (const node of nodes) {
    if (!Number.isSafeInteger(node.id) || node.id <= 0 || byId.has(node.id))
      return new Set();
    byId.set(node.id, node);
    if (node.parentId !== null) {
      const group = children.get(node.parentId) ?? [];
      group.push(node.id);
      children.set(node.parentId, group);
    }
  }
  const allowed = new Set<number>();
  const pending = [roots[0].id];
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    if (allowed.has(id)) continue;
    allowed.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return allowed;
}
