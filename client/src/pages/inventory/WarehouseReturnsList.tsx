import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Plus } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { SupplierReturns } from "@/components/purchase/SupplierReturns";
import { RejectedSpecificationReturns } from "@/components/purchase/PurchaseSpecifications";
import { WarehouseReturnDocuments } from "@/components/inventory/WarehouseReturnDocuments";


export default function WarehouseReturnsList() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const canCreateReturn = user?.role === "warehouse" || user?.role === "admin" || user?.role === "owner";

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/inventory")}>
          <ArrowRight className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">المرتجعات</h1>
          <p className="text-sm text-muted-foreground">كل عمليات الإرجاع المحفوظة</p>
        </div>
        {canCreateReturn && <Button size="sm" className="gap-1.5" onClick={() => navigate("/warehouse/return")}>
          <Plus className="w-4 h-4" /> مرتجع جديد
        </Button>}
      </div>

      {canCreateReturn && <RejectedSpecificationReturns />}
      {canCreateReturn && <SupplierReturns />}

      <WarehouseReturnDocuments />
    </div>
  );
}
