import { useAuth } from "@/_core/hooks/useAuth";
import { Wrench, ShieldAlert } from "lucide-react";
import ExternalMaintenanceWarehouseTab from "./ExternalMaintenanceWarehouseTab";
import { useLanguage } from "@/contexts/LanguageContext";

export default function ExternalMaintenance() {
  const { user } = useAuth();
  const { t, dir } = useLanguage();
  const w = t.workflow.purchase;
  const role = user?.role;
  const isAllowed = role === "warehouse" || role === "senior_management" || role === "owner" || role === "admin";

  if (!isAllowed) {
    return (
      <div dir={dir} className="p-4 max-w-3xl mx-auto">
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <ShieldAlert className="w-10 h-10 text-muted-foreground" />
          <h1 className="text-lg font-bold">{w.externalMaintenanceAccessDenied}</h1>
          <p className="text-sm text-muted-foreground">
            {w.externalMaintenanceWarehouseOnly}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div dir={dir} className="p-4 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Wrench className="w-6 h-6 text-primary" />
        <h1 className="text-xl font-bold">{w.externalAssetMaintenance}</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        {w.externalMaintenancePageHelp}
      </p>

      <ExternalMaintenanceWarehouseTab />
    </div>
  );
}
