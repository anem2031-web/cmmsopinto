import { useLocation, useSearch } from "wouter";
import type { ReactNode } from "react";
import { useTranslation } from "@/contexts/LanguageContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  WAREHOUSE_REQUESTS_PATH,
  warehouseRequestsLink,
  warehouseRequestsSelection,
} from "@shared/maintenance-team-tickets/warehouse-navigation";
import Pmv2WarehouseQueue from "./Pmv2WarehouseQueue";
import TicketWarehouseRequests from "../maintenance-teams/TicketWarehouseRequests";
import OperationalWarehouseRequests from "../operational-issues/OperationalWarehouseRequests";
import { operationalIssueText } from "@/i18n/operationalIssues";
import WarehouseRequestDocuments from "./WarehouseRequestDocuments";

export default function WarehouseRequestsPage() {
  const { language, dir } = useTranslation();
  const search = useSearch();
  const [, navigate] = useLocation();
  const { source, ticketId } = warehouseRequestsSelection(search);
  const panel = new URLSearchParams(search).get("panel") === "documents" ? "documents" : "operations";
  const sourceTabs = (operations: ReactNode) => <Tabs value={panel} dir={dir} className="space-y-4" onValueChange={value => {
    const query = new URLSearchParams(search);
    if (value === "documents") query.set("panel", "documents"); else query.delete("panel");
    navigate(`${WAREHOUSE_REQUESTS_PATH}${query.size ? `?${query}` : ""}`);
  }}>
    <TabsList aria-label={language === "ar" ? "العمليات والمستندات" : language === "ur" ? "کارروائیاں اور دستاویزات" : "Operations and documents"}>
      <TabsTrigger value="operations">{language === "ar" ? "العمليات" : language === "ur" ? "کارروائیاں" : "Operations"}</TabsTrigger>
      <TabsTrigger value="documents">{language === "ar" ? "المستندات" : language === "ur" ? "دستاویزات" : "Documents"}</TabsTrigger>
    </TabsList>
    <TabsContent value="operations">{panel === "operations" && operations}</TabsContent>
    <TabsContent value="documents">{panel === "documents" && <WarehouseRequestDocuments key={source} source={source}/>}</TabsContent>
  </Tabs>;
  return (
    <Tabs
      value={source}
      dir={dir}
      className="space-y-4"
      onValueChange={value =>
        navigate(
          value === "operational" ? `${WAREHOUSE_REQUESTS_PATH}?source=operational` : value === "tickets"
            ? warehouseRequestsLink()
            : WAREHOUSE_REQUESTS_PATH
        )
      }
    >
      <TabsList
        aria-label={
          language === "ar"
            ? "مصدر طلبات المستودع"
            : language === "ur"
              ? "گودام کی درخواست کا ماخذ"
              : "Warehouse request source"
        }
      >
        <TabsTrigger value="pmv2">PMV2</TabsTrigger>
        <TabsTrigger value="tickets">
          {language === "ar"
            ? "تذاكر الصيانة"
            : language === "ur"
              ? "مرمت کے ٹکٹ"
              : "Maintenance Tickets"}
        </TabsTrigger>
        <TabsTrigger value="operational">{operationalIssueText[language].title}</TabsTrigger>
      </TabsList>
      <TabsContent value="pmv2">
        {source === "pmv2" && sourceTabs(<Pmv2WarehouseQueue />)}
      </TabsContent>
      <TabsContent value="operational">{source === "operational" && sourceTabs(<OperationalWarehouseRequests />)}</TabsContent>
      <TabsContent value="tickets">
        {source === "tickets" && (
          sourceTabs(<TicketWarehouseRequests ticketId={ticketId} />)
        )}
      </TabsContent>
    </Tabs>
  );
}
