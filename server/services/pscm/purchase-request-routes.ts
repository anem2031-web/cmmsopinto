import { createHash, timingSafeEqual } from "node:crypto";
import express, {
  type Application,
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import { z } from "zod";
import {
  PscmPurchaseError,
  pscmPurchaseInstance,
  pscmPurchasePath,
  pscmPurchasePayload,
  pscmPurchaseToken,
  type PscmPurchaseConfirmation,
  type PscmPurchasePayload,
} from "./purchase-request-contract";

type ImportPurchase = (
  payload: PscmPurchasePayload,
  requesterId: number
) => Promise<PscmPurchaseConfirmation & { created: boolean }>;

const importPurchase: ImportPurchase = async (payload, requesterId) =>
  (await import("./purchase-request-service")).importApprovedPscmPurchase(
    payload,
    requesterId
  );

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest();
const invalidJson: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  const tooLarge = error.status === 413;
  res
    .status(tooLarge ? 413 : 400)
    .json({ error: tooLarge ? "body_too_large" : "invalid_json" });
};
const requisitionReadInput = z.strictObject({
  instanceId: z.string().regex(pscmPurchaseInstance),
  requisitionIds: z.array(z.number().int().min(1).max(2_147_483_647)).min(1).max(100),
});

export function registerPscmPurchaseRequestRoutes(
  app: Application,
  settings: { token?: string; requesterId?: string; instanceId?: string },
  ingest: ImportPurchase = importPurchase,
  fulfillment = async (instanceId: string, requisitionIds: number[]) =>
    (await import("./fulfillment-read")).getPscmFulfillment(instanceId, requisitionIds),
  materialCosts = async (instanceId: string, requisitionIds: number[]) =>
    (await import("./material-costs-read")).getPscmMaterialCosts(instanceId, requisitionIds)
) {
  const { token, requesterId: rawId, instanceId = "pscm" } = settings;
  const requesterId = Number(rawId);
  const expected =
    token && pscmPurchaseToken.test(token) ? tokenHash(token) : null;
  const configured =
    rawId &&
    /^[1-9][0-9]{0,9}$/.test(rawId) &&
    requesterId <= 2_147_483_647 &&
    pscmPurchaseInstance.test(instanceId);

  const authorize: RequestHandler = (req, res, next) => {
    res
      .set({
        "Cache-Control": "private, no-store",
        "Surrogate-Control": "no-store",
      })
      .vary("Authorization");
    if (!expected || !configured)
      return res.status(503).json({ error: "integration_unavailable" });
    const received = /^Bearer (\S+)$/i.exec(
      req.get("Authorization") ?? ""
    )?.[1];
    if (
      !received ||
      !pscmPurchaseToken.test(received) ||
      !timingSafeEqual(tokenHash(received), expected)
    ) {
      return res
        .set("WWW-Authenticate", 'Bearer realm="CMMS PSCM purchase requests"')
        .status(401)
        .json({ error: "invalid_purchase_token" });
    }
    if (req.method !== "POST") {
      return res
        .set("Allow", "POST")
        .status(405)
        .json({ error: "method_not_allowed" });
    }
    if (!req.is("application/json"))
      return res.status(400).json({ error: "invalid_content_type" });
    next();
  };
  const receive: RequestHandler = async (req, res) => {
    const parsed = pscmPurchasePayload.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "invalid_payload" });
    const payload = parsed.data;
    if (payload.source.instanceId !== instanceId) {
      return res.status(403).json({ error: "invalid_source_instance" });
    }
    const key = `${instanceId}:${payload.source.requisitionNumber}`;
    if (payload.idempotencyKey !== key || req.get("Idempotency-Key") !== key) {
      return res.status(400).json({ error: "invalid_idempotency_key" });
    }
    try {
      const { created, purchaseRequestId, purchaseRequestNumber } =
        await ingest(payload, requesterId);
      return res
        .status(created ? 201 : 200)
        .json({ purchaseRequestId, purchaseRequestNumber });
    } catch (error) {
      if (error instanceof PscmPurchaseError) {
        const status =
          error.code === "source_conflict"
            ? 409
            : error.code === "requester_unavailable"
              ? 503
              : 422;
        console.warn("[PSCM purchase] Import rejected.", {
          sourceReference: payload.source.requisitionNumber,
          reason: error.code,
        });
        return res.status(status).json({ error: error.code });
      }
      console.error("[PSCM purchase] Failed to import approved requisition.");
      return res.status(503).json({ error: "integration_unavailable" });
    }
  };
  app.all(
    pscmPurchasePath,
    authorize,
    express.json({ limit: 1_500_000, inflate: false }),
    receive,
    invalidJson
  );
  const registerRead = (
    path: string,
    lookup: (source: string, ids: number[]) => Promise<unknown>,
    logMessage: string
  ) => {
    const read: RequestHandler = async (req, res) => {
      const parsed = requisitionReadInput.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "invalid_payload" });
      if (parsed.data.instanceId !== instanceId)
        return res.status(403).json({ error: "invalid_source_instance" });
      try {
        return res.json(await lookup(instanceId, parsed.data.requisitionIds));
      } catch {
        console.error(logMessage);
        return res.status(503).json({ error: "integration_unavailable" });
      }
    };
    app.all(path, authorize, express.json({ limit: 8_192, inflate: false }), read, invalidJson);
  };
  registerRead("/api/v1/pscm/fulfillment", fulfillment, "[PSCM purchase] Could not load warehouse fulfillment.");
  registerRead("/api/v1/pscm/material-costs", materialCosts, "[PSCM purchase] Could not load warehouse material costs.");
}
