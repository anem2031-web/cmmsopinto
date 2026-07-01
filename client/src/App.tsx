import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import CatalogDashboard from "@/pages/CatalogDashboard";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LanguageProvider } from "./contexts/LanguageContext";
import DashboardLayout from "./components/DashboardLayout";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Tickets from "./pages/Tickets";
import ImprovementIdeas from "./pages/ImprovementIdeas";
import TicketDetail from "./pages/TicketDetail";
import CreateTicket from "./pages/CreateTicket";
import PurchaseOrders from "./pages/PurchaseOrders";
import PurchaseOrderDetail from "./pages/PurchaseOrderDetail";
import CreatePurchaseOrder from "./pages/CreatePurchaseOrder";
import Inventory from "./pages/Inventory";
import InventoryOperations from "./pages/InventoryOperations";
import Reports from "./pages/Reports";
import UsersPage from "./pages/Users";
import Sites from "./pages/Sites";
import Sections from "./pages/Sections";
import Technicians from "./pages/Technicians";
import Notifications from "./pages/Notifications";
import AuditLog from "./pages/AuditLog";
import AIAssistant from "./pages/AIAssistant";
import TechnicianReport from "./pages/TechnicianReport";
import MyItems from "./pages/MyItems";
import TranslationMonitor from "./pages/TranslationMonitor";
import PurchaseCycle from "./pages/PurchaseCycle";
import PurchaseCycleReport from "./pages/PurchaseCycleReport";
import MaintenanceCycleReport from "./pages/MaintenanceCycleReport";
import SectionReport from "./pages/SectionReport";
import PreventiveReport from "./pages/PreventiveReport";
import Backup from "./pages/Backup";
import Assets from "./pages/Assets";
import AssetHistory from "./pages/AssetHistory";
import AssetMetrics from "./pages/AssetMetrics";
import PreventiveMaintenance from "./pages/PreventiveMaintenance";
import TriageDashboard from "./pages/TriageDashboard";
import GateSecurity from "./pages/GateSecurity";
import ScanAsset from "./pages/ScanAsset";
import CostReport from "./pages/CostReport";
import Dashboard from "./pages/Dashboard";
import AssetDetail from "./pages/AssetDetail";
import AssetCategories from "./pages/AssetCategories";
import WarehouseReceive from "./pages/WarehouseReceive";
import WarehouseReceiveV2 from "./pages/WarehouseReceiveV2";
import InvoiceDraftReview from "./pages/InvoiceDraftReview";
import WarehouseReturn from "./pages/WarehouseReturn";
import ConstructionDashboard from "./pages/construction/ConstructionDashboard";
import ProjectsList from "./pages/construction/ProjectsList";
import ProjectDetail from "./pages/construction/ProjectDetail";
import ProjectForm from "./pages/construction/ProjectForm";
import ConstructionReports from "./pages/construction/ConstructionReports";

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
            <Route path="/warehouse/invoice-draft" component={InvoiceDraftReview} />
            <Route path="/warehouse/return" component={WarehouseReturn} />
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
