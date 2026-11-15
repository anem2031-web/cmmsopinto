import type { Application, RequestHandler } from "express";
import { z } from "zod";
import { normalizeMediaKey } from "../../_core/authz/media-access";
import {
  readCatalogIntegration,
  resolveCatalogIntegrationImage,
  type CatalogIntegrationDatabase,
} from "./integration-reader";

const catalogPaths = [
  "/api/v1/catalog/items",
  "/api/v1/catalog/pscm/items",
] as const;
const imagePath = "/api/v1/catalog/items/:itemId/image/:attachmentId";
const maxImageBytes = 5_000_000;
const maxStoredImageBytes = 16 * 1024 * 1024;

type CatalogIntegrationDependencies = {
  database(): Promise<CatalogIntegrationDatabase | null>;
  openImage(key: string): Promise<NodeJS.ReadableStream>;
};

const productionDependencies: CatalogIntegrationDependencies = {
  database: async () => (await import("../../_core/db/client")).getDb(),
  openImage: async key =>
    (await (await import("../../_core/storage")).storageGetStream(key)).stream,
};

const integerString = (max: number) =>
  z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/)
    .transform(Number)
    .pipe(z.number().int().max(max));
const itemId = integerString(2147483647);
const requestSchema = z.object({
  q: z.string().trim().max(150).optional().default(""),
  page: integerString(2147483647).optional().default(1),
  pageSize: integerString(100).optional().default(20),
  locale: z.enum(["ar", "en", "ur"]).optional().default("ar"),
  ids: z.string().max(400).optional(),
});
const idsSchema = z
  .array(itemId)
  .min(1)
  .max(20)
  .refine(ids => new Set(ids).size === ids.length);
const imageParamsSchema = z.object({ itemId, attachmentId: itemId });

function parseCatalogQuery(values: unknown) {
  const parsed = requestSchema.safeParse(values);
  if (!parsed.success) return null;
  const { ids: rawIds, ...query } = parsed.data;
  if (rawIds === undefined) return query;
  if (query.q) return null;
  try {
    const selected = idsSchema.safeParse(JSON.parse(rawIds));
    return selected.success ? { ...query, ids: selected.data } : null;
  } catch {
    return null;
  }
}

function configuredOrigin(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

function rasterType(buffer: Buffer) {
  if (
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
    return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6)))
    return "image/gif";
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}

async function readImage(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxStoredImageBytes) return null;
    chunks.push(buffer);
  }
  const bytes = Buffer.concat(chunks, total);
  const type = rasterType(bytes);
  if (type && total <= maxImageBytes) return { type, bytes };

  // Older catalog attachments and oversized rasters need a PSCM-compatible image.
  const tiff = ["49492a00", "4d4d002a"].includes(
    bytes.subarray(0, 4).toString("hex")
  );
  if (!type && !tiff && bytes.toString("ascii", 0, 2) !== "BM") return null;
  try {
    const sharp = (await import("sharp")).default;
    const converted = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 75, effort: 2 })
      .toBuffer();
    return converted.length <= maxImageBytes
      ? { type: "image/webp", bytes: converted }
      : null;
  } catch {
    return null;
  }
}

export function registerCatalogIntegrationRoutes(
  app: Application,
  requireCatalogIntegrationToken: RequestHandler,
  publicOrigin?: string,
  dependencies: CatalogIntegrationDependencies = productionDependencies
) {
  const origin = configuredOrigin(publicOrigin);
  for (const path of catalogPaths) {
    const pscmCompatible = path === catalogPaths[1];
    app.get(path, requireCatalogIntegrationToken, async (req, res) => {
      const query = parseCatalogQuery(req.query);
      if (!query)
        return res.status(400).json({ error: "Invalid catalog query" });
      if (!origin)
        return res
          .status(503)
          .json({
            error: "Catalog integration public origin is not configured",
          });
      try {
        const db = await dependencies.database();
        if (!db) return res.status(503).json({ error: "Catalog unavailable" });
        const result = await readCatalogIntegration(
          db,
          query,
          pscmCompatible,
          origin
        );
        if (!result)
          return res
            .status(404)
            .json({ error: "One or more catalog items are unavailable" });
        return res.json(result);
      } catch {
        return res.status(503).json({ error: "Catalog unavailable" });
      }
    });
  }

  app.get(imagePath, requireCatalogIntegrationToken, async (req, res) => {
    const selected = imageParamsSchema.safeParse(req.params);
    if (!selected.success)
      return res.status(400).json({ error: "Invalid catalog image reference" });
    try {
      const db = await dependencies.database();
      if (!db) return res.status(503).json({ error: "Catalog unavailable" });
      const { itemId: item, attachmentId } = selected.data;
      const linkedKey = await resolveCatalogIntegrationImage(
        db,
        item,
        attachmentId
      );
      if (!linkedKey)
        return res.status(404).json({ error: "Catalog image unavailable" });

      let key: string;
      try {
        key = normalizeMediaKey(linkedKey);
      } catch {
        return res.status(404).json({ error: "Catalog image unavailable" });
      }
      if (key.startsWith("cmms/backups/"))
        return res.status(404).json({ error: "Catalog image unavailable" });
      const image = await readImage(await dependencies.openImage(key));
      if (!image)
        return res.status(415).json({ error: "Unsupported catalog image" });
      return res
        .set("X-Content-Type-Options", "nosniff")
        .type(image.type)
        .send(image.bytes);
    } catch {
      return res.status(503).json({ error: "Catalog image unavailable" });
    }
  });

  app.all(
    [...catalogPaths, imagePath],
    requireCatalogIntegrationToken,
    (_req, res) =>
      res
        .set("Allow", "GET, HEAD")
        .status(405)
        .json({ error: "Method not allowed" })
  );
}
