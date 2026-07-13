import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import CatalogDashboard from "@/pages/catalog/CatalogDashboard";
import { Route, Switch } from "wouter";
import ErrorBoundary from "@/components/common/ErrorBoundary";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Login from "@/pages/auth/Login";
import Home from "@/pages/dashboard/Home";
import Tickets from "@/pages/tickets/Tickets";
import ImprovementIdeas from "@/pages/improvement/ImprovementIdeas";
import TicketDetail from "@/pages/tickets/TicketDetail";
import CreateTicket from "@/pages/tickets/CreateTicket";
import PurchaseOrders from "@/pages/purchase/PurchaseOrders";
import PurchaseOrderDetail from "@/pages/purchase/PurchaseOrderDetail";
import CreatePurchaseOrder from "@/pages/purchase/CreatePurchaseOrder";
import Inventory from "@/pages/inventory/Inventory";
import InventoryOperations from "@/pages/inventory/InventoryOperations";
import Reports from "@/pages/reports/Reports";
import UsersPage from "@/pages/admin/Users";
import Sites from "@/pages/admin/Sites";
import Sections from "@/pages/admin/Sections";
import Technicians from "@/pages/admin/Technicians";
import Notifications from "@/pages/admin/Notifications";
import AuditLog from "@/pages/admin/AuditLog";
import AIAssistant from "@/pages/ai/AIAssistant";
import TechnicianReport from "@/pages/reports/TechnicianReport";
import MyItems from "@/pages/inventory/MyItems";
import TranslationMonitor from "@/pages/admin/TranslationMonitor";
import PurchaseCycle from "@/pages/purchase/PurchaseCycle";
import ItemTracker from "@/pages/inventory/ItemTracker";
import PurchaseCycleReport from "@/pages/reports/PurchaseCycleReport";
import MaintenanceCycleReport from "@/pages/reports/MaintenanceCycleReport";
import SectionReport from "@/pages/reports/SectionReport";
import PreventiveReport from "@/pages/reports/PreventiveReport";
import Backup from "@/pages/admin/Backup";
import Assets from "@/pages/assets/Assets";
import AssetHistory from "@/pages/assets/AssetHistory";
import AssetMetrics from "@/pages/assets/AssetMetrics";
import PreventiveMaintenance from "@/pages/preventive/PreventiveMaintenance";
import TriageDashboard from "@/pages/tickets/TriageDashboard";
import GateSecurity from "@/pages/assets/GateSecurity";
import ScanAsset from "@/pages/assets/ScanAsset";
import CostReport from "@/pages/reports/CostReport";
import Dashboard from "@/pages/dashboard/Dashboard";
import AssetDetail from "@/pages/assets/AssetDetail";
import AssetCategories from "@/pages/assets/AssetCategories";
import WarehouseReceive from "@/pages/inventory/WarehouseReceive";
import WarehouseReceiveV2 from "@/pages/inventory/WarehouseReceiveV2";
import InventoryStandaloneReceive from "@/pages/inventory/InventoryStandaloneReceive";
import InvoiceDraftReview from "@/pages/inventory/InvoiceDraftReview";
import WarehouseReturn from "@/pages/inventory/WarehouseReturn";
import WarehouseReturnsList from "@/pages/inventory/WarehouseReturnsList";
import ConstructionDashboard from "@/pages/construction/ConstructionDashboard";
import ProjectsList from "@/pages/construction/ProjectsList";
import ProjectDetail from "@/pages/construction/ProjectDetail";
import ProjectForm from "@/pages/construction/ProjectForm";
import ConstructionReports from "@/pages/construction/ConstructionReports";

function Router() {
  return (
    <Switch>
      {/* Standalone login page - outside DashboardLayout */}
      <Route path="/login" component={Login} />

      {/* All other routes inside DashboardLayout */}
      <Route>
        <DashboardLayout>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/tickets" component={Tickets} />
            <Route path="/improvement-ideas" component={ImprovementIdeas} />
            <Route path="/tickets/new" component={CreateTicket} />
            <Route path="/tickets/:id" component={TicketDetail} />
            <Route path="/purchase-orders" component={PurchaseOrders} />
            <Route path="/purchase-orders/new" component={CreatePurchaseOrder} />
            <Route path="/purchase-orders/edit-draft/:id" component={CreatePurchaseOrder} />
            <Route path="/purchase-orders/:id" component={PurchaseOrderDetail} />
            <Route path="/purchase-cycle" component={PurchaseCycle} />
            <Route path="/item-tracker" component={ItemTracker} />
            <Route path="/my-items" component={MyItems} />
            <Route path="/inventory" component={Inventory} />
            <Route path="/inventory-operations" component={InventoryOperations} />
            <Route path="/reports" component={Reports} />
            <Route path="/reports/technicians" component={TechnicianReport} />
            <Route path="/reports/purchase-cycle" component={PurchaseCycleReport} />
            <Route path="/reports/maintenance-cycle" component={MaintenanceCycleReport} />
            <Route path="/reports/section-report" component={SectionReport} />
            <Route path="/reports/preventive" component={PreventiveReport} />
            <Route path="/users" component={UsersPage} />
            <Route path="/sites" component={Sites} />
            <Route path="/sections" component={Sections} />
            <Route path="/technicians" component={Technicians} />
            <Route path="/notifications" component={Notifications} />
            <Route path="/audit-log" component={AuditLog} />
            <Route path="/ai-assistant" component={AIAssistant} />
            <Route path="/translation-monitor" component={TranslationMonitor} />
            <Route path="/backup" component={Backup} />
            <Route path="/assets" component={Assets} />
            <Route path="/assets/history" component={AssetHistory} />
            <Route path="/assets/metrics" component={AssetMetrics} />
            <Route path="/preventive" component={PreventiveMaintenance} />
            <Route path="/triage" component={TriageDashboard} />
            <Route path="/gate-security" component={GateSecurity} />
            <Route path="/scan-asset" component={ScanAsset} />
            <Route path="/reports/cost" component={CostReport} />
            <Route path="/asset/:id" component={AssetDetail} />
            <Route path="/asset-categories" component={AssetCategories} />
            {/* ⛔ مُعطّلة مؤقتاً (قيد الاختبار قبل الحذف النهائي) — استُبدلت بـ WarehouseReceiveV2 */}
            <Route path="/warehouse/receive" component={NotFound} />
            <Route path="/warehouse/receive-v2" component={WarehouseReceiveV2} />
            <Route path="/inventory/receive" component={InventoryStandaloneReceive} />
            {/* ⛔ مُعطّلة (مسار "مسودة/اعتماد الفاتورة" — لا يوجد أي رابط لها بالواجهة، وغير
                مستخدمة بعملية الاستلام الفعلية التي تمر عبر WarehouseReceiveV2 مباشرة.
                كما أن processApprovedReceiptItems (الدالة التي تنفّذها عند الاعتماد) بها
                خلل محاسبي: الصنف الجديد يُنشأ برصيد 0 ولا يُحدَّث عند تسجيل حركة الدخول.
                لفكّ التجميد: أعد المسار الأصلي أدناه (سطر واحد) بعد إصلاح processApprovedReceiptItems. */}
            <Route path="/warehouse/invoice-draft" component={NotFound} />
            {/* <Route path="/warehouse/invoice-draft" component={InvoiceDraftReview} /> */}
            <Route path="/warehouse/return" component={WarehouseReturn} />
            <Route path="/warehouse/returns" component={WarehouseReturnsList} />
            <Route path="/inspection-dashboard" component={Dashboard} />
            <Route path="/catalog" component={CatalogDashboard} />
            {/* Construction Module */}
            <Route path="/construction" component={ConstructionDashboard} />
            <Route path="/construction/projects" component={ProjectsList} />
            <Route path="/construction/projects/new" component={ProjectForm} />
            <Route path="/construction/projects/:id/edit" component={ProjectForm} />
            <Route path="/construction/projects/:id" component={ProjectDetail} />
            <Route path="/construction/reports" component={ConstructionReports} />
            <Route path="/404" component={NotFound} />
            <Route component={NotFound} />
          </Switch>
        </DashboardLayout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <LanguageProvider>
          <TooltipProvider>
            <Toaster position="top-center" richColors />
            <Router />
          </TooltipProvider>
        </LanguageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
