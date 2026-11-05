import { useTranslation } from "@/contexts/LanguageContext";
import { operationalIssueText } from "@/i18n/operationalIssues";
import { OperationalIssueQueue } from "./OperationalIssueQueue";
export default function OperationalWarehouseRequests({ returnsOnly = false, embedded = false, search = "" }: {
  returnsOnly?: boolean; embedded?: boolean; search?: string;
} = {}) {
  const { language } = useTranslation();
  return <div className="space-y-4">{!embedded && <h2 className="text-xl font-bold">{operationalIssueText[language].title}</h2>}<OperationalIssueQueue process returnsOnly={returnsOnly} search={search} /></div>;
}
