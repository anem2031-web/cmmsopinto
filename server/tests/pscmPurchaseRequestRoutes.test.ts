import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import {
  PscmPurchaseError,
  type PscmPurchasePayload,
} from "../services/pscm/purchase-request-contract";
import { registerPscmPurchaseRequestRoutes } from "../services/pscm/purchase-request-routes";

const token = "cmms_pr_" + "X".repeat(43);
const settings = { token, requesterId: "53", instanceId: "pscm-live" };
const idempotencyKey = "pscm-live:MR-26-11-0014";
const confirmation = {
  purchaseRequestId: 19,
  purchaseRequestNumber: "PR-2026-0019",
};

function approvedPayload() {
  return {
    schemaVersion: 1,
    idempotencyKey,
    source: {
      system: "PSCM",
      instanceId: "pscm-live",
      requisitionId: 21,
      requisitionNumber: "MR-26-11-0014",
      requesterName: "أحمد وائل",
      approvedAt: "2026-11-16T09:30:00.000Z",
      project: { id: 88, number: "PRJ-26-11-0084", name: "مشروع الصيانة" },
      task: { id: 6, name: "مضخات المياه" },
    },
    items: [
      {
        sequence: 1,
        itemName: "مضخة",
        catalogItemId: "14021",
        catalogCode: "CO-181",
        quantity: "3.000",
        unit: { code: "PCS", nameAr: "قطعة", nameEn: "Piece", nameUr: "عدد" },
        specifications: "مضخة مياه",
        notes: "تُسلّم للموقع",
        needDate: "2026-11-24",
        siteId: 17,
        sectionId: 50,
        assetId: null,
        categoryId: 2,
        reviewRole: "construction_procurement_manager",
      },
    ],
  };
}

const createIngest = () =>
  vi.fn(async (_payload: PscmPurchasePayload, _requesterId: number) => ({
    ...confirmation,
    created: true,
  }));

const createFulfillment = () => vi.fn(async (_instance: string, _requisitions: number[]) => ({
  items: [{ requisitionId: 21, sequence: 1, unit: "قطعة", receivedQuantity: 5,
    readyQuantity: 3, issuedQuantity: 2, deliveries: [{ number: "DLV-2026-0001", quantity: 2 }] }],
}));

async function withHttpServer(
  check: (
    url: string,
    ingest: ReturnType<typeof createIngest>,
    fulfillment: ReturnType<typeof createFulfillment>
  ) => Promise<void>,
  config: Parameters<typeof registerPscmPurchaseRequestRoutes>[1] = settings
) {
  const app = express();
  const ingest = createIngest();
  const fulfillment = createFulfillment();
  registerPscmPurchaseRequestRoutes(app, config, ingest, fulfillment);
  app.use(express.json({ limit: "1mb" }));
  const server = await new Promise<ReturnType<typeof app.listen>>(
    (resolve, reject) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      listener.once("error", reject);
    }
  );
  try {
    const { port } = server.address() as AddressInfo;
    await check(
      `http://127.0.0.1:${port}/api/v1/pscm/purchase-requests`,
      ingest,
      fulfillment
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
}

function send(
  url: string,
  body: string,
  overrides: Record<string, string> = {}
) {
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      ...overrides,
    },
    body,
  });
}

async function expectError(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ error });
}

describe("PSCM purchase request HTTP API", () => {
  it("returns fulfillment only for the authenticated PSCM instance", async () => {
    await withHttpServer(async (url, ingest, fulfillment) => {
      const path = new URL("fulfillment", url).href;
      await expectError(await send(path, "{", { Authorization: "Bearer incorrect" }), 401, "invalid_purchase_token");
      await expectError(await send(path, JSON.stringify({ instanceId: "other", requisitionIds: [21] })), 403, "invalid_source_instance");
      await expectError(await send(path, JSON.stringify({ instanceId: settings.instanceId, requisitionIds: [] })), 400, "invalid_payload");
      expect(fulfillment).not.toHaveBeenCalled();
      const response = await send(path, JSON.stringify({ instanceId: settings.instanceId, requisitionIds: [21] }), { "Idempotency-Key": "" });
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ items: [{ issuedQuantity: 2, readyQuantity: 3 }] });
      expect(fulfillment).toHaveBeenCalledWith("pscm-live", [21]);
      expect(ingest).not.toHaveBeenCalled();
    });
  });

  it("authenticates the dedicated write credential before parsing the payload", async () => {
    await withHttpServer(async (url, ingest) => {
      for (const authorization of [
        "",
        `Bearer cmms_ref_${"X".repeat(43)}`,
        `Bearer cmms_cat_${"X".repeat(43)}`,
        `Bearer cmms_pr_${"Y".repeat(43)}`,
      ]) {
        const response = await send(url, "{", { Authorization: authorization });
        expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
        expect(response.headers.get("Vary")).toContain("Authorization");
        await expectError(response, 401, "invalid_purchase_token");
      }
      const get = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(get.headers.get("Allow")).toBe("POST");
      await expectError(get, 405, "method_not_allowed");
      expect(ingest).not.toHaveBeenCalled();
    });
  });

  it("fails closed without a configured requester", async () => {
    await withHttpServer(
      async (url, ingest) => {
        await expectError(
          await send(url, JSON.stringify(approvedPayload())),
          503,
          "integration_unavailable"
        );
        expect(ingest).not.toHaveBeenCalled();
      },
      { token, instanceId: settings.instanceId }
    );
  });

  it("accepts the approved PSCM wire format and returns the same PR for a replay", async () => {
    await withHttpServer(async (url, ingest) => {
      ingest.mockResolvedValueOnce({ ...confirmation, created: true });
      ingest.mockResolvedValueOnce({ ...confirmation, created: false });
      const payload = JSON.stringify(approvedPayload());
      const first = await send(url, payload);
      expect(first.status).toBe(201);
      expect(await first.json()).toEqual(confirmation);
      const replay = await send(url, payload);
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual(confirmation);
      expect(ingest).toHaveBeenCalledTimes(2);
      expect(ingest).toHaveBeenNthCalledWith(
        1,
        {
          ...approvedPayload(),
          items: [{ ...approvedPayload().items[0], catalogItemId: 14021 }],
        },
        53
      );
      expect(ingest.mock.calls[1]).toEqual(ingest.mock.calls[0]);
    });
  });

  it("requires the configured source and a matching key in the body and header", async () => {
    await withHttpServer(async (url, ingest) => {
      const payload = approvedPayload();
      await expectError(
        await send(url, JSON.stringify(payload), { "Idempotency-Key": "" }),
        400,
        "invalid_idempotency_key"
      );
      await expectError(
        await send(
          url,
          JSON.stringify({ ...payload, idempotencyKey: "wrong" })
        ),
        400,
        "invalid_idempotency_key"
      );
      payload.source.instanceId = "another-instance";
      payload.idempotencyKey = "another-instance:MR-26-11-0014";
      await expectError(
        await send(url, JSON.stringify(payload), {
          "Idempotency-Key": payload.idempotencyKey,
        }),
        403,
        "invalid_source_instance"
      );
      expect(ingest).not.toHaveBeenCalled();
    });
  });

  it("rejects missing approval evidence and repeated item sequences", async () => {
    await withHttpServer(async (url, ingest) => {
      const payload = approvedPayload();
      for (const invalidPayload of [
        { ...payload, source: { ...payload.source, approvedAt: undefined } },
        { ...payload, items: [payload.items[0], { ...payload.items[0] }] },
      ]) {
        await expectError(
          await send(url, JSON.stringify(invalidPayload)),
          400,
          "invalid_payload"
        );
      }
      expect(ingest).not.toHaveBeenCalled();
    });
  });

  it("returns actionable conflicts and validation errors with generic infrastructure errors", async () => {
    await withHttpServer(async (url, ingest) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const payload = JSON.stringify(approvedPayload());
        ingest.mockRejectedValueOnce(new PscmPurchaseError("source_conflict"));
        await expectError(await send(url, payload), 409, "source_conflict");
        ingest.mockRejectedValueOnce(
          new PscmPurchaseError("unsupported_quantity")
        );
        await expectError(
          await send(url, payload),
          422,
          "unsupported_quantity"
        );
        ingest.mockRejectedValueOnce(
          new PscmPurchaseError("requester_unavailable")
        );
        await expectError(
          await send(url, payload),
          503,
          "requester_unavailable"
        );
        ingest.mockRejectedValueOnce(new Error("private database failure"));
        await expectError(
          await send(url, payload),
          503,
          "integration_unavailable"
        );
      } finally {
        warn.mockRestore();
        error.mockRestore();
      }
    });
  });

  it("rejects invalid JSON, unsupported content type and oversized bodies before import", async () => {
    await withHttpServer(async (url, ingest) => {
      await expectError(
        await send(url, "{}", { "Content-Type": "text/plain" }),
        400,
        "invalid_content_type"
      );
      await expectError(await send(url, "{"), 400, "invalid_json");
      await expectError(
        await send(url, JSON.stringify({ large: "A".repeat(1_500_000) })),
        413,
        "body_too_large"
      );
      expect(ingest).not.toHaveBeenCalled();
    });
  });
});
