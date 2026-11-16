import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { PURCHASE_REVIEW_ROLES } from "../../shared/purchase-item-review";
import { purchaseReviewRoleLabels } from "../../shared/purchase-review-role-labels";
import { registerPscmReferenceRoutes } from "../services/pscm/reference-routes";
import type { ReferenceDatabase } from "../services/pscm/reference-data";

const referencePath = "/api/v1/pscm/references";
const token = "cmms_ref_" + "x".repeat(43);
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");
const dialect = new MySqlDialect();

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE sites (
      id INTEGER PRIMARY KEY, name TEXT, nameEn TEXT, nameUr TEXT, isActive INT
    );
    CREATE TABLE sections (
      id INTEGER PRIMARY KEY, name TEXT, nameEn TEXT, nameUr TEXT, isActive INT, siteId INT
    );
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY, name TEXT, status TEXT, siteId INT, sectionId INT
    );
    CREATE TABLE center_categories (
      id INTEGER PRIMARY KEY, name TEXT, isActive INT
    );
    CREATE TABLE entity_translations (
      id INTEGER PRIMARY KEY, entityType TEXT, entityId INT, fieldName TEXT,
      languageCode TEXT, translationStatus TEXT, translatedText TEXT
    );
    INSERT INTO sites VALUES
      (1, 'موقع أول', 'Old English name', NULL, 1),
      (2, 'موقع ثان', 'Second site', NULL, 1),
      (3, 'موقع معطّل', 'Inactive site', NULL, 0);
    INSERT INTO sections VALUES
      (11, 'قسم أول', 'First section', 'پہلا شعبہ', 1, 1),
      (12, 'قسم معطّل', 'Inactive section', NULL, 0, 1),
      (21, 'قسم ثان', 'Second section', NULL, 1, 2),
      (31, 'قسم الموقع المعطّل', NULL, NULL, 1, 3),
      (41, 'قسم بدون موقع', NULL, NULL, 1, 4);
    INSERT INTO assets VALUES
      (101, 'A pump', 'active', 1, 11),
      (102, 'B unit', 'under_maintenance', 1, 11),
      (103, 'Inactive asset', 'inactive', 1, 11),
      (104, 'Disposed asset', 'disposed', 1, 11),
      (105, 'Mismatched site', 'active', 1, 21),
      (106, 'Mismatched section', 'active', 2, 11),
      (107, 'Asset under inactive site', 'active', 3, 31),
      (108, 'Asset under inactive section', 'active', 1, 12),
      (109, 'Asset under missing site', 'active', 4, 41);
    INSERT INTO center_categories VALUES
      (55, 'مشتريات المواد', 1), (56, 'تصنيف معطّل', 0);
    INSERT INTO entity_translations VALUES
      (1, 'SITE', 1, 'name', 'en', 'approved', 'First site'),
      (2, 'SITE', 1, 'name', 'en', 'completed', 'Auto-translated site'),
      (3, 'ASSET', 101, 'name', 'ar', 'completed', 'المضخة'),
      (4, 'ASSET', 102, 'name', 'ar', 'pending', 'غير معتمد'),
      (5, 'CENTER_CATEGORY', 55, 'name', 'en', 'completed', 'Material purchases');
  `);
  const queries: { sql: string; params: unknown[] }[] = [];
  const database: ReferenceDatabase = {
    async execute(statement) {
      const compiled = dialect.sqlToQuery(statement);
      queries.push(compiled);
      return [
        sqlite
          .prepare(compiled.sql)
          .all(...(compiled.params as (number | string)[])),
      ];
    },
  };
  return { sqlite, queries, database };
}

async function withServer(
  run: (
    read: (query: string, options?: RequestInit) => Promise<Response>,
    data: ReturnType<typeof fixture>,
    open: ReturnType<typeof vi.fn>
  ) => Promise<void>,
  options?: { configuredToken?: string | null; failure?: "missing" | "query" }
) {
  const app = express();
  const data = fixture();
  const open = vi.fn(async () => {
    if (options?.failure === "missing") return null;
    if (options?.failure === "query")
      return {
        execute: async () => {
          throw new Error("private database failure");
        },
      };
    return data.database;
  });
  registerPscmReferenceRoutes(
    app,
    options?.configuredToken === null
      ? undefined
      : (options?.configuredToken ?? token),
    open
  );
  const server = await new Promise<ReturnType<typeof app.listen>>(
    (resolve, reject) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      listener.once("error", reject);
    }
  );
  try {
    await run(
      (query, init) =>
        fetch(
          `http://127.0.0.1:${(server.address() as AddressInfo).port}${referencePath}${query}`,
          { headers: { Authorization: `Bearer ${token}` }, ...init }
        ),
      data,
      open
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
    data.sqlite.close();
  }
}

describe("PSCM reference HTTP API", () => {
  it("authenticates a dedicated token before opening the database", async () => {
    await withServer(async (read, _, open) => {
      for (const authorization of [
        "",
        "Basic user",
        "Bearer " + "cmms_ref_" + "z".repeat(43),
        "Bearer " + "cmms_cat_" + "x".repeat(43),
      ]) {
        const response = await read("?type=sites", {
          headers: { Authorization: authorization },
        });
        expect(response.status).toBe(401);
        expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      }
      expect(open).not.toHaveBeenCalled();
      const response = await read("?type=sites", {
        headers: { Authorization: "bearer " + token },
      });
      expect(response.status).toBe(200);
      expect(open).toHaveBeenCalledOnce();
    });
  });

  it("can read names over GET and returns a bodyless HEAD without enabling writes", async () => {
    await withServer(async (read, _, open) => {
      const response = await read("?type=sites&locale=en");
      expect(response.headers.get("Content-Type")).toContain(
        "application/json"
      );
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Surrogate-Control")).toBe("no-store");
      expect(await response.json()).toEqual([
        { id: 1, name: "First site" },
        { id: 2, name: "Second site" },
      ]);
      const head = await read("?type=sites&locale=en", { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      const written = await read("?type=sites", { method: "POST" });
      expect(written.status).toBe(405);
      expect(written.headers.get("Allow")).toBe("GET, HEAD");
      expect(open).toHaveBeenCalledTimes(2);
    });
  });

  it("validates each allowed query shape before opening the database", async () => {
    await withServer(async (read, _, open) => {
      for (const query of [
        "",
        "?type=tickets",
        "?type=assets&siteId=1",
        "?type=sections&siteId=0",
        "?type=sites&locale=fr",
        "?type=sites&siteId=1",
        "?type=assets&siteId=2147483648&sectionId=11",
        "?type=sections&siteId=1&siteId=2",
        "?type=sections&siteId=1.5",
        "?type=assets&siteId=1&sectionId=1%20OR%201=1",
        "?type=projectLocation&siteId=1",
        "?type=projectLocation&sectionId=11",
        "?type=projectLocation&siteId=1&sectionId=11&assetId=",
        "?type=projectLocation&siteId=1&sectionId=11&assetId=1&assetId=2",
        "?type=projectLocation&siteId=1&sectionId=11&assetId=2147483648",
      ])
        expect((await read(query)).status).toBe(400);
      expect(open).not.toHaveBeenCalled();
    });
  });

  it("filters sections and assets by their active ancestor chain on consecutive requests", async () => {
    await withServer(async (read, data) => {
      const json = async (query: string) => (await read(query)).json();
      expect(await json("?type=sections&siteId=1&locale=ur")).toEqual([
        { id: 11, name: "پہلا شعبہ" },
      ]);
      expect(await json("?type=sections&siteId=2&locale=en")).toEqual([
        { id: 21, name: "Second section" },
      ]);
      expect(await json("?type=sections&siteId=3")).toEqual([]);
      expect(await json("?type=sections&siteId=4")).toEqual([]);
      expect(await json("?type=assets&siteId=1&sectionId=11")).toEqual([
        { id: 101, name: "المضخة" },
        { id: 102, name: "B unit" },
        { id: 103, name: "Inactive asset" },
      ]);
      expect(await json("?type=assets&siteId=1&sectionId=21")).toEqual([]);
      expect(await json("?type=assets&siteId=2&sectionId=11")).toEqual([]);
      expect(await json("?type=assets&siteId=3&sectionId=31")).toEqual([]);
      expect(await json("?type=assets&siteId=1&sectionId=12")).toEqual([]);
      expect(await json("?type=assets&siteId=4&sectionId=41")).toEqual([]);
      data.sqlite.exec("UPDATE sites SET isActive = 0 WHERE id = 1");
      expect(await json("?type=assets&siteId=1&sectionId=11")).toEqual([]);
    });
  });

  it("resolves one localized project location with or without an asset", async () => {
    await withServer(async (read, data) => {
      const location = "?type=projectLocation&siteId=1&sectionId=11";
      const denied = await read(location, { headers: {} });
      expect(denied.status).toBe(401);
      expect(data.queries).toHaveLength(0);

      const without = await read(location + "&locale=en");
      expect(without.status).toBe(200);
      expect(await without.json()).toEqual({
        site: { id: 1, name: "First site" },
        section: { id: 11, name: "First section" },
        asset: null,
      });
      expect(data.queries).toHaveLength(3);
      expect(data.queries[0].sql).not.toMatch(/JOIN assets/);
      expect(data.queries.slice(1).map(query => query.params)).toEqual([
        ["SITE", "en", 1],
        ["SECTION", "en", 11],
      ]);

      const withAsset = await read(location + "&assetId=101&locale=ar");
      expect(withAsset.status).toBe(200);
      expect(await withAsset.json()).toEqual({
        site: { id: 1, name: "موقع أول" },
        section: { id: 11, name: "قسم أول" },
        asset: { id: 101, name: "المضخة" },
      });
      const eligibleInactiveAsset = await read(location + "&assetId=103");
      expect((await eligibleInactiveAsset.json()).asset).toEqual({
        id: 103,
        name: "Inactive asset",
      });
    });
  });

  it("returns null for a project location with a missing or invalid ancestor or asset", async () => {
    await withServer(async (read, data) => {
      const invalidSelections = [
        "siteId=1&sectionId=21",
        "siteId=1&sectionId=12&assetId=108",
        "siteId=3&sectionId=31&assetId=107",
        "siteId=4&sectionId=41&assetId=109",
        "siteId=1&sectionId=11&assetId=104",
        "siteId=1&sectionId=11&assetId=105",
        "siteId=1&sectionId=11&assetId=106",
        "siteId=1&sectionId=11&assetId=999",
      ];
      for (const selection of invalidSelections) {
        const response = await read("?type=projectLocation&" + selection);
        expect(response.status).toBe(200);
        expect(await response.json()).toBeNull();
      }
      expect(data.queries).toHaveLength(invalidSelections.length);
    });
  });

  it("validates a chosen asset by ID even when the section has more assets than a list can return", async () => {
    await withServer(async (read, data) => {
      data.sqlite.exec(`
        WITH RECURSIVE n(id) AS (SELECT 1000 UNION ALL SELECT id + 1 FROM n WHERE id < 11099)
        INSERT INTO assets SELECT id, 'Asset ' || id, 'active', 1, 11 FROM n;
      `);
      const response = await read(
        "?type=projectLocation&siteId=1&sectionId=11&assetId=11099"
      );
      expect(response.status).toBe(200);
      expect((await response.json()).asset).toEqual({
        id: 11099,
        name: "Asset 11099",
      });
      expect(data.queries).toHaveLength(4);
      expect(data.queries[0].params).toEqual([11, 11099, 1]);
      expect(data.queries[0].sql).toMatch(/LIMIT 1\s*$/);
      expect(data.queries.slice(1).map(query => query.params)).toEqual([
        ["SITE", "ar", 1],
        ["SECTION", "ar", 11],
        ["ASSET", "ar", 11099],
      ]);
    });
  });

  it("returns active purchase categories with the exact review roles and labels by locale", async () => {
    await withServer(async read => {
      for (const locale of ["ar", "en", "ur"] as const) {
        const response = await read(`?type=purchaseOptions&locale=${locale}`);
        expect(await response.json()).toEqual({
          categories: [
            {
              id: 55,
              name: locale === "en" ? "Material purchases" : "مشتريات المواد",
            },
          ],
          reviewRoles: PURCHASE_REVIEW_ROLES.map(code => ({
            code,
            name: purchaseReviewRoleLabels[locale][code],
          })),
        });
      }
    });
  });

  it("loads localized names in bounded batches even for many assets with one parent", async () => {
    await withServer(async (read, data) => {
      data.sqlite.exec(`
        WITH RECURSIVE n(id) AS (SELECT 1000 UNION ALL SELECT id + 1 FROM n WHERE id < 1999)
        INSERT INTO assets SELECT id, 'Asset ' || id, 'active', 1, 11 FROM n;
      `);
      const response = await read("?type=assets&siteId=1&sectionId=11");
      expect(await response.json()).toHaveLength(1003);
      expect(data.queries).toHaveLength(4);
      expect(
        data.queries.slice(1).map(query => query.params.length - 2)
      ).toEqual([500, 500, 3]);
    });
  });

  it("fails closed for invalid static setup and surfaces generic data outages", async () => {
    for (const configuredToken of [null, "cmms_cat_" + "x".repeat(43)]) {
      await withServer(
        async (read, _, open) => {
          expect((await read("?type=sites")).status).toBe(503);
          expect(open).not.toHaveBeenCalled();
        },
        { configuredToken }
      );
    }
    for (const failure of ["missing", "query"] as const) {
      await withServer(
        async read => {
          const response = await read("?type=sites");
          expect(response.status).toBe(503);
          expect(await response.json()).toEqual({
            error: "References unavailable",
          });
        },
        { failure }
      );
    }
  });
});
