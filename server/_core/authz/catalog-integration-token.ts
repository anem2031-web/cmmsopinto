import { createHash, randomBytes } from "node:crypto";
import type { RequestHandler } from "express";

const authorizationPattern = /^Bearer (cmms_cat_[A-Za-z0-9_-]{43})$/i;

export function catalogIntegrationTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createCatalogIntegrationTokenValue() {
  return `cmms_cat_${randomBytes(32).toString("base64url")}`;
}

export function createCatalogIntegrationTokenGuard(
  isActiveToken: (tokenHash: string) => Promise<boolean>,
): RequestHandler {
  return async (req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    const token = authorizationPattern.exec(req.get("Authorization") ?? "")?.[1];
    if (token) {
      try {
        if (await isActiveToken(catalogIntegrationTokenHash(token))) {
          next();
          return;
        }
      } catch {
        res.status(503).json({ error: "Catalog authorization is temporarily unavailable" });
        return;
      }
    }
    res.setHeader("WWW-Authenticate", 'Bearer realm="CMMS catalog"');
    res.status(401).json({ error: "A valid catalog integration token is required" });
  };
}
