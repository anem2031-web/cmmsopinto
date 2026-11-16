import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { documentSearchPattern } from "../../../shared/document-list";
import { normalizePmv2MaterialUnit } from "../../../shared/pmv2MaterialQuantity";
import {
  groupReadRows,
  READ_SCOPE_CHUNK_SIZE,
} from "../../_core/authz/read-batch";

type Locale = "ar" | "en" | "ur";
export type CatalogIntegrationQuery = {
  q: string;
  page: number;
  pageSize: number;
  locale: Locale;
  ids?: number[];
  nodeId?: number;
};

export interface CatalogIntegrationDatabase {
  execute(statement: SQL): PromiseLike<unknown>;
}

type ItemRow = {
  id: number;
  code: string | null;
  nameAr: string | null;
  nameEn: string | null;
  nameUr: string | null;
  unit: string | null;
  total?: number | string;
};
type UnitRow = { id: number; nameAr: string; nameEn: string };
type CatalogNodeRow = {
  id: number;
  parentId: number | null;
  code: string | null;
  nameAr: string;
  nameEn: string;
  nameUr: string | null;
};
type ImageRow = { itemId: number; attachmentId: number };
type SpecificationRow = {
  itemId: number;
  specKeyAr: string;
  specKeyEn: string;
  specKeyUr: string;
  specValue: string | null;
  specUnit: string | null;
};

const usableInPscm = sql`i.code REGEXP '[^[:space:]]' AND i.unit REGEXP '[^[:space:]]'
  AND (i.nameAr REGEXP '[^[:space:]]' OR i.nameEn REGEXP '[^[:space:]]' OR i.nameUr REGEXP '[^[:space:]]')`;
const catalogImage = sql`a.entityType='catalog_item' AND a.fileKey LIKE 'cmms/%' AND (
  LOWER(a.mimeType) IN ('image/jpeg','image/png','image/webp','image/gif','image/bmp','image/tiff') OR
  LOWER(a.fileName) REGEXP '[.](jpe?g|png|webp|gif|bmp|tiff?)$'
)`;

const commonUnits = [
  {
    code: "PCS",
    nameAr: "حبة",
    nameEn: "Piece",
    nameUr: "عدد",
    aliases: ["حبات", "قطعة", "قطع", "pc", "pieces", "ea", "each"],
  },
  {
    code: "KG",
    nameAr: "كجم",
    nameEn: "Kilogram",
    nameUr: "کلوگرام",
    aliases: ["كغ", "كيلو جرام", "كيلوغرام", "كيلوجرام", "kilograms"],
  },
  {
    code: "TON",
    nameAr: "طن",
    nameEn: "Ton",
    nameUr: "ٹن",
    aliases: ["tonne", "tonnes", "metric ton"],
  },
  {
    code: "L",
    nameAr: "لتر",
    nameEn: "Litre",
    nameUr: "لیٹر",
    aliases: ["liter", "litres", "liters"],
  },
  {
    code: "M",
    nameAr: "متر",
    nameEn: "Metre",
    nameUr: "میٹر",
    aliases: ["meter", "metres", "meters"],
  },
  {
    code: "M2",
    nameAr: "متر مربع",
    nameEn: "Square metre",
    nameUr: "مربع میٹر",
    aliases: ["m²", "square meter", "م²", "م2"],
  },
  {
    code: "M3",
    nameAr: "متر مكعب",
    nameEn: "Cubic metre",
    nameUr: "مکعب میٹر",
    aliases: ["m³", "cubic meter", "م³", "م3"],
  },
  {
    code: "BOX",
    nameAr: "كرتون",
    nameEn: "Box",
    nameUr: "ڈبہ",
    aliases: ["كرتونة", "carton", "boxes"],
  },
  {
    code: "BAG",
    nameAr: "كيس",
    nameEn: "Bag",
    nameUr: "تھیلا",
    aliases: ["أكياس", "bags"],
  },
  {
    code: "SET",
    nameAr: "مجموعة",
    nameEn: "Set",
    nameUr: "سیٹ",
    aliases: ["طقم", "sets"],
  },
];

const unitByLabel = new Map(
  commonUnits.flatMap(({ aliases, ...unit }) =>
    [unit.code, unit.nameAr, unit.nameEn, ...aliases].map(
      label => [normalizePmv2MaterialUnit(label), unit] as const
    )
  )
);

async function rows<T>(db: CatalogIntegrationDatabase, statement: SQL) {
  const result = await db.execute(statement);
  if (!Array.isArray(result) || !Array.isArray(result[0])) {
    throw new Error("Invalid catalog database response");
  }
  return result[0] as T[];
}

function localized(
  ar: string | null,
  en: string | null,
  ur: string | null,
  locale: Locale
) {
  const names = { ar, en, ur };
  const preferred = names[locale]?.trim();
  return preferred || ar?.trim() || en?.trim() || ur?.trim() || null;
}

function formatUnit(value: string | null, units: ReadonlyMap<string, UnitRow>) {
  const label = value?.trim();
  if (!label) return null;
  const normalized = normalizePmv2MaterialUnit(label);
  const registered = units.get(normalized);
  const nameAr = registered?.nameAr.trim() || label;
  const nameEn = registered?.nameEn.trim() || label;
  const standard =
    unitByLabel.get(normalized) ??
    unitByLabel.get(normalizePmv2MaterialUnit(nameAr)) ??
    unitByLabel.get(normalizePmv2MaterialUnit(nameEn));
  const source = registered
    ? `UNIT_` + registered.id
    : `TEXT_` +
      createHash("sha256")
        .update(normalized)
        .digest("hex")
        .slice(0, 24)
        .toUpperCase();
  const id = "CMMS_" + source;
  const isArabic = /[\u0600-\u06ff]/.test(label);
  return {
    id,
    code: id,
    nameAr: registered || isArabic ? nameAr : (standard?.nameAr ?? nameAr),
    nameEn: registered || !isArabic ? nameEn : (standard?.nameEn ?? nameEn),
    nameUr: standard?.nameUr ?? nameEn,
  };
}

function appendSpecification(existing: string, line: string) {
  const combined = existing ? existing + "\n" + line : line;
  const bounded = combined.slice(0, 5000).replace(/[\uD800-\uDBFF]$/, "");
  // Keep even a full page within the PSCM provider's JSON size limit.
  if (Buffer.byteLength(bounded) <= 6250) return bounded;
  const bytes = Buffer.from(bounded);
  let limit = 6250;
  while ((bytes[limit] & 0xc0) === 0x80) limit--;
  return bytes.subarray(0, limit).toString("utf8");
}

async function activeCatalogNodeGroups(db: CatalogIntegrationDatabase) {
  const activeNodes = await rows<CatalogNodeRow>(
    db,
    sql`SELECT id,parentId,code,nameAr,nameEn,nameUr FROM catalog_nodes
      WHERE isActive=1 AND id>0 ORDER BY sortOrder,id`
  );
  return groupReadRows(activeNodes, node => node.parentId ?? 0);
}

function catalogDescendants(
  nodesByParent: Map<number, CatalogNodeRow[]>,
  parentId: number
) {
  const pending = [...(nodesByParent.get(parentId) ?? [])];
  for (const node of pending) {
    for (const child of nodesByParent.get(node.id) ?? []) pending.push(child);
  }
  return pending;
}

export async function readCatalogIntegrationTree(
  db: CatalogIntegrationDatabase,
  locale: Locale
) {
  const nodesByParent = await activeCatalogNodeGroups(db);
  const nodes = catalogDescendants(nodesByParent, 0).map(
    ({ id, parentId, code: recordedCode, nameAr, nameEn, nameUr }) => {
      const code = recordedCode?.trim() || null;
      return {
        id,
        parentId: parentId || null,
        code,
        name: localized(nameAr, nameEn, nameUr, locale) ?? code ?? String(id),
      };
    }
  );
  return { nodes };
}

async function catalogBranchFilter(
  db: CatalogIntegrationDatabase,
  nodeId: number
) {
  const nodesByParent = await activeCatalogNodeGroups(db);
  // As in the picker, an active category needs a visible path from a root.
  if (!catalogDescendants(nodesByParent, 0).some(node => node.id === nodeId))
    return null;
  const ids = [
    nodeId,
    ...catalogDescendants(nodesByParent, nodeId).map(node => node.id),
  ];
  const chunks: SQL[] = [];
  for (let start = 0; start < ids.length; start += READ_SCOPE_CHUNK_SIZE) {
    const values = ids.slice(start, start + READ_SCOPE_CHUNK_SIZE);
    chunks.push(
      sql`i.nodeId IN (${sql.join(
        values.map(id => sql`${id}`),
        sql`, `
      )})`
    );
  }
  return sql`(${sql.join(chunks, sql` OR `)})`;
}

export async function readCatalogIntegration(
  db: CatalogIntegrationDatabase,
  input: CatalogIntegrationQuery,
  requireCompleteItems: boolean,
  origin: string
) {
  const page = input.ids ? 1 : input.page;
  const pageSize = input.ids?.length ?? input.pageSize;
  const filters = [sql`i.isActive=1`];
  if (requireCompleteItems) filters.push(usableInPscm);
  if (input.nodeId !== undefined) {
    const branch = await catalogBranchFilter(db, input.nodeId);
    if (!branch) return { items: [], total: 0, page, pageSize };
    filters.push(branch);
  }
  if (input.ids)
    filters.push(
      sql`i.id IN (${sql.join(
        input.ids.map(id => sql`${id}`),
        sql`, `
      )})`
    );
  if (input.q) {
    const pattern = documentSearchPattern(input.q);
    filters.push(sql`(i.code LIKE ${pattern} ESCAPE '=' OR i.nameAr LIKE ${pattern} ESCAPE '='
      OR i.nameEn LIKE ${pattern} ESCAPE '=' OR i.nameUr LIKE ${pattern} ESCAPE '='
      OR EXISTS (SELECT 1 FROM catalog_code_aliases aliases
        WHERE aliases.entityType='item' AND aliases.entityId=i.id AND aliases.oldCode LIKE ${pattern} ESCAPE '='))`);
  }
  const where = sql.join(filters, sql` AND `);
  const countQuery = sql`SELECT COUNT(*) AS total FROM catalog_items i WHERE ${where}`;
  // A populated page and its total must see the same active catalog snapshot.
  const totalColumn = input.ids ? sql`` : sql`,matches.total`;
  const countJoin = input.ids ? sql`` : sql`CROSS JOIN (${countQuery}) matches`;
  const itemRows = await rows<ItemRow>(
    db,
    sql`SELECT i.id,i.code,i.nameAr,i.nameEn,i.nameUr,i.unit${totalColumn} FROM catalog_items i
      ${countJoin} WHERE ${where} ORDER BY i.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`
  );
  const found = new Map(itemRows.map(item => [item.id, item]));
  if (input.ids?.some(id => !found.has(id))) return null;
  const countRows =
    !input.ids && page > 1 && !itemRows.length
      ? await rows<{ total: number | string }>(db, countQuery)
      : [];
  const total = input.ids
    ? itemRows.length
    : Number(itemRows[0]?.total ?? countRows[0]?.total ?? 0);
  if (!itemRows.length) return { items: [], total, page, pageSize };

  const itemIds = sql.join(
    itemRows.map(row => sql`${row.id}`),
    sql`, `
  );
  const unitLabels = Array.from(
    new Set(
      itemRows
        .map(row => row.unit?.trim())
        .filter((unit): unit is string => Boolean(unit))
    )
  );
  const labels = sql.join(
    unitLabels.map(label => sql`${label}`),
    sql`, `
  );
  const [unitRows, imageRows, specs] = await Promise.all([
    unitLabels.length
      ? rows<UnitRow>(
          db,
          sql`SELECT id,nameAr,nameEn FROM catalog_units
      WHERE TRIM(nameAr) IN (${labels}) OR TRIM(nameEn) IN (${labels}) ORDER BY isActive DESC,id`
        )
      : [],
    rows<ImageRow>(
      db,
      sql`SELECT a.entityId AS itemId,MAX(a.id) AS attachmentId FROM attachments a
      WHERE ${catalogImage} AND a.entityId IN (${itemIds}) GROUP BY a.entityId`
    ),
    rows<SpecificationRow>(
      db,
      sql`SELECT itemId,specKeyAr,specKeyEn,specKeyUr,specValue,specUnit
      FROM catalog_item_specs WHERE itemId IN (${itemIds}) ORDER BY itemId,sortOrder,id`
    ),
  ]);
  const units = new Map<string, UnitRow>();
  for (const unit of unitRows) {
    for (const label of [unit.nameAr, unit.nameEn]) {
      const key = normalizePmv2MaterialUnit(label);
      if (key && !units.has(key)) units.set(key, unit);
    }
  }
  const images = new Map(imageRows.map(row => [row.itemId, row.attachmentId]));
  const specifications = new Map<number, string>();
  for (const spec of specs) {
    const key = localized(
      spec.specKeyAr,
      spec.specKeyEn,
      spec.specKeyUr,
      input.locale
    );
    const value = [spec.specValue?.trim(), spec.specUnit?.trim()]
      .filter(Boolean)
      .join(" ");
    if (!key || !value) continue;
    specifications.set(
      spec.itemId,
      appendSpecification(
        specifications.get(spec.itemId) ?? "",
        key + ": " + value
      )
    );
  }
  const orderedItems = input.ids?.map(id => found.get(id)!) ?? itemRows;
  const items = orderedItems.map(item => {
    const attachmentId = images.get(item.id);
    return {
      id: String(item.id),
      code: item.code?.trim() || null,
      name: localized(item.nameAr, item.nameEn, item.nameUr, input.locale),
      unit: formatUnit(item.unit, units),
      specifications: specifications.get(item.id) ?? "",
      imageUrl: attachmentId
        ? origin + "/api/v1/catalog/items/" + item.id + "/image/" + attachmentId
        : null,
    };
  });
  return { items, total, page, pageSize };
}

export async function resolveCatalogIntegrationImage(
  db: CatalogIntegrationDatabase,
  itemId: number,
  attachmentId: number
) {
  const [image] = await rows<{ fileKey: string }>(
    db,
    sql`SELECT a.fileKey
    FROM attachments a INNER JOIN catalog_items i ON i.id=a.entityId
    WHERE i.isActive=1 AND i.id=${itemId} AND a.id=${attachmentId} AND ${catalogImage}
    LIMIT 1`
  );
  return image?.fileKey ?? null;
}
