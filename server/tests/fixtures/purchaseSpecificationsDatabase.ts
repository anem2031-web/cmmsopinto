import { createRequire } from "node:module";
import { getTableName, sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

/** Disposable SQL adapter: no application pool, environment file, or network. */
export function purchaseSpecificationsDatabase() {
  const memory = new DatabaseSync(":memory:");
  memory.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,isActive INTEGER,name TEXT,signatureUrl TEXT);
    CREATE TABLE purchase_orders(id INTEGER PRIMARY KEY,poNumber TEXT,status TEXT,requestedById INTEGER,ticketId INTEGER,ticketItemId INTEGER,packageId INTEGER,siteId INTEGER,sectionId INTEGER,createdAt TEXT);
    CREATE TABLE purchase_order_items(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER,itemName TEXT,quantity NUMERIC,unit TEXT,status TEXT,reviewRole TEXT,reviewedById INTEGER,reviewedAt TEXT,catalogItemId INTEGER,purchasedPhotoUrl TEXT,invoicePhotoUrl TEXT,warehousePhotoUrl TEXT,supplierName TEXT,supplierInvoiceNumber TEXT,deliveryNumber TEXT,deliveredAt TEXT,deliveredById INTEGER,deliveredToId INTEGER);
    CREATE TABLE warehouse_receipts(id INTEGER PRIMARY KEY,receiptNumber TEXT,purchaseOrderId INTEGER,status TEXT,vendorName TEXT,invoiceNumber TEXT,invoiceDate TEXT,invoicePhotoUrl TEXT,goodsPhotoUrl TEXT,receivedById INTEGER,receivedAt TEXT,createdAt TEXT);
    CREATE TABLE warehouse_receipt_items(id INTEGER PRIMARY KEY,receiptId INTEGER,purchaseOrderItemId INTEGER,inventoryId INTEGER,itemName TEXT,catalogItemId INTEGER,receivedQuantity NUMERIC,purchaseUnit TEXT,unitCost TEXT,lineTotal TEXT);
    CREATE TABLE warehouses(id INTEGER PRIMARY KEY,nameAr TEXT,nameEn TEXT,code TEXT,type TEXT,isActive INTEGER);
    CREATE TABLE inventory(id INTEGER PRIMARY KEY,warehouseId INTEGER,linkedItemId INTEGER,itemName TEXT,unit TEXT,issueUnit TEXT,quantity NUMERIC,averageCost NUMERIC,totalCostValue NUMERIC);
    CREATE TABLE inventory_lots(id INTEGER PRIMARY KEY,lotCode TEXT,trackingToken TEXT,sourceType TEXT,catalogItemId INTEGER,receiptId INTEGER,receiptItemId INTEGER,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,catalogSupplierId INTEGER,supplierCandidateId INTEGER,sourceCountOperationId INTEGER,sourceSettlementId INTEGER,sourceSettlementItemId INTEGER,originalQuantity NUMERIC,remainingQuantity NUMERIC,purchaseUnit TEXT,issueUnit TEXT,conversionFactor NUMERIC,purchaseUnitCost NUMERIC,issueUnitCost NUMERIC,supplierItemName TEXT,supplierItemCode TEXT,batchNumber TEXT,expiryDate TEXT,createdById INTEGER,createdAt TEXT DEFAULT CURRENT_TIMESTAMP,updatedAt TEXT,specificationStatus TEXT,specificationRevision INTEGER DEFAULT 0,specificationReviewedById INTEGER,specificationReviewedAt TEXT,specificationNotes TEXT);
    CREATE TABLE inventory_lot_number_counter(year INTEGER PRIMARY KEY,lastNumber INTEGER);
    CREATE TABLE inventory_lot_balances(id INTEGER PRIMARY KEY,lotId INTEGER,inventoryId INTEGER,quantity NUMERIC,UNIQUE(lotId,inventoryId));
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,userId INTEGER,action TEXT,entityType TEXT,entityId INTEGER,oldValues TEXT,newValues TEXT,createdAt TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE warehouse_returns(id INTEGER PRIMARY KEY,lotId INTEGER,receiptId INTEGER,returnedQuantity NUMERIC,returnNumber TEXT,createdAt TEXT);
    CREATE TABLE inventory_transactions(id INTEGER PRIMARY KEY,inventoryId INTEGER,lotId INTEGER,type TEXT,quantity NUMERIC,unitCost NUMERIC,totalCost NUMERIC,transactionType TEXT,receiptId INTEGER,purchaseOrderItemId INTEGER,reason TEXT,ticketId INTEGER,performedById INTEGER,documentUrl TEXT);
    CREATE TABLE catalog_suppliers(id INTEGER PRIMARY KEY,nameAr TEXT,nameEn TEXT,isActive INTEGER);
    CREATE TABLE supplier_candidates(id INTEGER PRIMARY KEY,nameAr TEXT,nameEn TEXT);
    CREATE TABLE inventory_count_items(id INTEGER PRIMARY KEY,operationId INTEGER,inventoryId INTEGER,lotId INTEGER,diffQuantity NUMERIC);
    CREATE TABLE inventory_count_operations(id INTEGER PRIMARY KEY,status TEXT,warehouseId INTEGER,operationNumber TEXT,countType TEXT);
    CREATE TABLE inventory_count_snapshots(id INTEGER PRIMARY KEY,operationId INTEGER,inventoryId INTEGER,lotId INTEGER);
    CREATE TABLE inventory_settlement_items(id INTEGER PRIMARY KEY,settlementId INTEGER,inventoryId INTEGER,lotId INTEGER);
    CREATE TABLE inventory_settlements(id INTEGER PRIMARY KEY,operationId INTEGER,sourceCountOperationId INTEGER,status TEXT);
  `);
  memory.function("GREATEST", { varargs: true }, (...values: number[]) => Math.max(...values));
  memory.function("LEAST", { varargs: true }, (...values: number[]) => Math.min(...values));
  const dialect = new MySqlDialect();
  const queries: Array<{ sql: string; params: any[] }> = [];
  const parameter = (value: any) => Object.prototype.toString.call(value) === "[object Date]" ? value.toISOString().slice(0, 19).replace("T", " ") : typeof value === "boolean" ? Number(value) : value;
  const execute = async (statement: any): Promise<any> => {
    const raw = typeof statement === "string" ? { sql: statement, params: [] } : dialect.sqlToQuery(statement);
    const text = raw.sql.replace(/\s+FOR UPDATE\b/gi, "").replace(/\bNOW\(\)/g, "CURRENT_TIMESTAMP")
      .replace(/ON DUPLICATE KEY UPDATE lastNumber = lastNumber \+ 1/i, "ON CONFLICT(year) DO UPDATE SET lastNumber = lastNumber + 1");
    const params = raw.params.map(parameter);
    queries.push({ sql: raw.sql, params });
    const prepared = memory.prepare(text);
    if (/^\s*(SELECT|WITH)\b/i.test(text)) return [prepared.all(...params), []];
    const result = prepared.run(...params);
    return [{ affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) }, []];
  };
  const db: any = {
    execute,
    select(selection?: Record<string, any>) {
      let table: any, predicate: any, ordering: any[] = [], limit: number | undefined, offset: number | undefined;
      const joins: Array<{ kind: string; table: any; on: any }> = [];
      const run = async () => (await execute(sql`SELECT ${selection
        ? sql.join(Object.entries(selection).map(([key, column]) => sql`${column} AS ${sql.identifier(key)}`), sql`, `)
        : sql.raw('`' + getTableName(table) + '`.*')} FROM ${table}
        ${sql.join(joins.map(join => sql`${sql.raw(join.kind)} JOIN ${join.table} ON ${join.on}`), sql` `)}
        ${predicate ? sql`WHERE ${predicate}` : sql``}
        ${ordering.length ? sql`ORDER BY ${sql.join(ordering, sql`, `)}` : sql``}
        ${limit != null ? sql`LIMIT ${limit}` : sql``} ${offset != null ? sql`OFFSET ${offset}` : sql``}`))[0];
      const chain: any = {
        from(value: any) { table = value; return chain; },
        where(value: any) { predicate = value; return chain; },
        innerJoin(value: any, on: any) { joins.push({ kind: "INNER", table: value, on }); return chain; },
        leftJoin(value: any, on: any) { joins.push({ kind: "LEFT", table: value, on }); return chain; },
        orderBy(...value: any[]) { ordering = value; return chain; },
        limit(value: number) { limit = value; return chain; },
        offset(value: number) { offset = value; return chain; },
        for() { return chain; },
        then(resolve: any, reject: any) { return Promise.resolve().then(run).then(resolve, reject); },
      };
      return chain;
    },
    update(table: any) {
      return { set(values: Record<string, unknown>) { return { where(predicate: any) {
        return execute(sql`UPDATE ${table} SET ${sql.join(Object.entries(values).map(([key, value]) => sql`${sql.identifier(key)}=${value}`), sql`, `)} WHERE ${predicate}`);
      } }; } };
    },
    insert(table: any) {
      return { values(value: Record<string, unknown> | Array<Record<string, unknown>>) {
        const rows = Array.isArray(value) ? value : [value], keys = Object.keys(rows[0]).filter(key => rows[0][key] !== undefined);
        const query = sql`INSERT INTO ${table} (${sql.join(keys.map(key => sql.identifier(key)), sql`,`)}) VALUES ${sql.join(rows.map(row => sql`(${sql.join(keys.map(key => sql`${row[key]}`), sql`,`)})`), sql`,`)}`;
        const chain: any = {
          then(resolve: any, reject: any) { return execute(query).then(resolve, reject); },
          onDuplicateKeyUpdate({ set }: { set: Record<string, unknown> }) {
            return execute(sql`${query} ON CONFLICT(lotId,inventoryId) DO UPDATE SET ${sql.join(Object.entries(set).map(([key, value]) => sql`${sql.identifier(key)}=${value}`), sql`, `)}`);
          },
        };
        return chain;
      } };
    },
  };
  let chain = Promise.resolve();
  db.transaction = (work: (tx: any) => Promise<any>) => {
    const result = chain.then(async () => {
      memory.exec("BEGIN");
      try { const value = await work(db); memory.exec("COMMIT"); return value; }
      catch (error) { memory.exec("ROLLBACK"); throw error; }
    });
    chain = result.then(() => undefined, () => undefined);
    return result;
  };
  const insert = (table: string, row: Record<string, any>) => {
    const keys = Object.keys(row);
    memory.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map(key => parameter(row[key])));
  };
  return { db, memory, queries, insert, close: () => memory.close() };
}
