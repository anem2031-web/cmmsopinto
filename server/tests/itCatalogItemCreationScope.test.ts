import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, getTableName, like, ne, sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  router,
  catalogItemManagerProcedure,
  catalogItemUpdateProcedure,
} from "../routers/_shared/procedures";
import { APP_ROLE } from "../../shared/roles";
import {
  getCatalogCreationNodeIds,
  isItCatalogCreationRoot,
  IT_CATALOG_CREATION_DENIED,
} from "../../shared/catalog-item-create-scope";
import { REQUIRE_CATALOG_IMAGE_ON_EDIT } from "../../shared/catalog-item-image-policy";
import {
  catalogNodes,
  catalogItems,
  catalogCodeAliases,
  catalogAuditLogs,
} from "../../drizzle/schema";
import {
  catalogItemImageSchema,
  assertCatalogImageUpload,
  saveRequiredCatalogImage,
} from "../routers/catalog/item-image";
import {
  isCatalogItemCodeForNode,
  nextCatalogItemCode,
} from "../_core/catalog-item-code";
vi.mock("../_core/authz/media-access", () => ({
  assertMediaMutationAccess: async () => {},
}));
vi.mock("../_core/db", () => ({}));
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const dialect = new MySqlDialect(),
  databases: any[] = [];
const image = {
  fileName: "photo.png",
  fileKey: "cmms/uploads/u-9/photo.webp",
  mimeType: "image/png",
  fileSize: 100,
};
const newItem = (nodeId: number) => ({
  nameAr: "صنف",
  nameEn: "Item",
  nodeId,
  image,
});
const node = (
  id: number,
  parentId: number | null,
  code: string,
  level = parentId === null ? 1 : 2
) => ({
  id,
  parentId,
  code,
  level,
  nameAr: "تصنيف " + id,
  nameEn: "Category " + id,
  isActive: 1,
});
function fixture() {
  const memory = new DatabaseSync(":memory:"),
    snapshot = new DatabaseSync(":memory:");
  databases.push(memory, snapshot);
  const nodeSchema =
    "CREATE TABLE catalog_nodes(id INTEGER PRIMARY KEY,parentId INTEGER,code TEXT UNIQUE,level INTEGER,nameAr TEXT,nameEn TEXT,isActive INTEGER);";
  memory.exec(
    nodeSchema +
      `
    CREATE TABLE catalog_items(id INTEGER PRIMARY KEY,code TEXT UNIQUE,nodeId INTEGER,nameAr TEXT,nameEn TEXT,nameUr TEXT,descriptionAr TEXT,descriptionEn TEXT,descriptionUr TEXT,unit TEXT,manufacturer TEXT,isActive INTEGER);
    CREATE TABLE catalog_code_aliases(id INTEGER PRIMARY KEY,entityType TEXT,entityId INTEGER,oldCode TEXT);
    CREATE TABLE attachments(id INTEGER PRIMARY KEY,fileName TEXT,fileKey TEXT,fileUrl TEXT,mimeType TEXT,fileSize INTEGER,entityType TEXT,entityId INTEGER,uploadedById INTEGER);
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,userId INTEGER,action TEXT,entityType TEXT,entityId INTEGER,newValues TEXT);
    CREATE TABLE catalog_audit_logs(id INTEGER PRIMARY KEY,userId INTEGER,action TEXT,entityType TEXT,entityId INTEGER,oldValues TEXT,newValues TEXT);
  `
  );
  snapshot.exec(nodeSchema);
  const queries: Array<{
    sql: string;
    params: unknown[];
    locked: boolean;
    inTransaction: boolean;
  }> = [];
  let inTransaction = false,
    staleSnapshot = false,
    onLeafLock: (() => void) | undefined;
  const compile = (statement: any, locked = false) => {
    const q = dialect.sqlToQuery(statement);
    queries.push({ ...q, locked, inTransaction });
    return { ...q, sql: q.sql.replace(/\s+FOR UPDATE\s*$/i, "") };
  };
  const params = (values: unknown[]) =>
    values.map(value => (typeof value === "boolean" ? Number(value) : value));
  const database: any = {
    select(projection?: Record<string, any>) {
      let table: any,
        condition: any,
        limit: number | undefined,
        locked = false;
      const builder: any = {
        from(value: any) {
          table = value;
          return builder;
        },
        where(value: any) {
          condition = value;
          return builder;
        },
        limit(value: number) {
          limit = value;
          return builder;
        },
        for(value: string) {
          expect(value).toBe("update");
          locked = true;
          return builder;
        },
        then(resolve: any, reject: any) {
          return Promise.resolve()
            .then(() => {
              const columns = projection
                ? sql.join(
                    Object.entries(projection).map(
                      ([key, value]) => sql`${value} AS ${sql.identifier(key)}`
                    ),
                    sql`, `
                  )
                : sql`*`;
              let statement = sql`SELECT ${columns} FROM ${table}`;
              if (condition) statement = sql`${statement} WHERE ${condition}`;
              if (limit !== undefined)
                statement = sql`${statement} LIMIT ${limit}`;
              if (locked) statement = sql`${statement} FOR UPDATE`;
              const q = compile(statement, locked),
                connection =
                  staleSnapshot &&
                  getTableName(table) === "catalog_nodes" &&
                  !locked
                    ? snapshot
                    : memory;
              return connection.prepare(q.sql).all(...params(q.params));
            })
            .then(resolve, reject);
        },
      };
      return builder;
    },
    async execute(statement: any) {
      const q = compile(statement, true),
        result = memory.prepare(q.sql).all(...params(q.params));
      onLeafLock?.();
      onLeafLock = undefined;
      return [result, []];
    },
    insert(table: any) {
      return {
        values: async (value: Record<string, any>) => {
          const entries = Object.entries(value).filter(
              ([, v]) => v !== undefined
            ),
            columns = entries.map(([key]) => sql.identifier(key));
          const values = entries.map(([, v]) =>
            typeof v === "object" && v !== null
              ? JSON.stringify(v)
              : typeof v === "boolean"
                ? Number(v)
                : v
          );
          const q = compile(
            sql`INSERT INTO ${table} (${sql.join(columns, sql`,`)}) VALUES (${sql.join(
              values.map(v => sql`${v}`),
              sql`,`
            )})`
          );
          const result = memory.prepare(q.sql).run(...params(q.params));
          return [{ insertId: Number(result.lastInsertRowid) }];
        },
      };
    },
    update(table: any) {
      return {
        set: (value: any) => ({
          where: async (condition: any) => {
            const assignments = Object.entries(value).map(
              ([key, v]) =>
                sql`${sql.identifier(key)}=${typeof v === "boolean" ? Number(v) : v}`
            );
            const q = compile(
              sql`UPDATE ${table} SET ${sql.join(assignments, sql`,`)} WHERE ${condition}`
            );
            memory.prepare(q.sql).run(...params(q.params));
          },
        }),
      };
    },
    async transaction(work: any) {
      memory.exec("BEGIN");
      inTransaction = true;
      try {
        const result = await work(database);
        memory.exec("COMMIT");
        return result;
      } catch (error) {
        memory.exec("ROLLBACK");
        throw error;
      } finally {
        inTransaction = false;
      }
    },
  };
  const add = (value: ReturnType<typeof node>) => {
    const entries = Object.entries(value);
    memory
      .prepare(
        "INSERT INTO catalog_nodes (" +
          entries.map(([k]) => k).join(",") +
          ") VALUES (" +
          entries.map(() => "?").join(",") +
          ")"
      )
      .run(...entries.map(([, v]) => v));
  };
  const rows = (name: string) => memory.prepare("SELECT * FROM " + name).all();
  const state = () => ({
    items: rows("catalog_items"),
    attachments: rows("attachments"),
    audit: rows("catalog_audit_logs"),
    fileAudit: rows("audit_logs"),
  });
  return {
    database,
    memory,
    queries,
    add,
    rows,
    state,
    simulateWaitedMove(change: () => void) {
      staleSnapshot = true;
      snapshot.exec("DELETE FROM catalog_nodes");
      for (const value of rows("catalog_nodes"))
        snapshot
          .prepare("INSERT INTO catalog_nodes VALUES(?,?,?,?,?,?,?)")
          .run(...Object.values(value));
      onLeafLock = change;
    },
  };
}
const fileName = "server/routers/catalog/catalog.router.ts";
const source = ts.createSourceFile(
  fileName,
  readFileSync(fileName, "utf8"),
  ts.ScriptTarget.Latest,
  true
);
function actualItemsProperty(name: string) {
  let result = "";
  const visit = (n: ts.Node) => {
    if (
      ts.isPropertyAssignment(n) &&
      n.name.getText(source) === "items" &&
      ts.isCallExpression(n.initializer) &&
      n.initializer.expression.getText(source) === "router"
    ) {
      const object = n.initializer.arguments[0];
      if (ts.isObjectLiteralExpression(object))
        for (const property of object.properties)
          if (
            ts.isPropertyAssignment(property) &&
            property.name.getText(source) === name
          )
            result = property.initializer.getText(source);
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  if (!result) throw Error("Missing actual catalog.items." + name);
  return result;
}
function api(f: ReturnType<typeof fixture>) {
  const helpers = [
    "assertActiveCatalogNodePath",
    "getLeafCategoryCodeState",
    "assertCatalogCodeAvailable",
  ]
    .map(name => {
      const found = source.statements.find(
        n => ts.isFunctionDeclaration(n) && n.name?.text === name
      );
      if (!found) throw Error("Missing helper " + name);
      return found.getText(source);
    })
    .join("\n");
  const script =
    helpers +
    "\n({create:(" +
    actualItemsProperty("create") +
    "),update:(" +
    actualItemsProperty("update") +
    "),previewNextCode:(" +
    actualItemsProperty("previewNextCode") +
    ")})";
  const procedures = vm.runInNewContext(
    ts.transpileModule(script, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      z,
      TRPCError,
      APP_ROLE,
      eq,
      and,
      like,
      ne,
      sql,
      catalogNodes,
      catalogItems,
      catalogCodeAliases,
      catalogAuditLogs,
      catalogItemManagerProcedure,
      catalogItemUpdateProcedure,
      catalogItemImageSchema,
      assertCatalogImageUpload,
      saveRequiredCatalogImage,
      REQUIRE_CATALOG_IMAGE_ON_EDIT,
      isCatalogItemCodeForNode,
      nextCatalogItemCode,
      isItCatalogCreationRoot,
      IT_CATALOG_CREATION_DENIED,
      getDb: async () => f.database,
      assertActiveCatalogMasterUnit: async (_db: any, value: any) => value,
      catalogAuditRequestMeta: () => ({}),
      catalogAuditJson: (value: any) => JSON.stringify(value),
      pickAuditValues: (value: any) => value,
    }
  );
  const app = router({ catalog: router({ items: router(procedures) }) });
  return (role = "it_manager", isActive = 1) => {
    const user = { id: 9, role, isActive };
    return app.createCaller({
      user,
      authenticatedUser: user,
      req: {},
      res: {},
    } as any).catalog.items;
  };
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("Catalog creation-only presentation scope", () => {
  it("uses exact canonical root and parent links, not names, IDs or prefixes", () => {
    const values = [
      node(81, null, "10"),
      node(82, 81, "legacy-code"),
      node(83, 82, "wrong-prefix"),
      node(10, null, "99"),
      node(11, 10, "10-01"),
      node(12, null, "100"),
    ];
    expect([...getCatalogCreationNodeIds("it_manager", values)!]).toEqual([
      81, 82, 83,
    ]);
    for (const role of [
      "owner",
      "admin",
      "warehouse",
      "maintenance_manager",
      "construction_procurement_manager",
      undefined,
    ])
      expect(getCatalogCreationNodeIds(role, values)).toBeNull();
  });
  it.each(
    [
      [],
      [node(1, null, "100")],
      [node(1, null, "10", 2)],
      [node(1, 7, "10", 1)],
      [node(1, null, "10"), node(2, null, "10")],
      [node(1, null, "10"), node(1, null, "99")],
    ].map(values => [values])
  )("fails closed for missing/malformed/ambiguous root %j", values => {
    expect([...getCatalogCreationNodeIds("it_manager", values)!]).toEqual([]);
  });
  it("bounds disconnected cycles and excludes orphans", () => {
    const values = [
      node(1, null, "10"),
      node(2, 1, "10-01"),
      node(3, 4, "10-02"),
      node(4, 3, "10-03"),
      node(5, 999, "10-04"),
    ];
    expect([...getCatalogCreationNodeIds("it_manager", values)!]).toEqual([
      1, 2,
    ]);
  });
});
describe("Actual catalog.items.create RPC uses fresh IT ancestry", () => {
  it("accepts descendants under differently numbered IT root with original code/image/audit", async () => {
    const f = fixture();
    f.add(node(81, null, "10"));
    f.add(node(82, 81, "10-01"));
    f.add(node(83, 82, "10-01-01", 3));
    const result = await api(f)().create(newItem(83));
    expect(result).toBe(1);
    expect(f.rows("catalog_items")[0]).toMatchObject({
      nodeId: 83,
      code: "10-01-01-001",
    });
    expect(f.rows("attachments")[0]).toMatchObject({
      entityId: 1,
      uploadedById: 9,
    });
    expect(f.rows("catalog_audit_logs")[0]).toMatchObject({
      action: "create",
      userId: 9,
    });
    const locks = f.queries.filter(
      q => q.locked && q.sql.startsWith("SELECT * FROM `catalog_nodes`")
    );
    expect(locks.map(q => q.params[0])).toEqual([83, 82, 81]);
    expect(locks.every(q => q.inTransaction)).toBe(true);
  });
  it("allows root itself only when it is a valid leaf", async () => {
    const f = fixture();
    f.add(node(81, null, "10"));
    const call = api(f)();
    await call.create(newItem(81));
    f.add(node(82, 81, "10-01"));
    await expect(call.create(newItem(81))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(f.rows("catalog_items")).toHaveLength(1);
  });
  it.each(
    [
      [node(10, null, "99"), node(20, 10, "10-01")],
      [node(1, null, "100")],
      [node(1, null, "10", 2)],
      [node(1, null, "99"), node(2, 1, "10", 1)],
    ].map(values => [values])
  )("rejects direct foreign-root creation before writes %j", async values => {
    const f = fixture();
    values.forEach(f.add);
    await expect(
      api(f)().create(newItem(values.at(-1)!.id))
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: IT_CATALOG_CREATION_DENIED,
    });
    expect(f.state()).toEqual({
      items: [],
      attachments: [],
      audit: [],
      fileAudit: [],
    });
  });
  it.each(["missing", "cycle", "inactive", "depth"])(
    "retains %s path denial",
    async mode => {
      const f = fixture();
      let id = 2;
      if (mode === "missing") f.add(node(2, 999, "10-01"));
      if (mode === "cycle") {
        f.add(node(1, 2, "10"));
        f.add(node(2, 1, "10-01"));
      }
      if (mode === "inactive") {
        f.add({ ...node(1, null, "10"), isActive: 0 });
        f.add(node(2, 1, "10-01"));
      }
      if (mode === "depth") {
        for (let i = 1; i <= 10; i++)
          f.add(node(i, i === 1 ? null : i - 1, "10-" + i, i));
        id = 10;
      }
      await expect(api(f)().create(newItem(id))).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(f.state()).toEqual({
        items: [],
        attachments: [],
        audit: [],
        fileAudit: [],
      });
      expect(
        f.queries.filter(q => q.sql.startsWith("SELECT * FROM `catalog_nodes`"))
          .length
      ).toBeLessThanOrEqual(8);
    }
  );
  it("rejects an old snapshot after waiting for taxonomy move", async () => {
    const f = fixture();
    f.add(node(1, null, "10"));
    f.add(node(2, 1, "10-01"));
    f.add(node(3, null, "99"));
    f.simulateWaitedMove(() =>
      f.memory.exec("UPDATE catalog_nodes SET parentId=3 WHERE id=2")
    );
    await expect(api(f)().create(newItem(2))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(f.state()).toEqual({
      items: [],
      attachments: [],
      audit: [],
      fileAudit: [],
    });
    expect(
      f.queries
        .filter(
          q => q.locked && q.sql.startsWith("SELECT * FROM `catalog_nodes`")
        )
        .map(q => q.params[0])
    ).toEqual([2, 3]);
  });
  it("rechecks current tree on consecutive create requests", async () => {
    const f = fixture();
    f.add(node(1, null, "10"));
    f.add(node(2, 1, "10-01"));
    f.add(node(3, null, "99"));
    const call = api(f)();
    await call.create(newItem(2));
    f.memory.exec("UPDATE catalog_nodes SET parentId=3 WHERE id=2");
    await expect(call.create(newItem(2))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(f.rows("catalog_items")).toHaveLength(1);
    expect(f.rows("attachments")).toHaveLength(1);
  });
  it.each([
    "owner",
    "admin",
    "senior_management",
    "construction_procurement_manager",
    "maintenance_manager",
    "warehouse",
  ])("preserves %s creation elsewhere without extra path locks", async role => {
    const f = fixture();
    f.add(node(1, null, "99"));
    await api(f)(role).create(newItem(1));
    expect(f.rows("catalog_items")).toHaveLength(1);
    expect(
      f.queries.some(
        q => q.locked && q.sql.startsWith("SELECT * FROM `catalog_nodes`")
      )
    ).toBe(false);
  });
  it("keeps IT existing-item save, category move and preview unrestricted", async () => {
    const f = fixture();
    f.add(node(1, null, "99"));
    f.add(node(2, null, "88"));
    f.memory.exec(
      "INSERT INTO catalog_items(id,code,nodeId,nameAr,nameEn,isActive) VALUES(7,'99-001',1,'قديم','Existing',1)"
    );
    const call = api(f)();
    await call.update({ id: 7, nameAr: "معدل" });
    expect(f.rows("catalog_items")[0].nameAr).toBe("معدل");
    await call.update({ id: 7, nodeId: 2, code: "88-001" });
    expect(f.rows("catalog_items")[0]).toMatchObject({
      nodeId: 2,
      code: "88-001",
    });
    await expect(call.previewNextCode({ nodeId: 1 })).resolves.toMatchObject({
      nodeId: 1,
      code: "99-001",
    });
    expect(
      f.queries.some(
        q => q.locked && q.sql.startsWith("SELECT * FROM `catalog_nodes`")
      )
    ).toBe(false);
  });
  it("preserves actor/activity, image and explicit-code validation", async () => {
    const f = fixture();
    f.add(node(1, null, "10"));
    const make = api(f);
    await expect(
      make("it_manager", 0).create(newItem(1))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(make("it_member").create(newItem(1))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      make().create({ ...newItem(1), image: undefined } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      make().create({
        ...newItem(1),
        image: { ...image, fileKey: "cmms/uploads/u-8/foreign.webp" },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      make().create({ ...newItem(1), code: "99-001" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.state()).toEqual({
      items: [],
      attachments: [],
      audit: [],
      fileAudit: [],
    });
  });
});
