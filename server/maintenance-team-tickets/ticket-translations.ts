import type { AssignedTeamTicket } from "../../shared/maintenance-team-tickets/assignment";
import type { SupportedLanguage } from "../services/translation/translation";
import type { getBatchTranslations, TranslatableField } from "../services/translation/translationEngine";

const fields = ["title", "description"] as const;

export interface TeamTicketTranslationSource {
  ticketId: number;
  userId: number;
  title: string;
  description?: string | null;
}

export async function queueTeamTicketTranslations(ticket: TeamTicketTranslationSource): Promise<void> {
  const [{ detectLanguage }, { queueTranslation }] = await Promise.all([
    import("../services/translation/translation"),
    import("../services/translation/translationEngine"),
  ]);

  const fieldsByLanguage = new Map<SupportedLanguage, TranslatableField[]>();
  for (const fieldName of fields) {
    const text = ticket[fieldName];
    if (!text?.trim()) continue;
    const sourceLanguage = await detectLanguage(text);
    const sourceFields = fieldsByLanguage.get(sourceLanguage) ?? [];
    sourceFields.push({ fieldName, text });
    fieldsByLanguage.set(sourceLanguage, sourceFields);
  }

  await Promise.all(Array.from(fieldsByLanguage, ([sourceLanguage, sourceFields]) =>
    queueTranslation({
      entityType: "TICKET",
      entityId: ticket.ticketId,
      fields: sourceFields,
      sourceLanguage,
      userId: ticket.userId,
    })
  ));
}

/** The assignment queue has already applied team membership and limits results to 200 rows. */
export async function localizeTeamTicketQueue(
  tickets: AssignedTeamTicket[],
  language: SupportedLanguage,
  reader?: typeof getBatchTranslations,
): Promise<AssignedTeamTicket[]> {
  if (!tickets.length) return tickets;
  const ids = Array.from(new Set(tickets.map(ticket => ticket.ticketId)));
  const read = reader ?? (await import("../services/translation/translationEngine")).getBatchTranslations;
  const translations = await read("TICKET", ids, language, [...fields]);

  return tickets.map(ticket => {
    const translated = translations[ticket.ticketId];
    return {
      ...ticket,
      title: translated?.title?.text || ticket.title,
      description: translated?.description?.text || ticket.description,
    };
  });
}
