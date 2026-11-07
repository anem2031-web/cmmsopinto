// Explicit read-only capture. Does not import application DB clients or execute SQL writers.
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { approvedBundleCondition, approvedBundleSnapshot } from "../../server/services/delegate-pricing-bundles/approved-document";
import { LEGACY_DPB_CORRECTIONS, legacyDocumentSource } from "../../server/services/delegate-pricing-bundles/fixed-approved-document";

const value = (key: string) => process.argv[process.argv.indexOf(key) + 1];
const expectedDatabase = value("--database"), output = value("--output");
if (!process.argv.includes("--database") || !process.argv.includes("--output") || !expectedDatabase || !output)
  throw Error("Required: --database COPYCMMS2 --output <private-source.json>");
const config = dotenv.parse(fs.readFileSync(".env", "utf8"));
const uri = new URL(config.DATABASE_URL);
if (decodeURIComponent(uri.pathname.slice(1)).toLowerCase() !== expectedDatabase.toLowerCase()) throw Error("Database target mismatch");
// This process only; never changes .env or the application process.
Object.assign(process.env, config);
const { getSignatureDataUrl } = await import("../../server/services/pdf/signatureImage");
const connection = await mysql.createConnection({ host: uri.hostname, port: Number(uri.port || 3306), user: decodeURIComponent(uri.username),
  password: decodeURIComponent(uri.password), database: expectedDatabase, ssl: { rejectUnauthorized: true }, connectTimeout: 15000, multipleStatements: false });
const dialect = new MySqlDialect();
const database = { execute: async (statement: any) => {
  const query = dialect.sqlToQuery(statement);
  if (!/^SELECT\b/i.test(query.sql.trim()) || /;|FOR\s+UPDATE|INTO\s+(OUTFILE|DUMPFILE)/i.test(query.sql)) throw Error("Only SELECT statements are allowed");
  return connection.execute({ sql: query.sql, values: query.params, timeout: 30000 });
} };
try {
  const [[identity]] = await database.execute(sql`SELECT DATABASE() AS databaseName,CURRENT_TIMESTAMP AS capturedAt`);
  if (String(identity.databaseName).toLowerCase() !== expectedDatabase.toLowerCase()) throw Error("Connected database mismatch");
  const [bundles] = await database.execute(sql`SELECT b.id,b.bundleNumber,b.delegateId,b.snapshotJson,b.pdfContent FROM delegate_pricing_bundles b
    WHERE b.bundleNumber IN (${sql.join(LEGACY_DPB_CORRECTIONS.map(number => sql`${number}`), sql`,`)})
    AND b.status IN ('sent','archived') AND ${approvedBundleCondition()}
    AND NOT EXISTS (SELECT 1 FROM delegate_pricing_bundle_approvals a WHERE a.bundleId=b.id) ORDER BY b.id`);
  if (bundles.length !== LEGACY_DPB_CORRECTIONS.length) throw Error("The reviewed twelve legacy approvals are not all available");
  const signatures = new Map<string, string>();
  const signature = async (source: string | null) => {
    if (!source) return "";
    if (!signatures.has(source)) {
      const bytes = await getSignatureDataUrl(source);
      if (!bytes) throw Error("An existing captured signature could not be read; generation stopped");
      signatures.set(source, bytes);
    }
    return signatures.get(source)!;
  };
  const documents = [];
  for (const bundle of bundles) {
    const before = await legacyDocumentSource(database, bundle);
    const snapshot = typeof bundle.snapshotJson === "string" ? JSON.parse(bundle.snapshotJson) : bundle.snapshotJson;
    if (snapshot.number !== bundle.bundleNumber || Number(snapshot.delegate?.id) !== Number(bundle.delegateId)) throw Error("Snapshot identity mismatch");
    const [members] = await database.execute(sql`SELECT m.purchaseOrderItemId,i.purchaseOrderId FROM delegate_pricing_bundle_items m
      LEFT JOIN purchase_order_items i ON i.id=m.purchaseOrderItemId WHERE m.bundleId=${Number(bundle.id)} AND m.removedAt IS NULL`);
    if (!Array.isArray(snapshot.rows) || !snapshot.rows.length || snapshot.rows.length > 20 || !Array.isArray(snapshot.signatures)
      || members.length !== snapshot.rows.length || new Set(members.map((m: any) => Number(m.purchaseOrderItemId))).size !== members.length
      || snapshot.rows.some((row: any) => !members.some((m: any) => Number(m.purchaseOrderItemId) === Number(row.id) && Number(m.purchaseOrderId) === Number(row.purchaseOrderId)))) throw Error("Full snapshot membership mismatch");
    const approved = await approvedBundleSnapshot(database, bundle, snapshot, signature);
    if ((approved.financialApprovals?.length || 0) < 2) throw Error("Not a multiple-scope legacy document");
    const after = await legacyDocumentSource(database, bundle);
    if (before.sourceHash !== after.sourceHash) throw Error("Source changed during capture");
    if (bundle.pdfContent != null && (!Buffer.isBuffer(bundle.pdfContent) || bundle.pdfContent.subarray(0,5).toString() !== "%PDF-")) throw Error("Invalid stored delegate PDF");
    documents.push({ id: Number(bundle.id), number: bundle.bundleNumber, ...after, approved, delegateSnapshot: snapshot,
      delegatePdfBase64: bundle.pdfContent == null ? null : bundle.pdfContent.toString("base64") });
    console.log(JSON.stringify({ number: bundle.bundleNumber, scopes: approved.financialApprovals!.length, status: "captured-read-only" }));
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ database: identity.databaseName, capturedAt: identity.capturedAt, documents }, null, 2));
  console.log("Captured exactly twelve documents. Database writes: zero.");
} finally { await connection.end(); }
