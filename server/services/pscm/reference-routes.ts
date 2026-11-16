import { createHash, timingSafeEqual } from "node:crypto";
import type { Application } from "express";
import { z } from "zod";
import { readPscmReferences, type ReferenceDatabase } from "./reference-data";

const path = "/api/v1/pscm/references";
const tokenFormat = /^cmms_ref_[A-Za-z0-9_-]{43}$/;
const maxResponseBytes = 1_000_000;
const id = z
  .string()
  .regex(/^[1-9][0-9]{0,9}$/)
  .transform(Number)
  .pipe(z.number().max(2_147_483_647));
const locale = z.enum(["ar", "en", "ur"]).default("ar");
const referenceQuery = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("sites"), locale }),
  z.strictObject({ type: z.literal("sections"), siteId: id, locale }),
  z.strictObject({
    type: z.literal("assets"),
    siteId: id,
    sectionId: id,
    locale,
  }),
  z.strictObject({ type: z.literal("purchaseOptions"), locale }),
]);

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest();
const getReferenceDatabase = async () =>
  (await import("../../_core/db/client")).getDb();

export function registerPscmReferenceRoutes(
  app: Application,
  token?: string,
  database: () => Promise<ReferenceDatabase | null> = getReferenceDatabase
) {
  const expected = token && tokenFormat.test(token) ? tokenHash(token) : null;

  app.all(path, async (req, res) => {
    res
      .set({
        "Cache-Control": "private, no-store",
        "Surrogate-Control": "no-store",
      })
      .vary("Authorization");
    if (!expected) {
      return res
        .status(503)
        .json({ error: "Reference integration is not configured" });
    }
    const received = /^Bearer (\S+)$/i.exec(
      req.get("Authorization") ?? ""
    )?.[1];
    if (
      !received ||
      !tokenFormat.test(received) ||
      !timingSafeEqual(tokenHash(received), expected)
    ) {
      return res
        .set("WWW-Authenticate", 'Bearer realm="CMMS PSCM references"')
        .status(401)
        .json({ error: "A valid reference read token is required" });
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return res
        .set("Allow", "GET, HEAD")
        .status(405)
        .json({ error: "Method not allowed" });
    }
    const query = referenceQuery.safeParse(req.query);
    if (!query.success)
      return res.status(400).json({ error: "Invalid reference query" });

    try {
      const db = await database();
      if (!db) return res.status(503).json({ error: "References unavailable" });
      const payload = JSON.stringify(await readPscmReferences(db, query.data));
      if (Buffer.byteLength(payload) > maxResponseBytes) {
        return res.status(503).json({ error: "References unavailable" });
      }
      return res.type("application/json").send(payload);
    } catch {
      return res.status(503).json({ error: "References unavailable" });
    }
  });
}
