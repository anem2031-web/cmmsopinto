import * as db from "../../db";
import { detectLanguage, translateFields, type SupportedLanguage } from "../../services/translation";

export { detectLanguage, translateFields };
export type { SupportedLanguage };

/**
 * Notify a list of users fetched by role.
 */
export async function notifyByRole(
  role: string,
  notification: { title: string; message: string; type: string; relatedTicketId?: number; relatedPOId?: number }
) {
  const users = await db.getUsersByRole(role);
  for (const user of users) {
    await db.createNotification({ userId: user.id, ...notification });
  }
}

/**
 * Notify maintenance managers.
 */
export async function notifyManagers(
  notification: { title: string; message: string; type: string; relatedTicketId?: number; relatedPOId?: number },
  excludeUserId?: number
) {
  const managers = await db.getManagerUsers();
  for (const mgr of managers) {
    if (excludeUserId && mgr.id === excludeUserId) continue;
    await db.createNotification({ userId: mgr.id, ...notification });
  }
}

/**
 * Auto-translate text fields and return translation map.
 */
export async function autoTranslate(
  fields: Record<string, string>,
  logPrefix = "[translate]"
): Promise<Record<string, any>> {
  if (Object.keys(fields).length === 0) return {};
  try {
    const firstValue = Object.values(fields)[0];
    const lang = (await detectLanguage(firstValue)) as SupportedLanguage;
    const translations = await translateFields(fields, lang);
    const result: Record<string, any> = { originalLanguage: lang };
    for (const [key, val] of Object.entries(translations)) {
      if (val) {
        result[`${key}_ar`] = val.ar;
        result[`${key}_en`] = val.en;
        result[`${key}_ur`] = val.ur;
      }
    }
    return result;
  } catch (e) {
    console.error(`${logPrefix} Translation failed:`, e);
    return {};
  }
}
