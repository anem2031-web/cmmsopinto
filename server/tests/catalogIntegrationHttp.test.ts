import { Readable } from "node:stream";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import express, { type RequestHandler } from "express";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";
import { registerCatalogIntegrationRoutes } from "../services/catalog/catalogIntegrationRoutes";
import type { CatalogIntegrationDatabase } from "../services/catalog/integration-reader";

const generic = "/api/v1/catalog/items";
const pscm = "/api/v1/catalog/pscm/items";
const catalogOrigin = "https://cmms.example";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+6ymQAAAAASUVORK5CYII=",
  "base64"
);
const dialect = new MySqlDialect();
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");
const authorize: RequestHandler = (req, res, next) => {
  if (req.get("Authorization") !== "Bearer fixture") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.function("regexp", (pattern, value) =>
    typeof value === "string" &&
    new RegExp(String(pattern).replace("[:space:]", "\\s")).test(value)
      ? 1
      : 0
  );
  sqlite.exec(`
    CREATE TABLE catalog_items(id INTEGER PRIMARY KEY, code TEXT, nameAr TEXT, nameEn TEXT, nameUr TEXT, unit TEXT, isActive INTEGER, nodeId INTEGER);
    CREATE TABLE catalog_nodes(id INTEGER PRIMARY KEY, parentId INTEGER, code TEXT, nameAr TEXT, nameEn TEXT, nameUr TEXT, isActive INTEGER, sortOrder INTEGER);
    CREATE TABLE catalog_code_aliases(entityType TEXT, entityId INTEGER, oldCode TEXT);
    CREATE TABLE catalog_units(id INTEGER PRIMARY KEY, nameAr TEXT, nameEn TEXT, isActive INTEGER);
    CREATE TABLE catalog_item_specs(id INTEGER PRIMARY KEY, itemId INTEGER, specKeyAr TEXT, specKeyEn TEXT, specKeyUr TEXT, specValue TEXT, specUnit TEXT, sortOrder INTEGER);
    CREATE TABLE attachments(id INTEGER PRIMARY KEY, entityId INTEGER, entityType TEXT, fileKey TEXT, mimeType TEXT, fileName TEXT);
    INSERT INTO catalog_items VALUES
      (1, '0001-A', 'أنبوب', 'Pipe', 'پائپ', 'متر', 1, 4),
      (2, '0002-B', 'صندوق', 'Box', NULL, 'كرتون', 1, 1),
      (3, 'HIDDEN', 'غير نشط', 'Inactive', NULL, 'متر', 0, 2),
      (4, NULL, 'صنف قديم', 'Legacy', NULL, NULL, 1, 2),
      (5, '0005-E', 'علبة', 'Carton', NULL, 'علبة', 1, 8);
    INSERT INTO catalog_nodes VALUES
      (1, NULL, '01', 'السباكة', 'Plumbing', 'پلمبنگ', 1, 5),
      (2, 1, '01-01', 'الأنابيب', 'Pipes', NULL, 1, 5),
      (4, 2, '01-01-01', 'البلاستيك', 'Plastic', NULL, 1, 5),
      (6, 1, '01-02', 'فرع غير نشط', 'Inactive branch', NULL, 0, 1),
      (7, 6, '01-02-01', 'فرع محجوب', 'Hidden branch', NULL, 1, 0),
      (8, NULL, NULL, 'مواد عامة', 'General materials', NULL, 1, 1),
      (9, 100, '01-03', 'فرع بلا أصل', 'Orphan branch', NULL, 1, 3);
    INSERT INTO catalog_units VALUES (9, 'متر', 'Metre', 1), (10, 'كرتون', 'Box', 1), (11, 'علبة', 'Carton', 1);
    INSERT INTO catalog_code_aliases VALUES ('item', 1, 'OLD_001'), ('item', 3, 'OLD_003');
    INSERT INTO catalog_item_specs VALUES (1, 1, 'القطر', 'Diameter', 'قطر', '110', 'mm', 0);
    INSERT INTO attachments VALUES
      (8, 1, 'catalog_item', 'cmms/catalog/old.jpg', 'image/jpeg', 'old.jpg'),
      (9, 1, 'catalog_item', 'cmms/catalog/pipe.png', 'image/png', 'pipe.png'),
      (10, 1, 'catalog_item', 'cmms/catalog/doc.pdf', 'application/pdf', 'doc.pdf'),
      (11, 2, 'ticket', 'cmms/tickets/secret.png', 'image/png', 'secret.png'),
      (12, 3, 'catalog_item', 'cmms/catalog/inactive.png', 'image/png', 'inactive.png'),
      (13, 2, 'catalog_item', 'cmms/../secret.png', 'image/png', 'secret.png');
  `);
  const queries: { sql: string; params: unknown[] }[] = [];
  const database: CatalogIntegrationDatabase = {
    async execute(query) {
      const compiled = dialect.sqlToQuery(query);
      queries.push(compiled);
      return [
        sqlite
          .prepare(compiled.sql)
          .all(...(compiled.params as (string | number)[])),
      ];
    },
  };
  return { sqlite, queries, database };
}

async function withServer(
  run: (
    request: (path: string, options?: RequestInit) => Promise<Response>,
    data: ReturnType<typeof fixture>,
    images: ReturnType<typeof vi.fn>
  ) => Promise<void>,
  origin: string | undefined = catalogOrigin
) {
  const data = fixture();
  const images = vi.fn(async (key: string) =>
    Readable.from([key.endsWith("old.jpg") ? Buffer.from("<svg/>") : png])
  );
  const app = express();
  registerCatalogIntegrationRoutes(app, authorize, origin, {
    database: async () => data.database,
    openImage: images,
  });
  const server = await new Promise<ReturnType<typeof app.listen>>(
    (resolve, reject) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      listener.once("error", reject);
    }
  );
  const localOrigin =
    "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  try {
    await run(
      (path, options) => fetch(localOrigin + path, options),
      data,
      images
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
    data.sqlite.close();
  }
}

const authenticated = { headers: { Authorization: "Bearer fixture" } };
const selected = (ids: (string | number)[]) =>
  "?ids=" + encodeURIComponent(JSON.stringify(ids));

describe("CMMS catalog integration", () => {
  it("authenticates both lists and image reads before touching catalog data or storage", async () => {
    await withServer(async (request, fixture, images) => {
      for (const path of [
        generic,
        pscm,
        generic + "?view=tree",
        pscm + "?view=tree",
        pscm + "?nodeId=1",
        generic + "/1/image/9",
      ]) {
        expect(
          (await request(path, { headers: { Cookie: "session=unrelated" } }))
            .status
        ).toBe(401);
      }
      expect(fixture.queries).toEqual([]);
      expect(images).not.toHaveBeenCalled();
    });
  });

  it("searches by literal current and historical codes with active scope, translated fields and safe image origin", async () => {
    await withServer(async request => {
      const found = await request(pscm + "?q=OLD_001&locale=ur", {
        headers: { Authorization: "Bearer fixture", Host: "untrusted.example" },
      });
      expect(found.status).toBe(200);
      expect(await found.json()).toEqual({
        items: [
          {
            id: "1",
            code: "0001-A",
            name: "پائپ",
            unit: {
              id: "CMMS_UNIT_9",
              code: "CMMS_UNIT_9",
              nameAr: "متر",
              nameEn: "Metre",
              nameUr: "میٹر",
            },
            specifications: "قطر: 110 mm",
            imageUrl: catalogOrigin + generic + "/1/image/9",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      expect(
        await (await request(pscm + "?q=OLD_003", authenticated)).json()
      ).toMatchObject({ items: [], total: 0 });
      expect(
        await (await request(pscm + "?q=%25", authenticated)).json()
      ).toMatchObject({ items: [], total: 0 });
    });
  });

  it("exposes legacy missing fields through the generic API and filters them before PSCM pagination", async () => {
    await withServer(async request => {
      const general = await (
        await request(generic + "?pageSize=2", authenticated)
      ).json();
      expect(general).toMatchObject({
        items: [{ id: "5" }, { id: "4", code: null, unit: null }],
        total: 4,
        page: 1,
        pageSize: 2,
      });
      const compatible = await (
        await request(pscm + "?pageSize=2&locale=en", authenticated)
      ).json();
      expect(compatible).toMatchObject({
        items: [
          { id: "5", unit: { code: "CMMS_UNIT_11", nameEn: "Carton" } },
          { id: "2", unit: { code: "CMMS_UNIT_10", nameEn: "Box" } },
        ],
        total: 3,
        page: 1,
        pageSize: 2,
      });
    });
  });

  it("returns the same localized, reachable active tree on both protected endpoints", async () => {
    await withServer(async (request, data) => {
      for (const path of [generic, pscm]) {
        const response = await request(
          path + "?view=tree&locale=ur",
          authenticated
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          nodes: [
            { id: 8, parentId: null, code: null, name: "مواد عامة" },
            { id: 1, parentId: null, code: "01", name: "پلمبنگ" },
            { id: 2, parentId: 1, code: "01-01", name: "الأنابيب" },
            { id: 4, parentId: 2, code: "01-01-01", name: "البلاستيك" },
          ],
        });
      }
      expect(data.queries).toHaveLength(2);
      expect(data.queries[0].sql).toContain("WHERE isActive=1");
    });
  });

  it("filters the entire chosen branch before counting and paging", async () => {
    await withServer(async (request, data) => {
      const first = await request(pscm + "?nodeId=1&pageSize=1", authenticated);
      expect(await first.json()).toMatchObject({
        items: [{ id: "2" }],
        total: 2,
        page: 1,
        pageSize: 1,
      });
      expect(data.queries[1].sql).toContain("i.nodeId IN (?, ?, ?)");
      expect(data.queries[1].params.slice(0, 3)).toEqual([1, 2, 4]);
      const second = await request(
        pscm + "?nodeId=1&page=2&pageSize=1",
        authenticated
      );
      expect(await second.json()).toMatchObject({
        items: [{ id: "1" }],
        total: 2,
        page: 2,
        pageSize: 1,
      });
      const searched = await request(
        generic + "?nodeId=2&q=OLD_001",
        authenticated
      );
      expect(await searched.json()).toMatchObject({
        items: [{ id: "1" }],
        total: 1,
      });
      const wrongBranch = await request(
        pscm + "?nodeId=8&q=OLD_001",
        authenticated
      );
      expect(await wrongBranch.json()).toMatchObject({ items: [], total: 0 });
    });
  });

  it("handles invisible branches and rejects conflicting tree or selection parameters", async () => {
    await withServer(async (request, data) => {
      data.sqlite.exec("UPDATE catalog_items SET nodeId=7 WHERE id=1");
      for (const nodeId of [6, 7, 9, 100]) {
        const response = await request(
          pscm + "?nodeId=" + nodeId,
          authenticated
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ items: [], total: 0 });
      }
      expect(data.queries).toHaveLength(4);
      for (const query of [
        "?view=tree&nodeId=1",
        "?view=tree&page=3",
        "?view=tree&q=pipe",
        selected(["1"]) + "&nodeId=1",
        "?nodeId=0",
        "?nodeId=2147483648",
      ]) {
        expect((await request(pscm + query, authenticated)).status).toBe(400);
      }
      expect(data.queries).toHaveLength(4);
    });
  });

  it("keeps branch IDs in bounded groups while querying and enriching one item page", async () => {
    await withServer(async (request, data) => {
      const insert = data.sqlite.prepare(
        "INSERT INTO catalog_nodes VALUES (?, 1, NULL, 'فرع', 'Branch', NULL, 1, 0)"
      );
      for (let id = 1000; id < 1520; id++) insert.run(id);
      data.sqlite.exec("UPDATE catalog_items SET nodeId=1519 WHERE id=1");
      const response = await request(pscm + "?nodeId=1", authenticated);
      expect(await response.json()).toMatchObject({
        items: [{ id: "2" }, { id: "1" }],
        total: 2,
      });
      expect(data.queries).toHaveLength(5);
      const groups = [
        ...data.queries[1].sql.matchAll(/i\.nodeId IN \(([^)]+)\)/g),
      ];
      expect(groups.map(group => group[1].split(",").length)).toEqual([
        500, 23, 500, 23,
      ]);
    });
  });

  it("returns exactly the requested item ids in order and fails unavailable or invalid batches atomically", async () => {
    await withServer(async (request, data) => {
      const response = await request(
        pscm + selected(["1", "5", "2"]),
        authenticated
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.items.map((item: { id: string }) => item.id)).toEqual([
        "1",
        "5",
        "2",
      ]);
      expect(body).toMatchObject({ total: 3, page: 1, pageSize: 3 });
      const readsAfterSuccess = data.queries.length;
      expect(
        (await request(pscm + selected(["1", "3"]), authenticated)).status
      ).toBe(404);
      expect(
        (await request(pscm + selected(["1", "4"]), authenticated)).status
      ).toBe(404);
      expect(
        (await request(pscm + selected(["1", "100"]), authenticated)).status
      ).toBe(404);
      expect(data.queries.length - readsAfterSuccess).toBe(3);
      for (const ids of [
        ["1", "1"],
        [1],
        [],
        Array.from({ length: 21 }, (_, i) => String(i + 1)),
      ]) {
        expect(
          (await request(pscm + selected(ids), authenticated)).status
        ).toBe(400);
      }
      expect(data.queries.length - readsAfterSuccess).toBe(3);
    });
  });

  it("populates a wide page with bounded batched reads after SQL filtering and paging", async () => {
    await withServer(async (request, data) => {
      const insert = data.sqlite.prepare(
        "INSERT INTO catalog_items(id,code,nameAr,nameEn,nameUr,unit,isActive) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      for (let id = 30; id < 140; id++)
        insert.run(id, "code" + id, "أنبوب", "Pipe", null, "متر", 1);
      const body = await (
        await request(generic + "?page=2&pageSize=100&q=Pipe", authenticated)
      ).json();
      expect(body).toMatchObject({ total: 111, page: 2, pageSize: 100 });
      expect(body.items).toHaveLength(11);
      expect(data.queries).toHaveLength(4);
      expect(data.queries[0].sql).toContain("CROSS JOIN (SELECT COUNT(*)");
      expect(data.queries[0].sql).toContain("LIMIT ? OFFSET ?");
      expect(data.queries[0].params.slice(-2)).toEqual([100, 100]);
      const units = data.queries.find(query =>
        query.sql.includes("FROM catalog_units")
      );
      expect(units?.params).toEqual(["متر", "متر"]);
      expect(data.queries.every(query => /^SELECT /i.test(query.sql))).toBe(
        true
      );
      const beyondLastPage = await (
        await request(generic + "?page=3&pageSize=100&q=Pipe", authenticated)
      ).json();
      expect(beyondLastPage).toMatchObject({
        items: [],
        total: 111,
        page: 3,
        pageSize: 100,
      });
      expect(data.queries).toHaveLength(6);
    });
  });

  it("checks attachment ownership, current item activity and safe image keys on every download", async () => {
    await withServer(async (request, data, images) => {
      for (const path of [
        "/2/image/9",
        "/2/image/11",
        "/2/image/13",
        "/3/image/12",
        "/1/image/10",
        "/1/image/99",
      ]) {
        expect((await request(generic + path, authenticated)).status).toBe(404);
      }
      expect(images).not.toHaveBeenCalled();
      const image = await request(generic + "/1/image/9", authenticated);
      expect(image.status).toBe(200);
      expect(image.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
      expect(images).toHaveBeenCalledWith("cmms/catalog/pipe.png");
      expect(
        (await request(generic + "/1/image/8", authenticated)).status
      ).toBe(415);
      data.sqlite.exec("UPDATE catalog_items SET isActive=0 WHERE id=1");
      expect(
        (await request(generic + "/1/image/9", authenticated)).status
      ).toBe(404);
      expect(images).toHaveBeenCalledTimes(2);
    });
  });

  it("uses the configured origin and keeps the integration read-only", async () => {
    await withServer(async (request, data) => {
      const invalidOrigin = await request(pscm, authenticated);
      expect(invalidOrigin.status).toBe(503);
      expect(
        (await request(generic, { ...authenticated, method: "POST" })).status
      ).toBe(405);
      expect(data.queries).toEqual([]);
    }, "http://cmms.example");
  });
});
