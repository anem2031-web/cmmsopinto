import { sql, type SQL } from "drizzle-orm";
import { PURCHASE_REVIEW_ROLES } from "../../../shared/purchase-item-review";
import { purchaseReviewRoleLabels } from "../../../shared/purchase-review-role-labels";
import { readScopeChunks } from "../../_core/authz/read-batch";

type Locale = keyof typeof purchaseReviewRoleLabels;
export type ReferenceQuery = { locale: Locale } & (
  | { type: "sites" | "purchaseOptions" }
  | { type: "sections"; siteId: number }
  | { type: "assets"; siteId: number; sectionId: number }
  | {
      type: "projectLocation";
      siteId: number;
      sectionId: number;
      assetId?: number;
    }
);
export interface ReferenceDatabase {
  execute(statement: SQL): PromiseLike<unknown>;
}

type ReferenceRow = {
  id: number;
  name: string;
  nameEn?: string | null;
  nameUr?: string | null;
};
type TranslationRow = { entityId: number; translatedText: string | null };
type ProjectLocationRow = {
  siteId: number;
  siteName: string;
  siteNameEn: string | null;
  siteNameUr: string | null;
  sectionId: number;
  sectionName: string;
  sectionNameEn: string | null;
  sectionNameUr: string | null;
  assetId: number | null;
  assetName: string | null;
};
type Entity = "SITE" | "SECTION" | "ASSET" | "CENTER_CATEGORY";
const maxReferences = 10_000;

async function selectRows<T>(
  db: ReferenceDatabase,
  statement: SQL
): Promise<T[]> {
  const result = await db.execute(statement);
  if (!Array.isArray(result) || !Array.isArray(result[0])) {
    throw new Error("Invalid reference database response");
  }
  return result[0] as T[];
}

async function readOptions(
  db: ReferenceDatabase,
  statement: SQL,
  entity: Entity,
  locale: Locale
) {
  const rows = await selectRows<ReferenceRow>(
    db,
    sql`${statement} LIMIT ${maxReferences + 1}`
  );
  if (rows.length > maxReferences)
    throw new Error("Reference list exceeds capacity");
  return localizeOptions(db, rows, entity, locale);
}

async function localizeOptions(
  db: ReferenceDatabase,
  rows: ReferenceRow[],
  entity: Entity,
  locale: Locale
) {
  // Use stored translations only; a reference fetch never queues or writes one.
  const translations = await readScopeChunks(
    rows.map(row => row.id),
    ids =>
      selectRows<TranslationRow>(
        db,
        sql`
      SELECT entityId, SUBSTR(translatedText, 1, 255) AS translatedText
      FROM entity_translations
      WHERE entityType = ${entity} AND languageCode = ${locale}
        AND fieldName = 'name' AND translationStatus IN ('completed', 'approved')
        AND entityId IN (${sql.join(
          ids.map(id => sql`${id}`),
          sql`, `
        )})
      ORDER BY (translationStatus = 'approved'), id
    `
      )
  );
  const names = new Map<number, string>();
  for (const { entityId, translatedText } of translations) {
    const name = translatedText?.trim();
    if (name) names.set(entityId, name);
  }

  return rows.map(row => {
    const direct =
      locale === "en" ? row.nameEn : locale === "ur" ? row.nameUr : null;
    const name =
      names.get(row.id) || direct?.trim() || row.name.trim() || String(row.id);
    return {
      id: row.id,
      name: name.slice(0, 255).replace(/[\uD800-\uDBFF]$/, ""),
    };
  });
}

async function readProjectLocation(
  db: ReferenceDatabase,
  {
    siteId,
    sectionId,
    assetId,
    locale,
  }: Extract<ReferenceQuery, { type: "projectLocation" }>
) {
  const assetColumns =
    assetId === undefined
      ? sql`NULL AS assetId, NULL AS assetName`
      : sql`a.id AS assetId, a.name AS assetName`;
  const assetJoin =
    assetId === undefined
      ? sql``
      : sql`
    JOIN assets a ON a.id = ${assetId} AND a.siteId = p.id AND a.sectionId = s.id
      AND a.status <> 'disposed'
  `;
  const [row] = await selectRows<ProjectLocationRow>(
    db,
    sql`
    SELECT p.id AS siteId, p.name AS siteName, p.nameEn AS siteNameEn, p.nameUr AS siteNameUr,
      s.id AS sectionId, s.name AS sectionName, s.nameEn AS sectionNameEn, s.nameUr AS sectionNameUr,
      ${assetColumns}
    FROM sites p
    JOIN sections s ON s.id = ${sectionId} AND s.siteId = p.id AND s.isActive = 1
    ${assetJoin}
    WHERE p.id = ${siteId} AND p.isActive = 1
    LIMIT 1
  `
  );
  if (!row) return null;

  const [[site], [section], [asset]] = await Promise.all([
    localizeOptions(
      db,
      [
        {
          id: row.siteId,
          name: row.siteName,
          nameEn: row.siteNameEn,
          nameUr: row.siteNameUr,
        },
      ],
      "SITE",
      locale
    ),
    localizeOptions(
      db,
      [
        {
          id: row.sectionId,
          name: row.sectionName,
          nameEn: row.sectionNameEn,
          nameUr: row.sectionNameUr,
        },
      ],
      "SECTION",
      locale
    ),
    row.assetId !== null && row.assetName !== null
      ? localizeOptions(
          db,
          [{ id: row.assetId, name: row.assetName }],
          "ASSET",
          locale
        )
      : [],
  ]);
  return { site, section, asset: asset ?? null };
}

export async function readPscmReferences(
  db: ReferenceDatabase,
  query: ReferenceQuery
) {
  const { locale } = query;
  switch (query.type) {
    case "sites":
      return readOptions(
        db,
        sql`
        SELECT id, name, nameEn, nameUr
        FROM sites WHERE isActive = 1
        ORDER BY name, id
      `,
        "SITE",
        locale
      );
    case "sections":
      return readOptions(
        db,
        sql`
        SELECT s.id, s.name, s.nameEn, s.nameUr
        FROM sections s
        JOIN sites p ON p.id = s.siteId AND p.isActive = 1
        WHERE s.siteId = ${query.siteId} AND s.isActive = 1
        ORDER BY s.name, s.id
      `,
        "SECTION",
        locale
      );
    case "assets":
      return readOptions(
        db,
        sql`
        SELECT a.id, a.name
        FROM assets a
        JOIN sections s ON s.id = a.sectionId AND s.siteId = a.siteId AND s.isActive = 1
        JOIN sites p ON p.id = s.siteId AND p.isActive = 1
        WHERE a.siteId = ${query.siteId} AND a.sectionId = ${query.sectionId}
          AND a.status <> 'disposed'
        ORDER BY a.name, a.id
      `,
        "ASSET",
        locale
      );
    case "projectLocation":
      return readProjectLocation(db, query);
    case "purchaseOptions":
      return {
        categories: await readOptions(
          db,
          sql`
          SELECT id, name FROM center_categories WHERE isActive = 1
          ORDER BY name, id
        `,
          "CENTER_CATEGORY",
          locale
        ),
        reviewRoles: PURCHASE_REVIEW_ROLES.map(code => ({
          code,
          name: purchaseReviewRoleLabels[locale][code],
        })),
      };
  }
}
