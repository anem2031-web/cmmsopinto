import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { FileText, Package, Plus, RotateCcw, Search, ShieldX, Users } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SupplierReturns } from "@/components/purchase/SupplierReturns";
import { RejectedSpecificationReturns } from "@/components/purchase/PurchaseSpecifications";
import { WarehouseReturnDocuments } from "@/components/inventory/WarehouseReturnDocuments";
import Pmv2WarehouseQueue from "@/pages/pmv2/Pmv2WarehouseQueue";
import TicketWarehouseRequests from "@/pages/maintenance-teams/TicketWarehouseRequests";
import OperationalWarehouseRequests from "@/pages/operational-issues/OperationalWarehouseRequests";
import { returnsCenterLabels } from "@/i18n/returnsCenter";
import {
  canAccessReturnsCenter, canCreateReturn, getReturnsCenterPanels,
  RETURNS_MATERIAL_SOURCES, returnsCenterLink,
  type ReturnsCenterPanel, type ReturnsMaterialSource,
} from "@shared/returns-center";

const panelIcons = { suppliers: Package, materials: Users, specifications: ShieldX, documents: FileText };

export function returnsCenterSelection(search: string, panels: readonly ReturnsCenterPanel[]) {
  const params = new URLSearchParams(search);
  const requestedPanel = params.get("tab");
  const panel = panels.includes(requestedPanel as ReturnsCenterPanel) ? requestedPanel as ReturnsCenterPanel : panels[0];
  const requestedSource = params.get("source");
  const source: ReturnsMaterialSource = (RETURNS_MATERIAL_SOURCES as readonly string[]).includes(requestedSource || "")
    ? requestedSource as ReturnsMaterialSource : "tickets";
  return { panel, source };
}

/** Only the selected, permitted source is mounted, including its existing queries. */
export function ReturnsCenterContent({ panel, source, language }: { panel: ReturnsCenterPanel; source: ReturnsMaterialSource; language: string }) {
  const [search, setSearch] = useState("");
  const [documentCategory, setDocumentCategory] = useState<"all" | "supplier" | "recipient">("all");
  const labels = returnsCenterLabels(language);
  return <div className="min-w-0 space-y-4">
    <div className="rounded-xl border bg-card p-4 sm:p-5">
      {panel === "documents" && <div className="mb-4 max-w-sm space-y-2">
        <label htmlFor="returns-center-document-category" className="block text-sm font-medium">{labels.documentCategory}</label>
        <select id="returns-center-document-category" value={documentCategory} onChange={event => setDocumentCategory(event.target.value as typeof documentCategory)}
          className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {(["all", "supplier", "recipient"] as const).map(value => <option key={value} value={value}>{labels.documentCategories[value]}</option>)}
        </select>
      </div>}
      <label htmlFor="returns-center-search" className="mb-2 block text-sm font-medium">{labels.searchLabel}</label>
      <div className="flex min-w-0 items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input id="returns-center-search" type="search" value={search} onChange={event => setSearch(event.target.value)}
            placeholder={labels.searchPlaceholder} className="ps-9" aria-describedby="returns-center-search-hint" />
        </div>
        {!!search && <Button type="button" variant="outline" onClick={() => setSearch("")} className="shrink-0">{labels.clearSearch}</Button>}
      </div>
      <p id="returns-center-search-hint" className="mt-2 text-xs leading-5 text-muted-foreground">{labels.searchHint}</p>
    </div>
    <div className="min-w-0" data-returns-center-source={`${panel}:${panel === "materials" ? source : ""}`}>
      {panel === "suppliers" && <SupplierReturns centerMode search={search} />}
      {panel === "specifications" && <RejectedSpecificationReturns centerMode search={search} />}
      {panel === "documents" && <WarehouseReturnDocuments category={documentCategory} search={search} />}
      {panel === "materials" && source === "tickets" && <TicketWarehouseRequests section="returns" embedded search={search} />}
      {panel === "materials" && source === "pmv2" && <Pmv2WarehouseQueue section="returns" embedded search={search} />}
      {panel === "materials" && source === "operational" && <OperationalWarehouseRequests returnsOnly embedded search={search} />}
    </div>
  </div>;
}

export default function ReturnsCenter() {
  const { authenticatedUser, loading } = useAuth();
  const { language, dir } = useTranslation();
  const search = useSearch();
  const [, navigate] = useLocation();
  const labels = returnsCenterLabels(language);
  if (loading) return <p className="p-4 text-sm text-muted-foreground" role="status">{labels.loading}</p>;
  if (!authenticatedUser || Number(authenticatedUser.isActive) !== 1 || !canAccessReturnsCenter(authenticatedUser.role)) {
    return <p className="p-4 text-sm text-muted-foreground" role="alert">{labels.forbidden}</p>;
  }
  const panels = getReturnsCenterPanels(authenticatedUser.role);
  const { panel, source } = returnsCenterSelection(search, panels);
  if (!panel) return null;
  const columns = panels.length === 1 ? "grid-cols-1" : panels.length === 2 ? "grid-cols-1 sm:grid-cols-2"
    : panels.length === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 min-[400px]:grid-cols-2 xl:grid-cols-4";

  return <main dir={dir} className="mx-auto w-full min-w-0 max-w-7xl space-y-5 p-3 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><RotateCcw className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />{labels.title}</h1>
        <p className="text-sm leading-6 text-muted-foreground">{labels.description}</p>
      </div>
      {canCreateReturn(authenticatedUser.role) && <Button type="button" onClick={() => navigate(`/warehouse/return?returnTo=returns-center&returnTab=${panel}`)} className="gap-2">
        <Plus className="h-4 w-4" aria-hidden="true" />{labels.newReturn}
      </Button>}
    </header>
    <nav role="tablist" aria-label={labels.panelsLabel} className={`grid gap-2 ${columns}`}>
      {panels.map(value => {
        const Icon = panelIcons[value];
        return <button key={value} id={`returns-tab-${value}`} type="button" role="tab" aria-selected={panel === value}
          aria-controls="returns-center-panel" onClick={() => navigate(returnsCenterLink(value, value === "materials" ? "tickets" : undefined))}
          className={`flex min-w-0 items-center justify-center gap-2 rounded-xl border px-3 py-3 text-center text-sm font-medium leading-6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${panel === value ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-card text-foreground hover:bg-muted"}`}>
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{labels.panels[value].title}</span>
        </button>;
      })}
    </nav>
    <section id="returns-center-panel" role="tabpanel" aria-labelledby={`returns-tab-${panel}`} className="min-w-0 space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{labels.panels[panel].title}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{labels.panels[panel].description}</p>
      </div>
      {panel === "materials" && <nav aria-label={labels.materialsLabel} className="grid grid-cols-1 gap-2 rounded-xl bg-muted/60 p-2 sm:grid-cols-3">
        {RETURNS_MATERIAL_SOURCES.map(value => <Button key={value} type="button" variant={source === value ? "default" : "ghost"}
          aria-pressed={source === value} className="h-auto min-h-10 whitespace-normal" onClick={() => navigate(returnsCenterLink("materials", value))}>{labels.sources[value]}</Button>)}
      </nav>}
      <ReturnsCenterContent key={`${authenticatedUser.id}:${authenticatedUser.role}:${panel}:${panel === "materials" ? source : ""}`} panel={panel} source={source} language={language} />
    </section>
  </main>;
}
