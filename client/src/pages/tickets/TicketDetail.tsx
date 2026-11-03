import { MaterialCostPanel } from "@/components/inventory/MaterialCostPanel";
import { ImprovementReference } from "@/components/improvement/ImprovementReference";
import { ItTeamPanel, ItTaskActions } from "./ItTeamPanel";
import { ExternalRouteReviewPanel } from "./ExternalRouteReviewPanel";
import { isExternalRouteReviewer } from "@shared/external-route-review";
import { isItTeamRole } from "@shared/roles";
import { trpc } from "@/lib/trpc";
import { mediaUrl } from "@/lib/mediaUrl";
import { goBackOrFallback } from "@/lib/backStack";
import { useAuth } from "@/_core/hooks/useAuth";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { STATUS_COLORS, PRIORITY_COLORS } from "@shared/types";
import {
  APP_ROLE,
  MAINTENANCE_MANAGER_FAMILY,
  MAINTENANCE_INSPECTION_RESULT_STATUS,
  MAINTENANCE_INSPECTION_WORKFLOW_STATUS,
  MAINTENANCE_RESPONSIBLE_DEPARTMENT,
} from "@shared/roles";
import { ACTIVE_PATH_B_PURCHASE_ORDER_STATUSES } from "@shared/pathBPurchaseWorkflow";
import {
  canCreateTicketPurchaseOrder,
  canDownloadTicketArchive,
  canPrintTicketTask,
  canStartTicketRepair,
  canSubmitPathARepair,
  canSubmitPathBRepair,
  isPathARepairEvidenceComplete,
  isPathBRepairEvidenceComplete,
  canSubmitStandardRepair,
  hasTicketTechnicianAssignmentRole,
  isTicketEditableBeforeTriage,
} from "@shared/ticketUiRules";
import {
  ArrowRight, Clock, User, MapPin, CheckCircle2, Wrench, ShoppingCart,
  Camera, Loader2, FileText, AlertCircle, ExternalLink, Upload, X, ZoomIn, Download, Video, PlayCircle, Pencil, Archive, Printer, ClipboardList, Users, Plus, GitBranch, Search
} from "lucide-react";
import { useState, useMemo, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/contexts/LanguageContext";
import { TeamAssignmentSlot, supportsTeamTaskAssignmentDepartment } from "@/pages/maintenance-teams/TeamTaskAssignment";
import { useStaticLabels, useBatchTranslation } from "@/hooks/useContentTranslation";
import { WarehouseMaterialTicketView } from "@/pages/maintenance-teams/WarehouseMaterialTicketView";
import { useResolvedTranslation, getLocalizedName } from "@/hooks/useTranslatedField";
import DropZone, { type UploadedFile } from "@/components/common/DropZone";
import { TechnicianCombobox } from "@/components/tickets/TechnicianCombobox";
import { TicketItemStepCard } from "@/components/tickets/TicketItemStepCard";
import { EntityTranslatedText } from "@/components/i18n/EntityTranslatedText";
import { localizeApiError } from "@/i18n/apiError";
import { localizeTicketTimelineSystemText } from "@/i18n/ticketTimelineUi";
import { formatTicketMaterialsUsed } from "@/lib/ticketMaterialsUsed";

// ── مشغّل فيديو للمرفقات ──
// بعض المتصفحات (تحديداً Safari على آيفون) لا تدعم صيغة WebM إطلاقاً،
// بعكس Chrome على الأندرويد أو الكمبيوتر التي تدعمها بلا مشاكل.
// هذا المكوّن يعرض مشغّل فيديو حقيقي، وإن فشل التشغيل يعرض رسالة واضحة
// بدل شاشة سوداء/معطوبة بدون تفسير، مع خيار فتح/تحميل الملف مباشرة كبديل.
function AttachmentVideo({ url, fileName }: { url: string; fileName: string }) {
  const { t } = useTranslation();
  const [playbackError, setPlaybackError] = useState(false);

  if (playbackError) {
    return (
      <div className="w-full h-28 flex flex-col items-center justify-center bg-muted/50 gap-1.5 p-2 text-center">
        <AlertCircle className="w-6 h-6 text-amber-500" />
        <p className="text-[10px] text-muted-foreground leading-tight">
          {t.workflow.ticket.videoUnsupported}
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-primary underline flex items-center gap-1"
        >
          <Download className="w-3 h-3" /> {t.workflow.ticket.downloadVideo}
        </a>
      </div>
    );
  }

  return (
    <video
      src={url}
      controls
      playsInline
      preload="metadata"
      className="w-full h-28 object-cover bg-black"
      onError={() => setPlaybackError(true)}
    >
      {t.workflow.ticket.browserNoVideo}
    </video>
  );
}

export default function TicketDetail({ embeddedTicketId, onBack }: { params?: unknown; embeddedTicketId?: number; onBack?: () => void } = {}) {
  const [, params] = useRoute("/tickets/:id");
  const { user } = useAuth();
  const ticketId = embeddedTicketId ?? parseInt(params?.id || "0");
  // Route changes reuse this page. Remount its forms so no draft, photo or
  // mutation state from one ticket can be submitted on another ticket.
  if (user?.role === APP_ROLE.WAREHOUSE) return <WarehouseMaterialTicketView key={ticketId} ticketId={ticketId} onBack={onBack} />;
  return <TicketDetailContent key={ticketId} ticketId={ticketId} onBack={onBack} />;
}

function TicketDetailContent({ ticketId, onBack }: { ticketId: number; onBack?: () => void }) {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { t, language, dir } = useTranslation();
  const { getStatusLabel, getPriorityLabel, getCategoryLabel, getPOStatusLabel } = useStaticLabels();
const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";
const currency = language === "en" ? "SAR" : "ر.س";

const { data: ticket, isLoading, refetch } = trpc.tickets.getById.useQuery({ id: ticketId }, { enabled: !!ticketId });
const { data: parentTicket } = trpc.tickets.getById.useQuery(
  { id: ticket?.parentTicketId || 0 },
  { enabled: !!ticket?.parentTicketId && ticket?.workflowModel === "sub_ticket" },
);
const { data: departmentPlan, refetch: refetchDepartmentPlan } = trpc.tickets.departmentPlan.useQuery(
  { ticketId },
  { enabled: !!ticketId && ticket?.workflowModel === "department_tasks" && ticket?.status !== "pending_triage" },
);

const { getField } = useResolvedTranslation(
  "TICKET",
  ticket?.id,
  ticket,
  ticket?.originalLanguage
);
  const { data: history } = trpc.tickets.history.useQuery({ ticketId }, { enabled: !!ticketId });
  const { translationsMap: historyTranslations } = useBatchTranslation(
    "TICKET_STATUS_HISTORY",
    (history ?? []).map((entry: any) => Number(entry.id)).filter((id: number) => Number.isFinite(id)),
    ["notes"],
  );
  const restrictedTechnician = user?.role === APP_ROLE.TECHNICIAN;
  const scopedUserReferences = restrictedTechnician || user?.role === APP_ROLE.DELEGATE;
  const references = trpc.tickets.executionReferences.useQuery({ ticketId }, { enabled: scopedUserReferences && !!ticketId });
  const { data: directoryUsers } = trpc.users.list.useQuery(undefined, { enabled: !!user && !scopedUserReferences });
  const users = scopedUserReferences ? references.data?.users : directoryUsers;
  // Phase 2: listTechnicians gives users with specialty; legacy technicians.list kept for external-only assignments
  const { data: userTechniciansList } = trpc.users.listTechnicians.useQuery(undefined, { enabled: !!user && !scopedUserReferences });
  // Phase 5: externalTechs query kept for backend compatibility (historical data, fallback). Hidden from UI dropdowns.
  const { data: directoryExternalTechs } = trpc.technicians.list.useQuery({ activeOnly: true }, { enabled: !!user && !restrictedTechnician });
  const { data: directorySections } = trpc.sections.list.useQuery(undefined, { enabled: !!user && !restrictedTechnician });
  const { data: directorySites } = trpc.sites.list.useQuery(undefined, { enabled: !!user && !restrictedTechnician });
  const { data: allPOs } = trpc.purchaseOrders.list.useQuery(undefined, { enabled: !!user && !restrictedTechnician });
  const externalTechs = restrictedTechnician ? references.data?.technicians : directoryExternalTechs;
  const allSections = restrictedTechnician ? references.data?.sections : directorySections;
  const allSites = restrictedTechnician ? references.data?.sites : directorySites;
  const attachmentsInput = useMemo(() => ({ entityType: "ticket", entityId: ticketId }), [ticketId]);
  const { data: ticketAttachments } = trpc.attachments.list.useQuery(attachmentsInput, { enabled: !!ticketId });
  const { data: inspectionResultsList, refetch: refetchInspectionResults } = trpc.inspectionResults.listByTicket.useQuery({ ticketId }, { enabled: !!ticketId });
  const { data: ticketConfirmation, refetch: refetchConfirmation } = trpc.tickets.getConfirmation.useQuery({ id: ticketId }, { enabled: !!ticketId });
  const { data: directoryCategories = [] } = trpc.centerCategories.list.useQuery({ activeOnly: false }, { enabled: !!user && !restrictedTechnician });
  const centerCategories = restrictedTechnician ? references.data?.categories ?? [] : directoryCategories;
  // بنود البلاغ — الخطوة 2 من ميزة البلاغ متعدد الجهات (2026-08-08). قراءة فقط، بنفس حارس
  // صلاحية البلاغ نفسه (tickets.items تُحقق assertTicketReadable داخليًا).
  const { data: ticketItems } = trpc.tickets.items.useQuery({ ticketId }, { enabled: !!ticketId });
  const { data: externalRouteReviews = [] } = trpc.externalMaintenance.routeReviews.useQuery({ ticketId }, { enabled: !!ticketId && !!user && isExternalRouteReviewer(user.role) });

  const approveMut = trpc.tickets.approve.useMutation({ onSuccess: () => { toast.success(t.common.confirm); refetch(); } });
  const assignMut = trpc.tickets.assign.useMutation({
    onSuccess: () => {
      toast.success(t.tickets.assignedTo);
      setReassignmentReason("");
      setSelectedTech("");
      setShowReassignmentEditor(false);
      refetch();
    },
    onError: (error) => toast.error(localizeApiError(error.message)),
  });

  // ── تعديل البلاغ: متاح فقط طالما لم يُصنَّف بعد (status === "pending_triage") ──
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState({ title: "", description: "", priority: "", categoryId: "", locationDetail: "" });
  const isManagedConstructionTicket = !!ticket && user?.role === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER &&
    (
      (ticket.maintenanceResponsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION &&
        ticket.maintenanceResponsibleManagerId === user?.id) ||
      // ⚠️ 2026-08-08 — نفس إصلاح الخطوة 1 (القاعدة الحرجة #12)، لكن على الواجهة: جهة
      // ثانوية بالفرز المتعدد لا تعكسها أعمدة البلاغ — تُفحص بنود البلاغ (ticketItems،
      // مجلوبة أعلاه عبر tickets.items) بدل الاكتفاء بعمود tickets.maintenanceResponsibleDepartment.
      !!ticketItems?.some((item: any) =>
        item.responsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION &&
        item.responsibleManagerId === user?.id
      ) ||
      !!departmentPlan?.departments?.some((dept: any) =>
        dept.department === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION && dept.responsibleManagerId === user?.id
      )
    );
  const isItDepartmentTicket = !!ticket &&
    ticket.maintenanceResponsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT;
  const isWaitingForItTeamClaim = isItDepartmentTicket && ticket?.workflowModel === "department_tasks" &&
    ticket?.status === "department_planning" && !ticket?.assignedToId;
  const isLinkedTicketReadOnly = user?.role === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER &&
    !isManagedConstructionTicket && ticket?.reportedById !== user?.id;
  const isItReadOnlyForMaintenanceManagers = isItDepartmentTicket && [
    APP_ROLE.MAINTENANCE_MANAGER,
    APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
    APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
    APP_ROLE.SUPERVISOR,
  ].includes(user?.role as any);
  const isRoutedConstructionReadOnlyForGeneral = !!ticket &&
    user?.role === APP_ROLE.GENERAL_MAINTENANCE_MANAGER &&
    ticket.maintenanceResponsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION;
  const isTicketReadOnly = isLinkedTicketReadOnly || isRoutedConstructionReadOnlyForGeneral || isItReadOnlyForMaintenanceManagers || (isItTeamRole(user?.role) && isItDepartmentTicket && ticket?.assignedToId !== user?.id);
  const isCreatorRestrictedForEdit = (MAINTENANCE_MANAGER_FAMILY as readonly string[]).includes(user?.role || "");
  const isEditAdminOverride = [APP_ROLE.OWNER, APP_ROLE.ADMIN].includes(user?.role as any);
  const isTicketReporter = ticket?.reportedById === user?.id;
  const canEditTicket = !isTicketReadOnly && !!ticket && isTicketEditableBeforeTriage(ticket.status) &&
    (isEditAdminOverride || isTicketReporter) && (!isCreatorRestrictedForEdit || isTicketReporter);
  const openEditDialog = useCallback(() => {
    if (!ticket) return;
    setEditForm({
      title: ticket.title || "",
      description: ticket.description || "",
      priority: ticket.priority || "",
      categoryId: ticket.categoryId ? String(ticket.categoryId) : "",
      locationDetail: ticket.locationDetail || "",
    });
    setEditDialogOpen(true);
  }, [ticket]);
  const updateTicketMut = trpc.tickets.update.useMutation({
    onSuccess: () => {
      toast.success(t.common.save);
      setEditDialogOpen(false);
      refetch();
    },
    onError: (err) => toast.error(localizeApiError(err.message)),
  });
  const startMut = trpc.tickets.startRepair.useMutation({ onSuccess: () => { toast.success(t.tickets.startRepair); refetch(); } });
  const completeMut = trpc.tickets.completeRepair.useMutation({ onSuccess: () => { toast.success(t.tickets.completeRepair); refetch(); } });
  const closeMut = trpc.tickets.close.useMutation({ onSuccess: () => { toast.success(t.tickets.closeTicket); refetch(); } });

  // تنفيذ الإصلاح لكل بند — المرحلة 6 (2026-08-10)
  const utils = trpc.useUtils();
  const refetchAll = () => { refetch(); utils.tickets.items.invalidate({ ticketId }); };

  // خطة الجهات والمهام الجديدة.
  const [departmentTaskDrafts, setDepartmentTaskDrafts] = useState<Record<number, { title: string; description: string }>>({});
  const [taskAssigneeDrafts, setTaskAssigneeDrafts] = useState<Record<number, number[]>>({});
  const [taskAssigneeSearches, setTaskAssigneeSearches] = useState<Record<number, string>>({});
  const refreshDepartmentPlan = async () => {
    // Invalidate first so a late response from the pre-mutation request cannot
    // overwrite the newly created/assigned task with stale plan data.
    await utils.tickets.departmentPlan.invalidate({ ticketId });
    await Promise.all([refetch(), refetchDepartmentPlan()]);
  };
  const createDepartmentTaskMut = trpc.tickets.createDepartmentTask.useMutation({
    onSuccess: async (_res, vars) => { toast.success(t.workflow.ticket.taskCreated); setDepartmentTaskDrafts(prev => ({ ...prev, [vars.ticketDepartmentId]: { title: "", description: "" } })); await refreshDepartmentPlan(); },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  const assignDepartmentTaskMut = trpc.tickets.assignDepartmentTask.useMutation({
    onSuccess: async () => { toast.success(t.workflow.ticket.taskAssigned); await refreshDepartmentPlan(); },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  const promoteDepartmentTaskMut = trpc.tickets.promoteDepartmentTask.useMutation({
    onSuccess: async (res: any) => { toast.success(`${t.workflow.ticket.promoteToSubTicket} ${res?.ticketNumber || ""}`); await refreshDepartmentPlan(); },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  const [showItTransferDialog, setShowItTransferDialog] = useState(false);
  const [itTransferDepartment, setItTransferDepartment] = useState<string>("");
  const [itTransferManagerId, setItTransferManagerId] = useState("");
  const [itTransferJustification, setItTransferJustification] = useState("");
  const transferItTicketMut = trpc.tickets.transferItTicket.useMutation({
    onSuccess: () => {
      toast.success(t.workflow.ticket.itTransferred);
      setShowItTransferDialog(false);
      setItTransferDepartment("");
      setItTransferManagerId("");
      setItTransferJustification("");
      // بعد التحويل قد يخرج البلاغ من نطاق رؤية مدير IT، لذلك نعود للقائمة بدل refetch قد يُرفض.
      setLocation("/tickets");
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  const closeParentTicketMut = trpc.tickets.closeParentTicket.useMutation({
    onSuccess: async (res: any) => { toast.success(`${t.workflow.ticket.parentClosed} (${res?.subTicketCount ?? 0})`); await refreshDepartmentPlan(); },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  const startRepairForItemMut = trpc.tickets.startRepairForItem.useMutation({
    onSuccess: () => { toast.success(t.workflow.ticket.itemStarted); refetchAll(); },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  const completeRepairForItemMut = trpc.tickets.completeRepairForItem.useMutation({
    onSuccess: () => { toast.success(t.workflow.ticket.itemResultSubmitted); refetchAll(); },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  const closeTicketItemMut = trpc.tickets.closeTicketItem.useMutation({
    onSuccess: (res: any) => {
      toast.success(res?.remainingItems === 0 ? t.workflow.ticket.itemApprovedAll : `${t.workflow.ticket.itemApprovedRemaining}: ${res?.remainingItems}`);
      refetchAll();
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  const [itemRepairForms, setItemRepairForms] = useState<Record<number, { afterPhotoUrl: string; repairNotes: string; materialsUsed: string }>>({});

  // === New Workflow Mutations ===
  const triageMut = trpc.tickets.triageTicket.useMutation({ onSuccess: () => { toast.success(t.workflow.ticket.movedToInspection); refetch(); } });
  // الفرز المتعدد الجهات — 2026-08-08، إجراء مستقل لا يمس triageTicket القائم.
  const triageMultiMut = trpc.tickets.triageMulti.useMutation({
    onSuccess: (res: any) => { toast.success(`${t.workflow.ticket.departmentsApproved} (${res?.departmentsCreated ?? 0})`); refetch(); refetchDepartmentPlan(); },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  const inspectMut = trpc.tickets.inspectTicket.useMutation({
    onSuccess: (result, variables) => {
      toast.success(
        variables.submissionMode === "save_draft"
          ? t.workflow.ticket.inspectionDraftSaved
          : result.autoApproved
            ? t.workflow.ticket.inspectionApprovedSaved
            : t.workflow.ticket.inspectionSentReview,
      );
      refetch();
      refetchInspectionResults();
    },
    onError: (err) => toast.error(localizeApiError(err.message)),
  });
  const reviewInspectionMut = trpc.tickets.reviewInspection.useMutation({
    onSuccess: (_result, variables) => {
      toast.success(variables.action === "approve" ? t.workflow.ticket.inspectionApproved : t.workflow.ticket.inspectionReturned);
      setInspectionReturnReason("");
      refetch();
      refetchInspectionResults();
    },
    onError: (err) => toast.error(localizeApiError(err.message)),
  });
  const approveWorkMut = trpc.tickets.approveWork.useMutation({ onSuccess: () => { toast.success(t.workflow.ticket.workApproved); refetch(); }, onError: (err) => toast.error(localizeApiError(err.message)) });
  // اعتماد المسار لكل بند — الخطوة 3 من ميزة البلاغ متعدد الجهات (2026-08-08).
  const approveWorkForItemMut = trpc.tickets.approveWorkForItem.useMutation({
    onSuccess: () => { toast.success(t.workflow.ticket.itemPathApproved); refetch(); },
    onError: (err) => toast.error(localizeApiError(err.message)),
  });
  const [itemPathSelections, setItemPathSelections] = useState<Record<number, { path: "A" | "B" | "C"; justification: string }>>({});
  const markReadyMut = trpc.tickets.markReadyForClosure.useMutation({ onSuccess: () => { toast.success(t.workflow.ticket.repairReady); refetch(); } });
  const closeBySupervisorMut = trpc.tickets.closeBySupervisor.useMutation({ onSuccess: () => { toast.success(t.workflow.ticket.closed); refetch(); } });
  const completeWithPartsMut = trpc.tickets.completeWithParts.useMutation({ onSuccess: () => { toast.success(t.workflow.ticket.completedWithParts); refetch(); } });
  const approveGateExitMut = trpc.tickets.approveGateExit.useMutation({ onSuccess: () => { toast.success(t.workflow.ticket.gateExitApproved); refetch(); } });
  const approveGateEntryMut = trpc.tickets.approveGateEntry.useMutation({ onSuccess: () => { toast.success(t.workflow.ticket.gateEntryApproved); refetch(); } });
  const confirmCompletionMut = trpc.tickets.confirmCompletion.useMutation({
    onSuccess: () => { toast.success(t.tickets.confirmCompletionSuccess); refetch(); refetchConfirmation(); setConfirmNote(""); setConfirmPhotos([]); },
    onError: (err) => { toast.error(localizeApiError(err.message)); },
  });

  // Workflow state
  const [inspectionNotes, setInspectionNotes] = useState("");
  const [inspSeverity, setInspSeverity] = useState<"low" | "medium" | "high" | "critical" | "">("");
  const [inspRootCause, setInspRootCause] = useState("");
  const [inspFindings, setInspFindings] = useState("");
  const [inspRecommendedAction, setInspRecommendedAction] = useState("");
  const [inspPerformedById, setInspPerformedById] = useState("");
  const [inspectionReturnReason, setInspectionReturnReason] = useState("");
  const [loadedInspectionResultId, setLoadedInspectionResultId] = useState<number | null>(null);
  const [selectedPath, setSelectedPath] = useState<"A" | "B" | "C">("A");
  const [pathJustification, setPathJustification] = useState("");
  const [showApproveWorkForm, setShowApproveWorkForm] = useState(false);

  // Triage dialog state
  const [showTriageDialog, setShowTriageDialog] = useState(false);
  const [triageAssignedTo, setTriageAssignedTo] = useState("");
  const [triageDepartment, setTriageDepartment] = useState<string>("");
  const [triageResponsibleManagerId, setTriageResponsibleManagerId] = useState("");

  // 2026-08-11: فرز الجهات/المهام هو المسار الافتراضي والإلزامي بالواجهة.
  // single باقٍ كمسار توافق رجعي داخلي فقط.
  const [triageMode, setTriageMode] = useState<"single" | "multi">("multi");
  const [multiAssignments, setMultiAssignments] = useState<Record<string, { selected: boolean; managerId: string; organizationalTitle: string }>>({});
  const emptyMultiAssignments = () => ({
    [MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL]: { selected: false, managerId: "", organizationalTitle: "" },
    [MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION]: { selected: false, managerId: "", organizationalTitle: "" },
  });
  const updateAssignment = (dept: string, patch: Partial<{ selected: boolean; managerId: string; organizationalTitle: string }>) =>
    setMultiAssignments(prev => ({ ...prev, [dept]: { ...prev[dept], ...patch } }));

  const [selectedTech, setSelectedTech] = useState("");
  const [selectedExternalTech, setSelectedExternalTech] = useState("");
  const [reassignmentReason, setReassignmentReason] = useState("");
  const [showReassignmentEditor, setShowReassignmentEditor] = useState(false);
  const [repairNotes, setRepairNotes] = useState("");
  const [materialsUsed, setMaterialsUsed] = useState("");
  const [afterPhotoUrl, setAfterPhotoUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showAttachDropZone, setShowAttachDropZone] = useState(false);
  // Lightbox state
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // Requester completion confirmation state
  const [confirmNote, setConfirmNote] = useState("");
  const [confirmPhotos, setConfirmPhotos] = useState<UploadedFile[]>([]);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [printingTask, setPrintingTask] = useState(false);

  useEffect(() => {
    const latest = inspectionResultsList?.[0] as any;
    if (!latest || latest.id === loadedInspectionResultId) return;
    const isOwnDraft = latest.workflowStatus === MAINTENANCE_INSPECTION_RESULT_STATUS.DRAFT && latest.recordedById === user?.id;
    const isReturnedForCorrection = latest.workflowStatus === MAINTENANCE_INSPECTION_RESULT_STATUS.RETURNED;
    if (!isOwnDraft && !isReturnedForCorrection) return;
    setInspectionNotes(latest.inspectionNotes || "");
    setInspSeverity(latest.severity || "");
    setInspRootCause(latest.rootCause || "");
    setInspFindings(latest.findings || "");
    setInspRecommendedAction(latest.recommendedAction || "");
    setInspPerformedById(latest.performedById ? String(latest.performedById) : "");
    setLoadedInspectionResultId(latest.id);
  }, [inspectionResultsList, loadedInspectionResultId, user?.id]);

  const handleDownloadPDF = useCallback(async () => {
    if (!ticket?.id) return;
    try {
      setDownloadingPdf(true);
      const response = await fetch(`/api/tickets/${ticket.id}/pdf?document=archive`);
      if (!response.ok) throw new Error("Failed to generate PDF");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ticket-archive-${ticket.ticketNumber}-${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success(t.workflow.ticket.archiveDownloaded);
    } catch (error) {
      console.error(error);
      toast.error(t.workflow.ticket.archiveFailed);
    } finally {
      setDownloadingPdf(false);
    }
  }, [ticket?.id, ticket?.ticketNumber]);

  // Sends the task PDF straight to the print dialog instead of downloading it
  const handlePrintTask = useCallback(async () => {
    if (!ticket?.id) return;
    try {
      setPrintingTask(true);
      const response = await fetch(`/api/tickets/${ticket.id}/pdf?document=task`);
      if (!response.ok) throw new Error("Failed to generate PDF");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const printWindow = window.open(url, "_blank");
      if (!printWindow) {
        toast.error(t.workflow.ticket.popupRequired);
        window.URL.revokeObjectURL(url);
        return;
      }
      printWindow.onload = () => {
        printWindow.focus();
        printWindow.print();
      };
      // Fallback in case onload doesn't fire reliably for the PDF viewer
      setTimeout(() => {
        try { printWindow.focus(); printWindow.print(); } catch {}
      }, 800);
    } catch (error) {
      console.error(error);
      toast.error(t.workflow.ticket.printFailed);
    } finally {
      setPrintingTask(false);
    }
  }, [ticket?.id]);

  const addAttachMut = trpc.attachments.add.useMutation({
    onSuccess: () => { refetch(); },
  });

  const handleNewAttachments = useCallback(async (uploaded: UploadedFile[]) => {
    for (const f of uploaded) {
      if (f.url && f.status === "done") {
        // ✅ استخدام fileKey النظيف القادم من السيرفر مباشرة
        // (الاستخراج اليدوي القديم من رابط /api/media?key=... كان يكسر الترميز ويخزّن مفتاحاً خاطئاً)
        const fileKey = f.fileKey || f.name;
        await addAttachMut.mutateAsync({
          entityType: "ticket",
          entityId: ticketId,
          fileUrl: f.url,
          fileKey,
          fileName: f.name,
          mimeType: f.mimeType,
          fileSize: f.size,
        });
      }
    }
  }, [addAttachMut, ticketId]);

  // Phase 2: use listTechnicians as primary source for assignment dropdown (includes specialty)
  // Fallback to users.filter if listTechnicians is not yet populated.
  // القائمة مرتبة أبجديًا مرة واحدة، فتستفيد منها كل حقول إسناد الفنيين في الصفحة.
  const technicians = useMemo(() => {
    const source = (userTechniciansList && userTechniciansList.length > 0)
      ? userTechniciansList
      : (users?.filter(u => u.role === APP_ROLE.TECHNICIAN && u.isActive !== 0) || []);
    return [...source].sort((a: any, b: any) => {
      const aName = String(a.name || a.email || "");
      const bName = String(b.name || b.email || "");
      return aName.localeCompare(bName, locale, { sensitivity: "base" });
    });
  }, [userTechniciansList, users, locale]);
  const role = user?.role || "";

  const linkedPOs = allPOs?.filter(po => po.ticketId === ticketId) || [];

  const isAdminOrOwner = [APP_ROLE.ADMIN, APP_ROLE.OWNER].includes(role as any);
  const isGeneralMaintenanceScope = role === APP_ROLE.GENERAL_MAINTENANCE_MANAGER &&
    !isItDepartmentTicket &&
    (
      ticket?.maintenanceResponsibleDepartment !== MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION ||
      // ⚠️ 2026-08-08 — نفس مبدأ إصلاح isManagedConstructionTicket أعلاه: بند عام ثانوي
      // ضمن بلاغ جهته الرئيسية "إنشاءات" لا تعكسه أعمدة البلاغ — يُفحص عبر ticketItems.
      !!ticketItems?.some((item: any) =>
        !item.responsibleDepartment || item.responsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL
      )
    );
  const isLegacyMaintenanceManagerForTicket = role === APP_ROLE.MAINTENANCE_MANAGER && !isItDepartmentTicket;
  const isSupervisorForTicket = role === APP_ROLE.SUPERVISOR && !isItDepartmentTicket;
  const isItWorkflowManager = isItTeamRole(role) && isItDepartmentTicket &&
    ticket?.assignedToId === user?.id;
  // IT sub-tickets use the compact five-outcome execution panel. Keep the
  // legacy A/B/C controls hidden for the named IT executor to avoid duplicate,
  // contradictory actions on the same ticket.
  const usesDirectItExecution = isItWorkflowManager && ticket?.workflowModel === "sub_ticket";
  const isManager = [APP_ROLE.PURCHASE_MANAGER, APP_ROLE.OWNER, APP_ROLE.ADMIN].includes(role as any) ||
    isLegacyMaintenanceManagerForTicket || isGeneralMaintenanceScope || isManagedConstructionTicket || isItWorkflowManager;
  const isTicketWorkflowManager = [APP_ROLE.OWNER, APP_ROLE.ADMIN].includes(role as any) ||
    isLegacyMaintenanceManagerForTicket || isGeneralMaintenanceScope || isManagedConstructionTicket || isItWorkflowManager;
  const isSupervisor = [APP_ROLE.OWNER, APP_ROLE.ADMIN].includes(role as any) ||
    isSupervisorForTicket || isLegacyMaintenanceManagerForTicket || isGeneralMaintenanceScope || isManagedConstructionTicket;
  const isTechnician = role === APP_ROLE.TECHNICIAN || isItWorkflowManager || isAdminOrOwner;
  // ⚠️ 2026-08-13: مدير الإنشاءات والمشتريات يستطيع الآن تصنيف بلاغه الشخصي
  // فقط — بنفس نموذج الفرز (الحوار أدناه) المستخدَم مع مدير الصيانة العامة
  // حرفيًا، بلا أي تعديل عليه. القيد الفعلي (بلاغه فقط) مطبَّق هنا بمطابقة
  // reportedById، ومكرَّر بالسيرفر (assertConstructionManagerOwnTicketForTriage)
  // فلا يمكن تجاوزه حتى بنداء API مباشر. راجع
  // docs/CONSTRUCTION_MANAGER_OWN_TICKET_TRIAGE.md.
  const canRouteTicket = [APP_ROLE.MAINTENANCE_MANAGER, APP_ROLE.GENERAL_MAINTENANCE_MANAGER, APP_ROLE.OWNER, APP_ROLE.ADMIN].includes(role as any) ||
    (role === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER && ticket?.reportedById === user?.id);
  const constructionManagers = users?.filter((u: any) => u.role === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER && u.isActive !== 0) || [];
  const generalManagers = users?.filter((u: any) =>
    [APP_ROLE.GENERAL_MAINTENANCE_MANAGER, APP_ROLE.MAINTENANCE_MANAGER].includes(u.role as any) && u.isActive !== 0
  ) || [];
  const itManagers = users?.filter((u: any) => u.role === APP_ROLE.IT_MANAGER && u.isActive !== 0) || [];
  const selectedDepartmentManagers = triageDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT ? itManagers : triageDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION ? constructionManagers : generalManagers;
  const itTransferManagers = itTransferDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION
    ? constructionManagers
    : itTransferDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL
      ? generalManagers
      : [];
  const inspectionPerformerOptions = users?.filter((candidate: any) => candidate.isActive !== 0 && [
    APP_ROLE.TECHNICIAN,
    APP_ROLE.SUPERVISOR,
    APP_ROLE.MAINTENANCE_MANAGER,
    APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
    APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
    APP_ROLE.IT_MANAGER,
    APP_ROLE.IT_MEMBER,
    APP_ROLE.ADMIN,
    APP_ROLE.OWNER,
  ].includes(candidate.role as any)) || [];
  const isGateSecurity = ["gate_security", "owner", "admin"].includes(role);

  // Legacy actions
  const canApprove = isManager && ticket?.status === "new";
  // Reassign is now a fallback available at any post-triage status
  const postTriageStatuses = ["under_inspection", "work_approved", "assigned", "in_progress", "needs_purchase", "purchase_pending_estimate", "purchase_pending_accounting", "purchase_pending_management", "purchase_approved", "purchased", "received_warehouse"];
  const hasTechnicianAssignmentScope = [APP_ROLE.OWNER, APP_ROLE.ADMIN].includes(role as any) ||
    isLegacyMaintenanceManagerForTicket || isGeneralMaintenanceScope || isManagedConstructionTicket;
  const canAssign = !isTicketReadOnly && hasTicketTechnicianAssignmentRole(role) && hasTechnicianAssignmentScope &&
    postTriageStatuses.includes(ticket?.status || "");
  const canDownloadArchive = canDownloadTicketArchive(role, ticket?.status);
  const canPrintTaskDocument = canPrintTicketTask(role, ticket?.status);
  const canStartRepair = !usesDirectItExecution && canStartTicketRepair(
    isTechnician || isTicketWorkflowManager,
    ticket?.status,
    ticket?.maintenancePath,
  );
  const canCompleteRepair = !usesDirectItExecution && canSubmitStandardRepair(
    isTechnician || isTicketWorkflowManager,
    ticket?.status,
    ticket?.maintenancePath,
  );
  const canClose = !usesDirectItExecution && isTicketWorkflowManager && ticket?.status === "repaired" && !ticket?.maintenancePath;
  const hasActiveLinkedPurchaseOrder = linkedPOs.some((po: any) =>
    ACTIVE_PATH_B_PURCHASE_ORDER_STATUSES.has(po.status)
  );
  const canCreatePO = canCreateTicketPurchaseOrder(
    (isItDepartmentTicket ? role === APP_ROLE.IT_MANAGER && ticket?.maintenanceResponsibleManagerId === user?.id : isTicketWorkflowManager),
    ticket?.status,
    ticket?.maintenancePath,
    hasActiveLinkedPurchaseOrder,
  );

  // === New Workflow Smart Buttons ===
  const canTriage = canRouteTicket && ticket?.status === "pending_triage";
  const isAssignedInspectionTechnician = role === APP_ROLE.TECHNICIAN && (ticket?.assignedToId === user?.id || !!ticket?.currentUserTaskAssignee);
  const isInspectionManager = [APP_ROLE.OWNER, APP_ROLE.ADMIN].includes(role as any) ||
    isLegacyMaintenanceManagerForTicket || isGeneralMaintenanceScope || isManagedConstructionTicket || isItWorkflowManager;
  const inspectionWorkflowStatus = ticket?.inspectionWorkflowStatus;
  const latestInspectionResult = inspectionResultsList?.[0] as any;
  const hasForeignInspectionDraft = latestInspectionResult?.workflowStatus === MAINTENANCE_INSPECTION_RESULT_STATUS.DRAFT &&
    latestInspectionResult.recordedById && latestInspectionResult.recordedById !== user?.id;
  const inspectionIsEditable = !inspectionWorkflowStatus || [
    MAINTENANCE_INSPECTION_WORKFLOW_STATUS.PENDING_SUBMISSION,
    MAINTENANCE_INSPECTION_WORKFLOW_STATUS.RETURNED_FOR_CORRECTION,
  ].includes(inspectionWorkflowStatus as any);
  const canInspect = !usesDirectItExecution && !isTicketReadOnly && ticket?.status === "under_inspection" && inspectionIsEditable && !hasForeignInspectionDraft &&
    (isAssignedInspectionTechnician || isInspectionManager || role === APP_ROLE.SUPERVISOR);
  const canReviewInspection = !isTicketReadOnly && ticket?.status === "under_inspection" && isInspectionManager &&
    inspectionWorkflowStatus === MAINTENANCE_INSPECTION_WORKFLOW_STATUS.SUBMITTED_FOR_REVIEW;
  const canClosePathA = (isSupervisor || isManager) && ticket?.status === "ready_for_closure" && ticket?.maintenancePath === "A";

  const canApproveWork = !externalRouteReviews.length && !isTicketReadOnly && ticket?.status === "under_inspection" && isInspectionManager &&
    inspectionWorkflowStatus === MAINTENANCE_INSPECTION_WORKFLOW_STATUS.APPROVED;
  const canClosePathBC = isTicketWorkflowManager && ticket?.status === "ready_for_closure" && ["B", "C"].includes(ticket?.maintenancePath as any);

  // Technician (Path A)
  const canMarkReadyForClosure = !usesDirectItExecution && canSubmitPathARepair(
    isTechnician || isTicketWorkflowManager,
    ticket?.status,
    ticket?.maintenancePath,
  );
  const isPathARepairEvidenceReady = isPathARepairEvidenceComplete(repairNotes, afterPhotoUrl);

  // Gate Security (Path C)
  // موافقات المسار C تُنفذ حصراً من صفحة الحراسة بعد وثيقة المستودع ودورة المندوب.
  const canApproveExit = false;
  const canApproveEntry = false;

  // Path B completion appears only after the technician explicitly starts repair.
  // Path C retains its existing completion entry after the asset returns.
  const canCompletePathBWithParts = !usesDirectItExecution && canSubmitPathBRepair(
    isTechnician || isTicketWorkflowManager,
    ticket?.status,
    ticket?.maintenancePath,
  );
  const canCompletePathCWithParts =
    !usesDirectItExecution && (isTechnician || isTicketWorkflowManager) &&
    ticket?.status === "in_progress" &&
    ticket?.maintenancePath === "C";
  const canCompleteWithParts = canCompletePathBWithParts || canCompletePathCWithParts;
  const isPathBRepairEvidenceReady = isPathBRepairEvidenceComplete(repairNotes, afterPhotoUrl);

  // Requester completion confirmation: only the ticket creator (or owner/admin) — NOT the manager who closed it
  const canConfirmCompletion = !isTicketReadOnly && ticket?.status === "closed" && (ticket?.reportedById === user?.id || isAdminOrOwner);

  const submitInspection = (submissionMode: "save_draft" | "submit") => {
    if (!ticket || !user) return;
    const performedById = (isAssignedInspectionTechnician || isItWorkflowManager)
      ? user.id
      : Number(inspPerformedById || user.id);
    inspectMut.mutate({
      id: ticket.id,
      performedById,
      inspectionNotes,
      severity: inspSeverity || undefined,
      rootCause: inspRootCause || undefined,
      findings: inspFindings || undefined,
      recommendedAction: inspRecommendedAction || undefined,
      submissionMode,
    });
  };

  const inspectionStatusLabel = (() => {
    switch (inspectionWorkflowStatus) {
      case MAINTENANCE_INSPECTION_WORKFLOW_STATUS.PENDING_SUBMISSION:
        return t.workflow.ticket.inspectionPending;
      case MAINTENANCE_INSPECTION_WORKFLOW_STATUS.SUBMITTED_FOR_REVIEW:
        return t.workflow.ticket.inspectionManagerPending;
      case MAINTENANCE_INSPECTION_WORKFLOW_STATUS.RETURNED_FOR_CORRECTION:
        return t.workflow.ticket.inspectionReturnedStatus;
      case MAINTENANCE_INSPECTION_WORKFLOW_STATUS.APPROVED:
        return t.workflow.ticket.inspectionApprovedStatus;
      default:
        return ticket?.status === "under_inspection" ? t.workflow.ticket.inspectionPending : "-";
    }
  })();

  const handleUploadAfterPhoto = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.url) { setAfterPhotoUrl(data.url); toast.success(t.common.save); }
    } catch { toast.error(t.common.close); }
    setUploading(false);
  };

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );

  if (!ticket) return <div className="text-center py-12 text-muted-foreground">{t.common.noData}</div>;

  const materialsUsedText = formatTicketMaterialsUsed(ticket.materialsUsed, getField("materialsUsed"), t.tickets.unspecified, language);

  const reportedBy = users?.find(u => u.id === ticket.reportedById);
  const assignedTo = users?.find(u => u.id === ticket.assignedToId);
  const assignedExternalTechnician = externalTechs?.find((tech: any) => tech.id === ticket.assignedTechnicianId);
  const currentAssigneeName = assignedTo?.name || assignedTo?.email || assignedExternalTechnician?.name || t.tickets.unspecified;

  const workflowSteps = [
    { key: "new", label: getStatusLabel("new"), done: true },
    { key: "approved", label: getStatusLabel("approved"), done: ["approved", "assigned", "in_progress", "needs_purchase", "purchase_pending_estimate", "purchase_pending_accounting", "purchase_pending_management", "purchase_approved", "partial_purchase", "purchased", "received_warehouse", "repaired", "verified", "closed", "requester_confirmed"].includes(ticket.status) },
    { key: "assigned", label: getStatusLabel("assigned"), done: ["assigned", "in_progress", "needs_purchase", "purchase_pending_estimate", "purchase_pending_accounting", "purchase_pending_management", "purchase_approved", "partial_purchase", "purchased", "received_warehouse", "repaired", "verified", "closed", "requester_confirmed"].includes(ticket.status) },
    { key: "in_progress", label: getStatusLabel("in_progress"), done: ["in_progress", "repaired", "verified", "closed", "requester_confirmed"].includes(ticket.status) },
    { key: "repaired", label: getStatusLabel("repaired"), done: ["repaired", "verified", "closed", "requester_confirmed"].includes(ticket.status) },
    { key: "closed", label: getStatusLabel("closed"), done: ["closed", "requester_confirmed"].includes(ticket.status) },
    { key: "requester_confirmed", label: getStatusLabel("requester_confirmed"), done: ticket.status === "requester_confirmed" },
  ];

  return (
    <>
    <div className="space-y-6 max-w-5xl" dir={dir}>
      <ImprovementReference kind="ticket" documentId={ticketId} canNavigate={!restrictedTechnician} />
      <MaterialCostPanel source="ticket" id={ticketId} />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1">
          <Button variant="ghost" size="icon" onClick={() => onBack ? onBack() : goBackOrFallback(
            setLocation,
            role === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER ? "/tickets?tab=construction" : "/tickets",
          )}>
            <ArrowRight className={`w-5 h-5 ${dir === "ltr" ? "rotate-180" : ""}`} />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-mono text-muted-foreground">{ticket.ticketNumber}</span>
              <Badge className={`${STATUS_COLORS[ticket.status]}`}>{getStatusLabel(ticket.status)}</Badge>
              <Badge variant="outline" className={PRIORITY_COLORS[ticket.priority]}>{getPriorityLabel(ticket.priority)}</Badge>
              <Badge variant="outline">{ticket.centerCategoryName || getCategoryLabel(ticket.category)}</Badge>
            </div>
            <h1 className="text-xl font-bold mt-1">{getField("title")}</h1>
            {ticket.status === "requester_confirmed" && ticketConfirmation && (
              <div className="mt-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl p-3 border border-emerald-200 dark:border-emerald-800 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                    {t.tickets.confirmedBy}: {ticketConfirmation.confirmedByName}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t.tickets.confirmedAt}: {new Date(ticketConfirmation.createdAt).toLocaleDateString(locale)}
                  </span>
                </div>
                {ticketConfirmation.note && (
                  <p className="text-sm text-muted-foreground">{ticketConfirmation.note}</p>
                )}
                {Array.isArray(ticketConfirmation.photoUrls) && ticketConfirmation.photoUrls.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {ticketConfirmation.photoUrls.map((url: string, idx: number) => (
                      <img
                        key={idx}
                        src={url}
                        alt={`confirmation-${idx}`}
                        className="w-20 h-20 rounded-lg object-cover border cursor-pointer"
                        onClick={() => setLightboxUrl(url)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {canDownloadArchive && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadPDF}
            disabled={downloadingPdf || !ticket}
            className="gap-2 shrink-0"
          >
            {downloadingPdf ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Archive className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">{t.workflow.ticket.archiveReport}</span>
          </Button>
        )}
      </div>

      {ticket.workflowModel === "sub_ticket" && ticket.parentTicketId && (
        <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <GitBranch className="w-4 h-4 text-blue-600" />
              <span>{t.workflow.ticket.childTicketNotice}</span>
              <span className="font-mono font-medium">{parentTicket?.ticketNumber || `#${ticket.parentTicketId}`}</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => setLocation(`/tickets/${ticket.parentTicketId}`)}>
              {t.workflow.ticket.openParentTicket}
            </Button>
          </CardContent>
        </Card>
      )}

      <ItTeamPanel ticket={ticket} departments={departmentPlan?.departments || []} onChanged={() => { refetch(); refetchDepartmentPlan(); }} />
      <ExternalRouteReviewPanel ticketId={ticketId} onChanged={refetchAll} />
      {ticket.workflowModel === "department_tasks" && ticket.status !== "pending_triage" && departmentPlan && (
        <Card className="border-purple-200 dark:border-purple-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-600" /> {t.workflow.ticket.departmentsAndTasks}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {t.workflow.ticket.departmentPlanIntro}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              // لوحة اكتمال العائلة + الإغلاق اليدوي بحارس.
              // سبب وجودها: الرأس كان يبقى بحالة "تحليل الجهات والمهام" إلى الأبد
              // بعد انتهاء كل أبنائه، فلا شيء بالواجهة يفرّق بين عائلة انتهت وأخرى
              // لا تزال قيد العمل. النسبة تظهر فورًا، والزر يظهر عند 100% فقط.
              const summary = (departmentPlan as any)?.subTicketsSummary;
              if (!summary || summary.total === 0) return null;
              const pending = ((departmentPlan as any)?.pendingSubTickets || []) as any[];
              const parentClosed = ticket.status === "closed" || ticket.status === "requester_confirmed";
              const canCloseParent = (isSupervisor || isManager) && summary.allFinished && !parentClosed;
              return (
                <div className={`rounded-lg border p-3 space-y-2 ${summary.allFinished && !parentClosed ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30" : "bg-muted/30"}`}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-sm font-medium">
                      {t.workflow.ticket.parentTaskCompletion}: {summary.finished} / {summary.total}
                      <span className="text-xs text-muted-foreground font-normal mr-2">
                        ({summary.confirmed} {t.workflow.ticket.requesterConfirmed})
                      </span>
                    </div>
                    <span className="text-sm font-bold tabular-nums">{summary.percent}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${summary.allFinished ? "bg-emerald-500" : "bg-purple-500"}`}
                      style={{ width: `${summary.percent}%` }}
                    />
                  </div>
                  {parentClosed ? (
                    <p className="text-xs text-muted-foreground">
                      {t.workflow.ticket.parentPlanFrozen}
                    </p>
                  ) : summary.allFinished ? (
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                        {t.workflow.ticket.allBranchesComplete}
                      </p>
                      {canCloseParent && (
                        <Button size="sm" className="gap-2" disabled={closeParentTicketMut.isPending}
                          onClick={() => closeParentTicketMut.mutate({ id: ticketId })}>
                          {closeParentTicketMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                          {t.workflow.ticket.closeParentTicket}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground space-y-1">
                      {pending.length > 0 && (
                        <p>{t.workflow.ticket.waitingFor}: {pending.map((child: any) => child.ticketNumber).join(language === "en" ? ", " : "، ")}</p>
                      )}
                      {summary.pendingTaskCount > 0 && (
                        <p>{t.workflow.ticket.pendingTaskPromotion.replace("{count}", String(summary.pendingTaskCount))}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
            {departmentPlan.departments.map((dept: any) => {
              const manager = users?.find((u: any) => u.id === dept.responsibleManagerId);
              const deptTasks = departmentPlan.tasks.filter((task: any) => task.ticketDepartmentId === dept.id);
              // خطة الجهات تُجمَّد بصريًا بمجرد إغلاق الرأس — مطابق لحارس السيرفر
              // assertDepartmentPlanEditable، حتى لا يظهر زر يفشل عند الضغط.
              const planFrozen = ticket.status === "closed" || ticket.status === "requester_confirmed";
              const canManageDept = !planFrozen && (isAdminOrOwner ||
                (dept.department === MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL && (
                  role === APP_ROLE.MAINTENANCE_MANAGER ||
                  (dept.responsibleManagerId === user?.id && role === APP_ROLE.GENERAL_MAINTENANCE_MANAGER)
                )) ||
                (dept.department === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION &&
                  dept.responsibleManagerId === user?.id && role === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER) ||
                (dept.department === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT && isItTeamRole(role) && (
                  dept.claimedById === user?.id ||
                  (role === APP_ROLE.IT_MANAGER && dept.responsibleManagerId === user?.id)
                )));
              const isItDepartmentPlan = dept.department === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT;
              const hasPromotedDepartmentTask = deptTasks.some((task: any) => !!task.convertedTicketId || task.status === "promoted" || task.status === "completed");
              const draft = departmentTaskDrafts[dept.id] || { title: "", description: "" };
              return (
                <div key={dept.id} className="rounded-lg border p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">{dept.department === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT ? t.workflow.ticket.departmentIt : dept.department === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION ? t.workflow.ticket.departmentConstruction : t.workflow.ticket.departmentGeneral}</p>
                      <p className="text-xs text-muted-foreground">{t.workflow.ticket.departmentManager}: {manager?.name || manager?.email || `#${dept.responsibleManagerId}`}</p>
                      {dept.department === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION && dept.organizationalTitle && (
                        <p className="mt-1 text-sm font-semibold text-purple-700 dark:text-purple-300">{t.workflow.ticket.organizationalTitle}: <EntityTranslatedText entityType="TICKET_DEPARTMENT" entityId={Number(dept.id)} field="organizationalTitle" original={dept.organizationalTitle} /></p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary">{deptTasks.length} {t.workflow.ticket.tasks}</Badge>
                      {canManageDept && isItDepartmentPlan && role === APP_ROLE.IT_MANAGER && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={hasPromotedDepartmentTask}
                          onClick={() => {
                            setItTransferDepartment("");
                            setItTransferManagerId("");
                            setItTransferJustification("");
                            setShowItTransferDialog(true);
                          }}
                        >
                          {t.workflow.ticket.transferToMaintenance}
                        </Button>
                      )}
                    </div>
                  </div>
                  {canManageDept && isItDepartmentPlan && role === APP_ROLE.IT_MANAGER && hasPromotedDepartmentTask && (
                    <p className="text-xs text-muted-foreground">{t.workflow.ticket.transferBlocked}</p>
                  )}

                  {canManageDept && (
                    <div className="rounded-md bg-muted/40 p-3 space-y-2">
                      <div className="grid sm:grid-cols-2 gap-2">
                        <Input placeholder={t.workflow.ticket.taskTitlePlaceholder} value={draft.title}
                          onChange={(e) => setDepartmentTaskDrafts(prev => ({ ...prev, [dept.id]: { ...draft, title: e.target.value } }))} />
                        <Textarea placeholder={t.workflow.ticket.taskDescriptionPlaceholder} rows={2} value={draft.description}
                          onChange={(e) => setDepartmentTaskDrafts(prev => ({ ...prev, [dept.id]: { ...draft, description: e.target.value } }))} />
                      </div>
                      <Button size="sm" className="gap-2" disabled={!draft.description.trim() || createDepartmentTaskMut.isPending}
                        onClick={() => createDepartmentTaskMut.mutate({ ticketId, ticketDepartmentId: dept.id, title: draft.title || undefined, description: draft.description })}>
                        {createDepartmentTaskMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {t.workflow.ticket.createTask}
                      </Button>
                    </div>
                  )}

                  {deptTasks.length === 0 ? <p className="text-xs text-muted-foreground">{t.workflow.ticket.noTasks}</p> : (
                    <div className="space-y-3">
                      {deptTasks.map((task: any) => {
                        const persistedAssigneeIds = departmentPlan.assignees.filter((a: any) => a.taskId === task.id).map((a: any) => a.userId);
                        const selectedIds = taskAssigneeDrafts[task.id] ?? persistedAssigneeIds;
                        const setSelectedIds = (ids: number[]) => setTaskAssigneeDrafts(prev => ({ ...prev, [task.id]: ids }));
                        const assigneeSearch = taskAssigneeSearches[task.id] ?? "";
                        const normalizedAssigneeSearch = assigneeSearch.trim().toLocaleLowerCase();
                        const visibleTechnicians = normalizedAssigneeSearch
                          ? technicians.filter((tech: any) => String(tech.name || tech.email || "").toLocaleLowerCase().includes(normalizedAssigneeSearch))
                          : technicians;
                        return (
                          <div key={task.id} className="rounded-md border bg-background p-3 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium flex flex-wrap gap-1" dir="auto">
                                  <span>{t.workflow.ticket.task} {task.taskNumber}</span>
                                  {task.title ? <><span>—</span><EntityTranslatedText entityType="TICKET_TASK" entityId={task.id} field="title" original={task.title} /></> : null}
                                </p>
                                <EntityTranslatedText as="p" className="text-xs text-muted-foreground whitespace-pre-wrap" entityType="TICKET_TASK" entityId={task.id} field="description" original={task.description} />
                              </div>
                              <Badge variant="outline">{task.status === "pending_assignment" ? t.workflow.ticket.pendingAssignment : task.status === "assigned" ? t.workflow.ticket.distributed : task.status === "promoted" ? t.workflow.ticket.subTicket : task.status}</Badge>
                            </div>

                            {(canManageDept || (isItDepartmentPlan && isItTeamRole(role) && persistedAssigneeIds.includes(user?.id))) && !task.convertedTicketId && (
                              isItDepartmentPlan ? (
                                <ItTaskActions ticketId={ticketId} taskId={task.id} assigneeIds={persistedAssigneeIds} canAssign={canManageDept} onChanged={() => { refetch(); refetchDepartmentPlan(); }} />
                              ) : (
                                <TeamAssignmentSlot enabled={supportsTeamTaskAssignmentDepartment(dept.department)} ticketId={ticketId} taskId={task.id} hasNamedAssignment={persistedAssigneeIds.length > 0} onChanged={() => { refetch(); refetchDepartmentPlan(); }}>
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <Label className="text-xs">{t.workflow.ticket.assignedTechnicians}</Label>
                                    <span className="text-[11px] text-muted-foreground">{t.workflow.ticket.selectedCount}: {selectedIds.length}</span>
                                  </div>
                                  <div className="relative">
                                    <Search className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none ${dir === "rtl" ? "right-2.5" : "left-2.5"}`} />
                                    <Input
                                      value={assigneeSearch}
                                      onChange={(e) => setTaskAssigneeSearches(prev => ({ ...prev, [task.id]: e.target.value }))}
                                      placeholder={t.workflow.ticket.technicianSearch}
                                      className={`h-8 text-xs ${dir === "rtl" ? "pr-8" : "pl-8"}`}
                                    />
                                  </div>
                                  <div className="grid sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto rounded border p-2">
                                    {visibleTechnicians.length > 0 ? visibleTechnicians.map((tech: any) => {
                                      const checked = selectedIds.includes(tech.id);
                                      return <label key={tech.id} className="flex items-center gap-2 text-xs cursor-pointer rounded px-1 py-0.5 hover:bg-muted/50">
                                        <input type="checkbox" checked={checked} onChange={(e) => setSelectedIds(e.target.checked ? [...selectedIds, tech.id] : selectedIds.filter((id: number) => id !== tech.id))} />
                                        <span>{tech.name || tech.email}</span>
                                      </label>;
                                    }) : (
                                      <p className="sm:col-span-2 py-2 text-center text-xs text-muted-foreground">{t.workflow.ticket.noTechnicianMatch}</p>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <Button variant="outline" size="sm" disabled={!selectedIds.length || assignDepartmentTaskMut.isPending}
                                      onClick={() => assignDepartmentTaskMut.mutate({ ticketId, taskId: task.id, technicianIds: selectedIds })}>
                                      {t.workflow.ticket.saveAssignment}
                                    </Button>
                                    <Button size="sm" className="gap-2" disabled={!persistedAssigneeIds.length || promoteDepartmentTaskMut.isPending}
                                      onClick={() => promoteDepartmentTaskMut.mutate({ ticketId, taskId: task.id })}>
                                      {promoteDepartmentTaskMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitBranch className="w-4 h-4" />} {t.workflow.ticket.promoteToSubTicket}
                                    </Button>
                                  </div>
                                </div>
                                </TeamAssignmentSlot>
                              )
                            )}
                            {!!task.convertedTicketId && (
                              <Button variant="outline" size="sm" className="gap-2" onClick={() => setLocation(`/tickets/${task.convertedTicketId}`)}>
                                <GitBranch className="w-4 h-4" /> {t.workflow.ticket.subTicket}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Dialog open={showItTransferDialog} onOpenChange={setShowItTransferDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.workflow.ticket.transferDialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t.workflow.ticket.receivingDepartmentRequired}</Label>
              <Select
                value={itTransferDepartment}
                onValueChange={(value) => {
                  setItTransferDepartment(value);
                  const managers = value === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION ? constructionManagers : generalManagers;
                  setItTransferManagerId(managers.length === 1 ? String(managers[0].id) : "");
                }}
              >
                <SelectTrigger><SelectValue placeholder={t.workflow.ticket.chooseDepartment} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL}>{t.workflow.ticket.departmentGeneral}</SelectItem>
                  <SelectItem value={MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION}>{t.workflow.ticket.departmentConstruction}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t.workflow.ticket.receivingManagerRequired}</Label>
              <Select value={itTransferManagerId} onValueChange={setItTransferManagerId} disabled={!itTransferDepartment}>
                <SelectTrigger><SelectValue placeholder={itTransferDepartment ? t.workflow.ticket.chooseManager : t.workflow.ticket.chooseDepartmentFirst} /></SelectTrigger>
                <SelectContent>
                  {itTransferManagers.map((manager: any) => (
                    <SelectItem key={manager.id} value={String(manager.id)}>{manager.name || manager.email || `#${manager.id}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {itTransferDepartment && itTransferManagers.length === 0 && (
                <p className="text-xs text-destructive">{t.workflow.ticket.noActiveManager}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t.workflow.ticket.transferReasonRequired}</Label>
              <Textarea
                rows={4}
                value={itTransferJustification}
                onChange={(e) => setItTransferJustification(e.target.value)}
                placeholder={t.workflow.ticket.transferReasonPlaceholder}
              />
              <p className="text-xs text-muted-foreground">{t.workflow.ticket.transferAuditHint}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowItTransferDialog(false)} disabled={transferItTicketMut.isPending}>{t.workflow.ticket.cancel}</Button>
            <Button
              disabled={!itTransferDepartment || !itTransferManagerId || itTransferJustification.trim().length < 5 || transferItTicketMut.isPending}
              onClick={() => transferItTicketMut.mutate({
                id: ticketId,
                department: itTransferDepartment as any,
                responsibleManagerId: Number(itTransferManagerId),
                justification: itTransferJustification.trim(),
              })}
            >
              {transferItTicketMut.isPending ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
              {t.workflow.ticket.confirmTransfer}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* بنود البلاغ — الخطوة 2 من ميزة البلاغ متعدد الجهات (2026-08-08). يظهر فقط للبلاغات
          متعددة البنود فعليًا (>1) — البلاغ ببند واحد يعرض ملخصه بالأعلى كالمعتاد، فبطاقة
          بند إضافية مطابقة له تمامًا لا تضيف معلومة جديدة. */}
      {ticketItems && ticketItems.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-purple-600" />
              {t.workflow.ticket.ticketItems} ({ticketItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {ticketItems.map((item: any) => {
              // من يملك تنفيذ إجراء على هذا البند؟ (فلترة تجميلية — الخادم هو الحارس الحقيقي)
              const isItemTech = item.assignedToId === user?.id;
              const isItemManager = isAdminOrOwner || role === APP_ROLE.MAINTENANCE_MANAGER || role === APP_ROLE.SUPERVISOR ||
                (role === APP_ROLE.GENERAL_MAINTENANCE_MANAGER && (!item.responsibleDepartment || item.responsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL)) ||
                (role === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER && item.responsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION && item.responsibleManagerId === user?.id) ||
                (isItTeamRole(role) && item.responsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT && item.assignedToId === user?.id);
              const canExecuteItem = !isTicketReadOnly && (isItemTech || isItemManager);
              const form = itemRepairForms[item.id] || { afterPhotoUrl: "", repairNotes: "", materialsUsed: "" };
              const setForm = (patch: any) => setItemRepairForms(prev => ({ ...prev, [item.id]: { ...form, ...patch } }));

              const canStart = canExecuteItem && item.maintenancePath &&
                (item.maintenancePath === "A" ? ["work_approved", "assigned"].includes(item.status) : item.status === "received_warehouse");
              const canComplete = canExecuteItem && item.status === "in_progress";
              const canApproveItemClose = !isTicketReadOnly && isItemManager && item.status === "ready_for_closure";

              return (
                <div key={item.id} className="space-y-2">
                  <TicketItemStepCard item={item} getStatusLabel={getStatusLabel} />

                  {canStart && (
                    <Button
                      onClick={() => startRepairForItemMut.mutate({ ticketItemId: item.id })}
                      disabled={startRepairForItemMut.isPending}
                      size="sm" className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {startRepairForItemMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
                      {t.workflow.ticket.startItem} {item.itemNumber}
                    </Button>
                  )}

                  {canComplete && (
                    <div className="space-y-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-3">
                      <p className="text-xs font-medium">{t.workflow.ticket.submitItemResult} {item.itemNumber}</p>
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t.workflow.ticket.afterRepairPhotoOptional}</Label>
                        {form.afterPhotoUrl ? (
                          <div className="relative">
                            <img src={form.afterPhotoUrl} alt={t.workflow.ticket.afterRepairPhotoAlt} className="w-full h-32 object-cover rounded-lg" />
                            <Button variant="destructive" size="sm" className="absolute top-2 left-2"
                              onClick={() => setForm({ afterPhotoUrl: "" })}>{t.common.delete}</Button>
                          </div>
                        ) : (
                          <Input type="file" accept="image/*" className="text-xs"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const formData = new FormData();
                              formData.append("file", file);
                              try {
                                const res = await fetch("/api/upload", { method: "POST", body: formData });
                                const data = await res.json();
                                if (data.url) { setForm({ afterPhotoUrl: data.url }); toast.success(t.common.save); }
                              } catch { toast.error(t.workflow.ticket.uploadPhotoFailed); }
                            }} />
                        )}
                      </div>
                      <Textarea placeholder={t.workflow.ticket.repairNotesRequiredPlaceholder} rows={2} className="text-sm"
                        value={form.repairNotes} onChange={e => setForm({ repairNotes: e.target.value })} />
                      <Textarea placeholder={t.workflow.ticket.materialsUsedOptionalPlaceholder} rows={2} className="text-sm"
                        value={form.materialsUsed} onChange={e => setForm({ materialsUsed: e.target.value })} />
                      <Button
                        onClick={() => completeRepairForItemMut.mutate({
                          ticketItemId: item.id,
                          afterPhotoUrl: form.afterPhotoUrl,
                          repairNotes: form.repairNotes.trim(),
                          materialsUsed: form.materialsUsed || undefined,
                        })}
                        disabled={completeRepairForItemMut.isPending || !form.repairNotes.trim()}
                        size="sm" className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        {completeRepairForItemMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        {t.workflow.ticket.finishItem} {item.itemNumber}
                      </Button>
                    </div>
                  )}

                  {canApproveItemClose && (
                    <Button
                      onClick={() => closeTicketItemMut.mutate({ ticketItemId: item.id })}
                      disabled={closeTicketItemMut.isPending}
                      size="sm" className="w-full gap-2 bg-teal-600 hover:bg-teal-700 text-white"
                    >
                      {closeTicketItemMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      {t.workflow.ticket.approveItemClosure} {item.itemNumber}
                    </Button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          {ticket.workflowModel === "department_tasks" && ticket.status !== "pending_triage" ? (
            <div className="flex items-center justify-between gap-1 overflow-x-auto">
              {[
                { key: "triage", label: t.workflow.ticket.stageTriage, done: true },
                { key: "departments", label: t.workflow.ticket.stageDepartments, done: true },
                { key: "tasks", label: t.workflow.ticket.stageTasks, done: (departmentPlan?.tasks?.length || 0) > 0 },
                { key: "subtickets", label: t.workflow.ticket.stageSubTickets, done: (departmentPlan?.tasks || []).some((task: any) => !!task.convertedTicketId) },
              ].map((step, i, arr) => (
                <div key={step.key} className="flex items-center gap-1 flex-1 min-w-0">
                  <div className={`flex items-center gap-1.5 ${step.done ? "text-primary" : "text-muted-foreground/40"}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${step.done ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground/40"}`}>
                      {step.done ? "✓" : i + 1}
                    </div>
                    <span className="text-[11px] font-medium whitespace-nowrap">{step.label}</span>
                  </div>
                  {i < arr.length - 1 && <div className={`flex-1 h-px mx-1 ${step.done ? "bg-primary/40" : "bg-muted"}`} />}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-1 overflow-x-auto">
              {workflowSteps.map((step, i) => (
                <div key={step.key} className="flex items-center gap-1 flex-1 min-w-0">
                  <div className={`flex items-center gap-1.5 ${step.done ? "text-primary" : "text-muted-foreground/40"}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${ticket.status === step.key ? "bg-primary text-primary-foreground ring-2 ring-primary/30" : step.done ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground/40"}`}>
                      {step.done ? "✓" : i + 1}
                    </div>
                    <span className="text-[11px] font-medium whitespace-nowrap">{step.label}</span>
                  </div>
                  {i < workflowSteps.length - 1 && <div className={`flex-1 h-px mx-1 ${step.done ? "bg-primary/40" : "bg-muted"}`} />}
                </div>
              ))}
            </div>
          )}
          {["needs_purchase", "purchase_pending_estimate", "purchase_pending_accounting", "purchase_pending_management", "purchase_approved", "partial_purchase", "purchased", "received_warehouse"].includes(ticket.status) && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg p-2">
                <ShoppingCart className="w-4 h-4 shrink-0" />
                <span className="font-medium">{t.purchaseOrders.title}: {getStatusLabel(ticket.status)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {isTicketReadOnly && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
          {/* اختَر النص من جهة البلاغ وحالة استلامه، دون تغيير حارس القراءة فقط. */}
          {isItDepartmentTicket
            ? isWaitingForItTeamClaim
              ? t.workflow.ticket.waitingForItTeamClaim
              : t.workflow.ticket.readOnlyIt
            : isLinkedTicketReadOnly
              ? t.workflow.ticket.readOnlyOutOfDepartment
              : t.workflow.ticket.readOnlyConstruction}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{t.tickets.ticketTitle}</CardTitle>
              {canEditTicket && (
                <Button variant="ghost" size="sm" className="gap-1.5 h-8" onClick={openEditDialog}>
                  <Pencil className="w-3.5 h-3.5" /> {t.common.edit}
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {ticket.description && <p className="text-sm leading-relaxed">{getField("description")}</p>}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{t.tickets.category}:</span>
                  <span className="font-medium">{ticket.centerCategoryName || getCategoryLabel(ticket.category)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">{t.tickets.site}:</span>
                  <span className="font-medium">
                    {ticket.siteId ? (getLocalizedName(allSites?.find((s: any) => s.id === ticket.siteId), language) || ticket.locationDetail || "-") : (ticket.locationDetail || "-")}
                    {ticket.sectionId && allSections?.find((s: any) => s.id === ticket.sectionId) && (
                      <span className="text-muted-foreground"> / {getLocalizedName(allSections.find((s: any) => s.id === ticket.sectionId), language)}</span>
                    )}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ticket.beforePhotoUrl && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <Camera className="w-3.5 h-3.5" /> {t.tickets.photos}
                    </p>
                    <div className="relative group cursor-pointer" onClick={() => setLightboxUrl(ticket.beforePhotoUrl!)}>
                      <img src={ticket.beforePhotoUrl} alt="before" className="rounded-lg max-h-48 w-full object-cover border" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors rounded-lg flex items-center justify-center">
                        <ZoomIn className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                      </div>
                    </div>
                  </div>
                )}
                {ticket.afterPhotoUrl && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium flex items-center gap-1.5 text-emerald-600">
                      <CheckCircle2 className="w-3.5 h-3.5" /> {t.tickets.photos}
                    </p>
                    <div className="relative group cursor-pointer" onClick={() => setLightboxUrl(ticket.afterPhotoUrl!)}>
                      <img src={ticket.afterPhotoUrl} alt="after" className="rounded-lg max-h-48 w-full object-cover border" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors rounded-lg flex items-center justify-center">
                        <ZoomIn className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Ticket Attachments - Additive: existing display + new DropZone */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" /> {(t as any).attachments?.title || t.workflow.ticket.attachments} ({ticketAttachments?.length ?? 0})
                  </p>
                  {isManager && !isTicketReadOnly && (
                    <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => setShowAttachDropZone(v => !v)}>
                      <Upload className="w-3.5 h-3.5" />
                      {t.workflow.ticket.addAttachment}
                    </Button>
                  )}
                </div>

                {/* Existing attachments grid */}
                {(ticketAttachments ?? []).length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {(ticketAttachments ?? []).map((att: any) => (
                      att.mimeType?.startsWith("image/") ? (
                        <div
                          key={att.id}
                          className="group border rounded-lg overflow-hidden hover:border-primary transition-colors cursor-pointer"
                          onClick={() => setLightboxUrl(mediaUrl(att.fileUrl))}
                        >
                          <div className="relative">
                            <img src={mediaUrl(att.fileUrl)} alt={att.fileName} className="w-full h-28 object-cover" />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                              <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                            </div>
                          </div>
                          <div className="px-2 py-1.5 text-xs truncate text-muted-foreground group-hover:text-primary">
                            {att.fileName}
                          </div>
                        </div>
                      ) : att.mimeType?.startsWith("video/") ? (
                        <div key={att.id} className="group border rounded-lg overflow-hidden">
                          <AttachmentVideo url={mediaUrl(att.fileUrl)} fileName={att.fileName} />
                          <div className="px-2 py-1.5 text-xs truncate text-muted-foreground flex items-center gap-1">
                            <Video className="w-3 h-3 flex-shrink-0" /> {att.fileName}
                          </div>
                        </div>
                      ) : (
                        <a key={att.id} href={mediaUrl(att.fileUrl)} target="_blank" rel="noopener noreferrer" className="group border rounded-lg overflow-hidden hover:border-primary transition-colors">
                          <div className="w-full h-28 flex flex-col items-center justify-center bg-muted/50 gap-2">
                            <FileText className="w-8 h-8 text-muted-foreground" />
                          </div>
                          <div className="px-2 py-1.5 text-xs truncate text-muted-foreground group-hover:text-primary">
                            {att.fileName}
                          </div>
                        </a>
                      )
                    ))}
                  </div>
                )}

                {/* NEW: Drag & Drop zone (additive - shown on demand) */}
                {showAttachDropZone && !isTicketReadOnly && (
                  <DropZone
                    onFilesUploaded={handleNewAttachments}
                    label={t.workflow.ticket.dragAdditionalFiles}
                    sublabel={t.workflow.ticket.imagesPdfLimit}
                  />
                )}
              </div>

              {ticket.repairNotes && (
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-sm font-medium mb-1">{t.tickets.repairNotes}</p>
                  <p className="text-sm text-muted-foreground">{getField("repairNotes")}</p>
                </div>
              )}
              {materialsUsedText && (
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-sm font-medium mb-1">{t.tickets.materialsUsed}</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap" dir="auto">{materialsUsedText}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {linkedPOs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4" /> {t.purchaseOrders.title} ({linkedPOs.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {linkedPOs.map(po => (
                  <div
                    key={po.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => setLocation(`/purchase-orders/${po.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center">
                        <FileText className="w-4 h-4 text-teal-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{po.poNumber}</p>
                        <p className="text-xs text-muted-foreground">
                          {po.totalEstimatedCost ? `${t.purchaseOrders.totalEstimated}: ${Number(po.totalEstimatedCost).toLocaleString(locale)} ${currency}` : t.common.loading}
                          {po.totalActualCost ? ` | ${t.purchaseOrders.totalActual}: ${Number(po.totalActualCost).toLocaleString(locale)} ${currency}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{getPOStatusLabel(po.status)}</Badge>
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">{t.common.actions}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {canApprove && (
                <Button onClick={() => approveMut.mutate({ id: ticket.id })} disabled={approveMut.isPending} className="w-full gap-2" size="lg">
                  <CheckCircle2 className="w-4 h-4" /> {t.tickets.approve}
                </Button>
              )}

              {canAssign && (
                <div className="space-y-3 border rounded-xl p-3 bg-muted/20">
                  {ticket.assignedToId || ticket.assignedTechnicianId ? (
                    <>
                      <div className="rounded-lg border bg-background p-3">
                        <p className="text-xs text-muted-foreground mb-1">{t.workflow.ticket.currentTechnician}</p>
                        <div className="flex items-center gap-2">
                          <Wrench className="w-4 h-4 text-primary" />
                          <span className="font-semibold">{currentAssigneeName}</span>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {t.workflow.ticket.assignmentLockedHint}
                        </p>
                      </div>

                      {!showReassignmentEditor ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={() => {
                            setSelectedTech(ticket.assignedToId ? String(ticket.assignedToId) : "");
                            setReassignmentReason("");
                            setShowReassignmentEditor(true);
                          }}
                        >
                          {t.workflow.ticket.changeTechnician}
                        </Button>
                      ) : (
                        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-950/10">
                          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">{t.workflow.ticket.chooseReplacementTechnician}</p>
                          <TechnicianCombobox
                            value={selectedTech}
                            onValueChange={(val) => {
                              setSelectedTech(val);
                              setSelectedExternalTech("");
                            }}
                            placeholder={t.tickets.assignTechnician}
                            options={technicians.map((tech: any) => ({
                              value: String(tech.id),
                              label: `${tech.name || tech.email}${tech.specialty ? ` (${tech.specialty})` : ""}`,
                            }))}
                          />
                          <div className="space-y-1.5">
                            <Label>{t.workflow.ticket.reassignmentReasonRequired}</Label>
                            <Textarea
                              value={reassignmentReason}
                              onChange={(event) => setReassignmentReason(event.target.value)}
                              placeholder={t.workflow.ticket.reassignmentReasonPlaceholder}
                              rows={2}
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              className="flex-1"
                              onClick={() => {
                                setShowReassignmentEditor(false);
                                setSelectedTech("");
                                setReassignmentReason("");
                              }}
                              disabled={assignMut.isPending}
                            >
                              {t.workflow.ticket.cancel}
                            </Button>
                            <Button
                              className="flex-1"
                              onClick={() => {
                                if (selectedTech) {
                                  assignMut.mutate({
                                    id: ticket.id,
                                    technicianId: parseInt(selectedTech),
                                    reassignmentReason: reassignmentReason.trim(),
                                  });
                                }
                              }}
                              disabled={
                                !selectedTech ||
                                assignMut.isPending ||
                                Number(selectedTech) === ticket.assignedToId ||
                                !reassignmentReason.trim()
                              }
                            >
                              {assignMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t.workflow.ticket.approveReassignment}
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-muted-foreground">👷 {t.workflow.ticket.assignResponsibleTechnician}</p>
                      <TechnicianCombobox
                        value={selectedTech}
                        onValueChange={(val) => {
                          setSelectedTech(val);
                          setSelectedExternalTech("");
                        }}
                        placeholder={t.tickets.assignTechnician}
                        options={technicians.map((tech: any) => ({
                          value: String(tech.id),
                          label: `${tech.name || tech.email}${tech.specialty ? ` (${tech.specialty})` : ""}`,
                        }))}
                      />
                      <Button
                        className="w-full"
                        onClick={() => {
                          if (selectedTech) {
                            assignMut.mutate({ id: ticket.id, technicianId: parseInt(selectedTech) });
                          }
                        }}
                        disabled={!selectedTech || assignMut.isPending}
                      >
                        {assignMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t.workflow.ticket.approveAssignment}
                      </Button>
                    </>
                  )}
                </div>
              )}

              {canStartRepair && (
                <Button onClick={() => startMut.mutate({ id: ticket.id })} disabled={startMut.isPending} className="w-full gap-2" size="lg">
                  <Wrench className="w-4 h-4" /> {ticket?.maintenancePath === "C" ? t.workflow.ticket.startReinstall : t.tickets.startRepair}
                </Button>
              )}

              {canCompleteRepair && (
                <div className="space-y-3 bg-muted/30 rounded-xl p-4 border">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" /> {t.tickets.completeRepair}
                  </h4>
                  <Textarea placeholder={`${t.tickets.repairNotes} (${t.workflow.ticket.requiredParen})`} value={repairNotes} onChange={e => setRepairNotes(e.target.value)} rows={3} />
                  <Textarea placeholder={t.tickets.materialsUsed} value={materialsUsed} onChange={e => setMaterialsUsed(e.target.value)} rows={2} />

                  <div className="space-y-2">
                    <p className="text-sm font-medium">{t.tickets.photos} ({t.workflow.ticket.optionalParen}):</p>
                    {afterPhotoUrl ? (
                      <div className="relative">
                        <img src={afterPhotoUrl} alt="after" className="rounded-lg max-h-40 object-cover border" />
                        <Button variant="destructive" size="sm" className="absolute top-2 left-2" onClick={() => setAfterPhotoUrl("")}>{t.common.delete}</Button>
                      </div>
                    ) : (
                      <Button variant="outline" className="w-full h-20 border-dashed gap-2" onClick={() => {
                        const input = document.createElement("input");
                        input.type = "file"; input.accept = "image/*";
                        input.onchange = (e: any) => { if (e.target.files[0]) handleUploadAfterPhoto(e.target.files[0]); };
                        input.click();
                      }} disabled={uploading}>
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                        {uploading ? t.common.loading : t.tickets.photos}
                      </Button>
                    )}
                  </div>

                  <Button onClick={() => completeMut.mutate({ id: ticket.id, repairNotes: repairNotes.trim(), materialsUsed, afterPhotoUrl: afterPhotoUrl || undefined })} disabled={completeMut.isPending || !repairNotes.trim()} className="w-full gap-2" size="lg">
                    {completeMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {t.tickets.completeRepair}
                  </Button>
                </div>
              )}

              {canClose && (
                <Button onClick={() => closeMut.mutate({ id: ticket.id })} disabled={closeMut.isPending} variant="outline" className="w-full gap-2" size="lg">
                  {t.tickets.closeTicket}
                </Button>
              )}

              {/* ===== NEW WORKFLOW SMART BUTTONS ===== */}

              {/* Supervisor: Start Triage - opens dialog to assign technician */}
              {canTriage && (
                <div className="space-y-2 bg-amber-50 dark:bg-amber-950/20 rounded-xl p-4 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-amber-600 dark:text-amber-400 font-semibold text-sm">🔍 {t.workflow.ticket.triageAndClassify}</span>
                  </div>
                  <Button onClick={() => { setTriageAssignedTo(""); setTriageDepartment(""); setTriageResponsibleManagerId(""); setTriageMode("multi"); setMultiAssignments(emptyMultiAssignments()); setShowTriageDialog(true); }} className="w-full gap-2 bg-amber-600 hover:bg-amber-700 text-white" size="lg">
                    <CheckCircle2 className="w-4 h-4" />
                    {t.workflow.ticket.startTriageAssign}
                  </Button>
                </div>
              )}

              {/* Smart Timeline */}
              {(() => {
                const steps = [
                  { label: t.workflow.ticket.stageCreated, statuses: ["new"] },
                  { label: t.workflow.ticket.stageInspection, statuses: ["pending_triage", "under_inspection"] },
                  { label: t.workflow.ticket.stageApproval, statuses: ["work_approved", "approved"] },
                  { label: t.workflow.ticket.stagePurchase, statuses: ["needs_purchase", "purchase_pending_estimate", "purchase_pending_accounting", "purchase_pending_management", "purchase_approved", "partial_purchase", "purchased", "received_warehouse"] },
                  { label: t.workflow.ticket.stageRepair, statuses: ["assigned", "in_progress", "out_for_repair", "ready_for_closure", "repaired", "verified"] },
                  { label: t.workflow.ticket.stageClosure, statuses: ["closed"] },
                ];
                const currentStepIndex = steps.findIndex(s => s.statuses.includes(ticket.status));
                const scrollTargets: Record<number, string> = {
                  1: "inspection-section",
                };
                return (
                  <div className="flex items-center gap-1 overflow-x-auto py-2 px-1 mb-2">
                    {steps.map((step, i) => {
                      const isDone = i < currentStepIndex || (i === currentStepIndex);
                      const isCurrent = i === currentStepIndex;
                      const targetId = scrollTargets[i];
                      return (
                        <div key={i} className="flex items-center gap-1 flex-1 min-w-0">
                          <button
                            type="button"
                            onClick={() => targetId && document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth" })}
                            className={`flex items-center gap-1 focus:outline-none ${
                              isCurrent ? "text-blue-600 font-bold" :
                              isDone ? "text-primary" : "text-muted-foreground/40"
                            }`}
                          >
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                              isCurrent ? "bg-blue-600 text-white ring-2 ring-blue-300" :
                              isDone ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground/40"
                            }`}>
                              {isDone && !isCurrent ? "✓" : i + 1}
                            </div>
                            <span className="text-[11px] font-medium whitespace-nowrap">{step.label}</span>
                          </button>
                          {i < steps.length - 1 && (
                            <div className={`flex-1 h-px mx-1 ${isDone ? "bg-primary/40" : "bg-muted"}`} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Inspection workflow status */}
              {ticket.status === "under_inspection" && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/30 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">{t.workflow.ticket.inspectionStage}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.workflow.ticket.directAssignmentHint}
                    </p>
                  </div>
                  <Badge variant={inspectionWorkflowStatus === MAINTENANCE_INSPECTION_WORKFLOW_STATUS.APPROVED ? "default" : "secondary"}>
                    {inspectionStatusLabel}
                  </Badge>
                </div>
              )}

              {hasForeignInspectionDraft && ticket.status === "under_inspection" && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                  {t.workflow.ticket.otherDraftExists}
                </div>
              )}

              {/* Technician / scoped manager / supervisor: record inspection */}
              {canInspect && (
                <div className="space-y-3 bg-blue-50 dark:bg-blue-950/20 rounded-xl p-4 border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-blue-600 dark:text-blue-400 font-semibold text-sm">📋 {t.workflow.ticket.recordInspection}</span>
                    {inspectionWorkflowStatus === MAINTENANCE_INSPECTION_WORKFLOW_STATUS.RETURNED_FOR_CORRECTION && (
                      <Badge variant="destructive">{t.workflow.ticket.correctionRequired}</Badge>
                    )}
                  </div>
                  {inspectionWorkflowStatus === MAINTENANCE_INSPECTION_WORKFLOW_STATUS.RETURNED_FOR_CORRECTION && ticket.inspectionReturnReason && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                      <span className="font-semibold">{t.workflow.ticket.returnReasonLabel}</span> {ticket.inspectionReturnReason}
                    </div>
                  )}

                  {!isAssignedInspectionTechnician && !isItWorkflowManager && (
                    <div className="space-y-2">
                      <Label>{t.workflow.ticket.inspectedByRequired}</Label>
                      <Select value={inspPerformedById || String(user?.id || "")} onValueChange={setInspPerformedById}>
                        <SelectTrigger><SelectValue placeholder={t.workflow.ticket.chooseInspector} /></SelectTrigger>
                        <SelectContent>
                          {inspectionPerformerOptions.map((candidate: any) => (
                            <SelectItem key={candidate.id} value={String(candidate.id)}>
                              {candidate.name || candidate.username || candidate.email} {candidate.id === user?.id ? `(${t.workflow.ticket.me})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {t.workflow.ticket.inspectorStoredSeparately}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>{t.workflow.ticket.technicalNotesRequired}</Label>
                    <Textarea
                      placeholder={t.workflow.ticket.technicalNotesPlaceholder}
                      value={inspectionNotes}
                      onChange={e => setInspectionNotes(e.target.value)}
                      rows={3}
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t.workflow.ticket.severityRequired}</Label>
                    <Select value={inspSeverity} onValueChange={(value: any) => setInspSeverity(value)}>
                      <SelectTrigger><SelectValue placeholder={t.workflow.ticket.chooseSeverity} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">{t.workflow.ticket.severityLow}</SelectItem>
                        <SelectItem value="medium">{t.workflow.ticket.severityMedium}</SelectItem>
                        <SelectItem value="high">{t.workflow.ticket.severityHigh}</SelectItem>
                        <SelectItem value="critical">{t.workflow.ticket.severityCritical}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea
                    placeholder={t.workflow.ticket.rootCausePlaceholder}
                    value={inspRootCause}
                    onChange={e => setInspRootCause(e.target.value)}
                    rows={2}
                    className="text-sm"
                  />
                  <div className="space-y-2">
                    <Label>{t.workflow.ticket.findingsRequired}</Label>
                    <Textarea
                      placeholder={t.workflow.ticket.findingsPlaceholder}
                      value={inspFindings}
                      onChange={e => setInspFindings(e.target.value)}
                      rows={3}
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t.workflow.ticket.recommendedActionRequired}</Label>
                    <Textarea
                      placeholder={t.workflow.ticket.recommendedActionPlaceholder}
                      value={inspRecommendedAction}
                      onChange={e => setInspRecommendedAction(e.target.value)}
                      rows={2}
                      className="text-sm"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      variant="outline"
                      onClick={() => submitInspection("save_draft")}
                      disabled={inspectMut.isPending}
                      className="w-full gap-2"
                    >
                      {inspectMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                      {t.workflow.ticket.saveDraft}
                    </Button>
                    <Button
                      onClick={() => submitInspection("submit")}
                      disabled={
                        inspectMut.isPending ||
                        !inspectionNotes.trim() ||
                        !inspSeverity ||
                        !inspFindings.trim() ||
                        !inspRecommendedAction.trim()
                      }
                      className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {inspectMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      {isInspectionManager ? t.workflow.ticket.saveApproveInspection : t.workflow.ticket.sendInspectionReview}
                    </Button>
                  </div>
                </div>
              )}

              {/* Manager review of technician/supervisor submission */}
              {canReviewInspection && (
                <div className="space-y-3 bg-amber-50 dark:bg-amber-950/20 rounded-xl p-4 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-700 dark:text-amber-300 font-semibold text-sm">🧾 {t.workflow.ticket.reviewInspection}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t.workflow.ticket.reviewInspectionHint}
                  </p>
                  <Textarea
                    placeholder={t.workflow.ticket.returnForCorrectionPlaceholder}
                    value={inspectionReturnReason}
                    onChange={e => setInspectionReturnReason(e.target.value)}
                    rows={2}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      variant="outline"
                      className="border-red-300 text-red-700 hover:bg-red-50"
                      onClick={() => reviewInspectionMut.mutate({
                        id: ticket.id,
                        action: "return_for_correction",
                        reason: inspectionReturnReason,
                      })}
                      disabled={reviewInspectionMut.isPending || !inspectionReturnReason.trim()}
                    >
                      {t.workflow.ticket.returnForCorrection}
                    </Button>
                    <Button
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => reviewInspectionMut.mutate({ id: ticket.id, action: "approve" })}
                      disabled={reviewInspectionMut.isPending}
                    >
                      {reviewInspectionMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      {t.workflow.ticket.approveInspection}
                    </Button>
                  </div>
                </div>
              )}

              {/* Inspection revisions */}
              <div id="inspection-section" className="space-y-3 bg-gray-50 dark:bg-gray-900/30 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-gray-600 dark:text-gray-400 font-semibold text-sm">🔍 {t.workflow.ticket.inspectionHistory}</span>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs leading-5 text-blue-800 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-300">
                  {t.workflow.ticket.inspectionHistoryHelp}
                </div>
                {!inspectionResultsList || inspectionResultsList.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">{t.workflow.ticket.noInspectionData}</p>
                ) : (
                  <div className="space-y-3">
                    {inspectionResultsList.map((r: any) => {
                      const performedBy = users?.find((u: any) => u.id === (r.performedById || r.inspectorId));
                      const recordedBy = users?.find((u: any) => u.id === (r.recordedById || r.inspectorId));
                      const statusLabels: Record<string, string> = {
                        [MAINTENANCE_INSPECTION_RESULT_STATUS.DRAFT]: t.workflow.ticket.inspectionDraft,
                        [MAINTENANCE_INSPECTION_RESULT_STATUS.SUBMITTED]: t.workflow.ticket.inspectionSubmitted,
                        [MAINTENANCE_INSPECTION_RESULT_STATUS.RETURNED]: t.workflow.ticket.inspectionReturnedLabel,
                        [MAINTENANCE_INSPECTION_RESULT_STATUS.APPROVED]: t.workflow.ticket.inspectionApprovedLabel,
                        [MAINTENANCE_INSPECTION_RESULT_STATUS.SUPERSEDED]: t.workflow.ticket.inspectionSuperseded,
                      };
                      return (
                        <div key={r.id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 text-sm space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold">{t.workflow.ticket.inspectionRevision} {r.revisionNumber || 1}</span>
                            <Badge variant={r.workflowStatus === MAINTENANCE_INSPECTION_RESULT_STATUS.APPROVED ? "default" : "secondary"}>
                              {statusLabels[r.workflowStatus] || r.workflowStatus || t.workflow.ticket.legacyRecord}
                            </Badge>
                          </div>
                          <div className="grid gap-1 sm:grid-cols-2 text-xs text-muted-foreground">
                            <div><span className="font-semibold text-foreground">{t.workflow.ticket.fieldInspector}</span> {performedBy?.name || performedBy?.username || "-"}</div>
                            <div><span className="font-semibold text-foreground">{t.workflow.ticket.resultRecordedBy}</span> {recordedBy?.name || recordedBy?.username || "-"}</div>
                          </div>
                          {r.inspectionNotes && <div><span className="font-semibold">{t.workflow.ticket.technicalNotesLabel}</span>{" "}<EntityTranslatedText entityType="INSPECTION_RESULT" entityId={r.id} field="inspectionNotes" original={r.inspectionNotes} /></div>}
                          <div><span className="font-semibold">{t.workflow.ticket.severityLabel}</span>{" "}{({
  low: t.workflow.ticket.severityLow,
  medium: t.workflow.ticket.severityMedium,
  high: t.workflow.ticket.severityHigh,
  critical: t.workflow.ticket.severityCritical,
} as Record<string, string>)[r.severity] || r.severity}</div>
                          {r.rootCause && <div><span className="font-semibold">{t.workflow.ticket.rootCauseLabel}</span>{" "}<EntityTranslatedText entityType="INSPECTION_RESULT" entityId={r.id} field="rootCause" original={r.rootCause} /></div>}
                          {r.findings && <div><span className="font-semibold">{t.workflow.ticket.findingsLabel}</span>{" "}<EntityTranslatedText entityType="INSPECTION_RESULT" entityId={r.id} field="findings" original={r.findings} /></div>}
                          {r.recommendedAction && <div><span className="font-semibold">{t.workflow.ticket.recommendedActionLabel}</span>{" "}<EntityTranslatedText entityType="INSPECTION_RESULT" entityId={r.id} field="recommendedAction" original={r.recommendedAction} /></div>}
                          {r.returnReason && (
                            <div className="rounded bg-red-50 p-2 text-red-700 dark:bg-red-950/20 dark:text-red-300">
                              <span className="font-semibold">{t.workflow.ticket.returnReasonLabel}</span>{" "}<EntityTranslatedText entityType="INSPECTION_RESULT" entityId={r.id} field="returnReason" original={r.returnReason} />
                            </div>
                          )}
                          <div className="text-gray-400 text-xs">{r.createdAt ? new Date(r.createdAt).toLocaleString(locale) : ""}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Maintenance manager: select path only after inspection approval.
                  ⚠️ 2026-08-08: يعمل فقط للبلاغات أحادية البند (الأغلبية الساحقة) — بلاغ
                  متعدد البنود يستخدم الكتلة الجديدة أدناه (اعتماد كل بند على حدة). */}
              {canApproveWork && (!ticketItems || ticketItems.length <= 1) && (
                <div className="space-y-3 bg-green-50 dark:bg-green-950/20 rounded-xl p-4 border border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-green-600 dark:text-green-400 font-semibold text-sm">✅ {t.workflow.ticket.chooseExecutionPath}</span>
                  </div>
                  <Select value={selectedPath} onValueChange={(v: "A" | "B" | "C") => setSelectedPath(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t.workflow.ticket.chooseMaintenancePath} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">🔧 {t.workflow.ticket.pathA}</SelectItem>
                      <SelectItem value="B">🛒 {t.workflow.ticket.pathB}</SelectItem>
                      <SelectItem value="C">🚛 {t.workflow.ticket.pathC}</SelectItem>
                    </SelectContent>
                  </Select>
                  {selectedPath === "C" && (
                    <Textarea
                      placeholder={t.workflow.ticket.pathCJustificationPlaceholder}
                      value={pathJustification}
                      onChange={e => setPathJustification(e.target.value)}
                      rows={2}
                      className="text-sm"
                    />
                  )}
                  <Button
                    onClick={() => approveWorkMut.mutate({ id: ticket.id, maintenancePath: selectedPath, justification: pathJustification || undefined })}
                    disabled={approveWorkMut.isPending || (selectedPath === "C" && !pathJustification.trim())}
                    className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white"
                    size="lg"
                  >
                    {approveWorkMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {t.workflow.ticket.approveStartPath} ({selectedPath})
                  </Button>
                </div>
              )}

              {/* اعتماد مسار كل بند على حدة — الخطوة 3 من ميزة البلاغ متعدد الجهات
                  (2026-08-08). يظهر فقط للبلاغات متعددة البنود، ولكل مستخدم فقط البنود
                  التي يملك صلاحية إدارتها (نفس منطق canManageTicketItemWorkflow بالخادم؛
                  الخادم هو الحارس الحقيقي — هذا الفلتر بالواجهة تجميلي فقط). */}
              {!isTicketReadOnly && ticket?.status === "under_inspection" &&
                ticket?.inspectionWorkflowStatus === MAINTENANCE_INSPECTION_WORKFLOW_STATUS.APPROVED &&
                ticketItems && ticketItems.length > 1 &&
                ticketItems.filter((item: any) => {
                  if (externalRouteReviews.some(r => r.ticketItemId === item.id)) return false;
                  if (item.status !== "under_inspection") return false;
                  if (isAdminOrOwner || role === APP_ROLE.MAINTENANCE_MANAGER || role === APP_ROLE.SUPERVISOR) return true;
                  if (role === APP_ROLE.GENERAL_MAINTENANCE_MANAGER) {
                    return !item.responsibleDepartment || item.responsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL;
                  }
                  if (role === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER) {
                    return item.responsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION && item.responsibleManagerId === user?.id;
                  }
                  return false;
                }).map((item: any) => {
                  const sel = itemPathSelections[item.id] || { path: "A" as const, justification: "" };
                  return (
                    <div key={item.id} className="space-y-3 bg-green-50 dark:bg-green-950/20 rounded-xl p-4 border border-green-200 dark:border-green-800">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-green-600 dark:text-green-400 font-semibold text-sm">
                          ✅ {t.workflow.ticket.ticketItems} {item.itemNumber} — {t.workflow.ticket.chooseItemPath}
                        </span>
                      </div>
                      {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
                      <Select
                        value={sel.path}
                        onValueChange={(v: "A" | "B" | "C") =>
                          setItemPathSelections(prev => ({ ...prev, [item.id]: { ...sel, path: v } }))
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t.workflow.ticket.chooseMaintenancePath} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="A">🔧 {t.workflow.ticket.pathA}</SelectItem>
                          <SelectItem value="B">🛒 {t.workflow.ticket.pathB}</SelectItem>
                          <SelectItem value="C">🚛 {t.workflow.ticket.pathC}</SelectItem>
                        </SelectContent>
                      </Select>
                      {sel.path === "C" && (
                        <Textarea
                          placeholder={t.workflow.ticket.pathCJustificationPlaceholder}
                          value={sel.justification}
                          onChange={e => setItemPathSelections(prev => ({ ...prev, [item.id]: { ...sel, justification: e.target.value } }))}
                          rows={2}
                          className="text-sm"
                        />
                      )}
                      <Button
                        onClick={() => approveWorkForItemMut.mutate({
                          ticketItemId: item.id,
                          maintenancePath: sel.path,
                          justification: sel.justification || undefined,
                        })}
                        disabled={approveWorkForItemMut.isPending || (sel.path === "C" && !sel.justification.trim())}
                        className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white"
                        size="lg"
                      >
                        {approveWorkForItemMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        {t.workflow.ticket.approveItemClosure} {item.itemNumber} ({sel.path})
                      </Button>
                    </div>
                  );
                })}


              {/* Technician: Complete repair documentation (Path A) */}
              {canMarkReadyForClosure && (
                <div className="space-y-3 bg-purple-50 dark:bg-purple-950/20 rounded-xl p-4 border border-purple-200 dark:border-purple-800">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-purple-600 dark:text-purple-400 font-semibold text-sm">📝 {t.workflow.ticket.documentRepairPathA}</span>
                  </div>
                  <Textarea placeholder={t.workflow.ticket.repairNotesRequiredPlaceholder} value={repairNotes} onChange={e => setRepairNotes(e.target.value)} rows={2} className="text-sm" />
                  {afterPhotoUrl ? (
                    <div className="relative">
                      <img src={afterPhotoUrl} alt="after repair" className="rounded-lg max-h-40 object-cover border w-full" />
                      <Button variant="destructive" size="sm" className="absolute top-2 left-2" onClick={() => setAfterPhotoUrl("")}>{t.common.delete}</Button>
                    </div>
                  ) : (
                    <Button variant="outline" className="w-full h-20 border-dashed gap-2" onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file"; input.accept = "image/*";
                      input.onchange = (e: any) => { if (e.target.files[0]) handleUploadAfterPhoto(e.target.files[0]); };
                      input.click();
                    }} disabled={uploading}>
                      {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                      {uploading ? t.common.loading : t.workflow.ticket.uploadAfterRepairOptional}
                    </Button>
                  )}
                  <Button
                    onClick={() => markReadyMut.mutate({ id: ticket.id, afterPhotoUrl, repairNotes: repairNotes.trim() })}
                    disabled={markReadyMut.isPending || !isPathARepairEvidenceReady}
                    className="w-full gap-2 bg-purple-600 hover:bg-purple-700 text-white"
                    size="lg"
                  >
                    {markReadyMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {t.workflow.ticket.completeRepairSendClosure}
                  </Button>
                </div>
              )}

              {/* Technician: Complete Work with Parts (Path B) */}
              {canCompleteWithParts && (
                <div className="space-y-3 bg-indigo-50 dark:bg-indigo-950/20 rounded-xl p-4 border border-indigo-200 dark:border-indigo-800">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-indigo-600 dark:text-indigo-400 font-semibold text-sm">
                      {ticket?.maintenancePath === "C" ? `🔧 ${t.workflow.ticket.documentReinstallPathC}` : `🔧 ${t.workflow.ticket.completeAfterMaterialsPathB}`}
                    </span>
                  </div>
                  <Textarea placeholder={t.workflow.ticket.repairNotesRequiredPlaceholder} value={repairNotes} onChange={e => setRepairNotes(e.target.value)} rows={2} className="text-sm" />
                  {afterPhotoUrl ? (
                    <div className="relative">
                      <img src={afterPhotoUrl} alt="after repair" className="rounded-lg max-h-40 object-cover border w-full" />
                      <Button variant="destructive" size="sm" className="absolute top-2 left-2" onClick={() => setAfterPhotoUrl("")}>{t.common.delete}</Button>
                    </div>
                  ) : (
                    <Button variant="outline" className="w-full h-20 border-dashed gap-2" onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file"; input.accept = "image/*";
                      input.onchange = (e: any) => { if (e.target.files[0]) handleUploadAfterPhoto(e.target.files[0]); };
                      input.click();
                    }} disabled={uploading}>
                      {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                      {uploading ? t.common.loading : t.workflow.ticket.uploadAfterRepairOptional}
                    </Button>
                  )}
                  <Button
                    onClick={() => completeWithPartsMut.mutate({
                      id: ticket.id,
                      afterPhotoUrl: afterPhotoUrl.trim() || undefined,
                      repairNotes: repairNotes.trim(),
                    })}
                    disabled={
                      completeWithPartsMut.isPending ||
                      !isPathBRepairEvidenceReady
                    }
                    className="w-full gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
                    size="lg"
                  >
                    {completeWithPartsMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {ticket?.maintenancePath === "C" ? t.workflow.ticket.completeReinstallSendClosure : t.workflow.ticket.completeWorkSendClosure}
                  </Button>
                </div>
              )}

              {/* Supervisor: Final Closure (Path A) */}
              {canClosePathA && (
                <div className="space-y-2 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl p-4 border border-emerald-200 dark:border-emerald-800">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-sm">🔒 {t.workflow.ticket.finalClosurePathA}</span>
                  </div>
                  <Button onClick={() => closeBySupervisorMut.mutate({ id: ticket.id })} disabled={closeBySupervisorMut.isPending} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" size="lg">
                    {closeBySupervisorMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {t.workflow.ticket.closeTicketFinal}
                  </Button>
                </div>
              )}

              {/* Manager: Close Ticket (Path B & C) */}
              {canClosePathBC && (
                <div className="space-y-2 bg-teal-50 dark:bg-teal-950/20 rounded-xl p-4 border border-teal-200 dark:border-teal-800">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-teal-600 dark:text-teal-400 font-semibold text-sm">🔒 {t.workflow.ticket.finalClosurePath} {ticket?.maintenancePath || "B/C"}</span>
                  </div>
                  <Button onClick={() => closeMut.mutate({ id: ticket.id })} disabled={closeMut.isPending} className="w-full gap-2 bg-teal-600 hover:bg-teal-700 text-white" size="lg">
                    {closeMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {t.workflow.ticket.closeTicketFinal}
                  </Button>
                </div>
              )}

              {/* Gate Security: Approve Exit (Path C) */}
              {canApproveExit && (
                <div className="space-y-2 bg-orange-50 dark:bg-orange-950/20 rounded-xl p-4 border border-orange-200 dark:border-orange-800">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-orange-600 dark:text-orange-400 font-semibold text-sm">🚪 {t.workflow.ticket.approveGateExitTitle}</span>
                  </div>
                  <Button onClick={() => approveGateExitMut.mutate({ id: ticket.id })} disabled={approveGateExitMut.isPending} className="w-full gap-2 bg-orange-600 hover:bg-orange-700 text-white" size="lg">
                    {approveGateExitMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                    {t.workflow.ticket.approveGateExitWorkshop}
                  </Button>
                </div>
              )}

              {/* Gate Security: Approve Entry (Path C) */}
              {canApproveEntry && (
                <div className="space-y-2 bg-cyan-50 dark:bg-cyan-950/20 rounded-xl p-4 border border-cyan-200 dark:border-cyan-800">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-cyan-600 dark:text-cyan-400 font-semibold text-sm">🏠 {t.workflow.ticket.approveGateEntryTitle}</span>
                  </div>
                  <Button onClick={() => approveGateEntryMut.mutate({ id: ticket.id })} disabled={approveGateEntryMut.isPending} className="w-full gap-2 bg-cyan-600 hover:bg-cyan-700 text-white" size="lg">
                    {approveGateEntryMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {t.workflow.ticket.approveGateEntryAfterRepair}
                  </Button>
                </div>
              )}

              {/* Requester: Confirm Work Completion (after manager has closed the ticket) */}
              {canConfirmCompletion && (
                <div className="space-y-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl p-4 border border-emerald-200 dark:border-emerald-800">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-sm">✅ {t.tickets.confirmCompletionTitle}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{t.tickets.confirmCompletionDesc}</p>
                  <Textarea
                    placeholder={t.tickets.confirmCompletionNotePlaceholder}
                    value={confirmNote}
                    onChange={e => setConfirmNote(e.target.value)}
                    rows={3}
                    className="text-sm"
                  />
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">{t.tickets.confirmCompletionPhotos}</Label>
                    <DropZone
                      onFilesUploaded={setConfirmPhotos}
                      accept="image/*"
                      maxFiles={4}
                      disabled={confirmCompletionMut.isPending}
                      label={t.tickets.confirmCompletionPhotos}
                    />
                  </div>
                  <Button
                    onClick={() => confirmCompletionMut.mutate({
                      id: ticket.id,
                      note: confirmNote,
                      photoUrls: confirmPhotos.filter(f => f.status === "done" && f.url).map(f => f.url as string),
                    })}
                    disabled={
                      confirmCompletionMut.isPending ||
                      !confirmNote.trim() ||
                      confirmPhotos.filter(f => f.status === "done").length > 4
                    }
                    className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                    size="lg"
                  >
                    {confirmCompletionMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {t.tickets.confirmCompletionSubmit}
                  </Button>
                </div>
              )}

              {canCreatePO && (
                <div className="border-t pt-4">
                  <Button variant="default" onClick={() => setLocation(`/purchase-orders/new?ticketId=${ticket.id}`)} className="w-full gap-2 bg-teal-600 hover:bg-teal-700" size="lg">
                    <ShoppingCart className="w-4 h-4" /> {t.purchaseOrders.createNew}
                  </Button>
                </div>
              )}

              {!usesDirectItExecution && !canApprove && !canAssign && !canStartRepair && !canCompleteRepair && !canClose && !canCreatePO && !canTriage && !canInspect && !canClosePathA && !canApproveWork && !canClosePathBC && !canMarkReadyForClosure && !canApproveExit && !canApproveEntry && !canCompleteWithParts && !canConfirmCompletion && (
                <div className="text-center py-4 text-sm text-muted-foreground flex items-center justify-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {t.tickets.noTickets}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">{t.tickets.ticketTitle}</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">{t.tickets.reporter}:</span>
                <span className="font-medium">{reportedBy?.name || "-"}</span>
              </div>
              {ticket.maintenanceResponsibleDepartment && (
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">{t.workflow.ticket.responsibleDepartment}</span>
                  <span className="font-medium">
                    {ticket.maintenanceResponsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT ? t.workflow.ticket.departmentIt : ticket.maintenanceResponsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION ? t.workflow.ticket.departmentConstruction : t.workflow.ticket.departmentGeneral}
                  </span>
                </div>
              )}
              {ticket.maintenanceResponsibleManagerId && (
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">{t.workflow.ticket.currentResponsible}</span>
                  <span className="font-medium">{users?.find((u: any) => u.id === ticket.maintenanceResponsibleManagerId)?.name || "-"}</span>
                </div>
              )}
              {(ticket.assignedToId || ticket.assignedTechnicianId) && (
                <div className="flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">{t.tickets.assignedTo}:</span>
                  <span className="font-medium">{currentAssigneeName}</span>
                </div>
              )}
              {canPrintTaskDocument && (
                <button
                  type="button"
                  onClick={handlePrintTask}
                  disabled={printingTask}
                  className="mt-1 w-full flex items-center justify-center gap-2 border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {printingTask ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                  {t.workflow.ticket.printTask}
                </button>
              )}
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">{t.tickets.timeline}:</span>
                <span className="font-medium">{new Date(ticket.createdAt).toLocaleDateString(locale)}</span>
              </div>
              {ticket.closedAt && (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-muted-foreground">{t.tickets.closeTicket}:</span>
                  <span className="font-medium">{new Date(ticket.closedAt).toLocaleDateString(locale)}</span>
                </div>
              )}
              {linkedPOs.length > 0 && (
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-teal-600 shrink-0" />
                  <span className="text-muted-foreground">{t.purchaseOrders.title}:</span>
                  <span className="font-medium">{linkedPOs.length}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">{t.tickets.timeline}</CardTitle></CardHeader>
            <CardContent>
              {history?.length ? (
                <div className="space-y-3">
                  {history.map((h, i) => {
                    const changedBy = users?.find(u => u.id === h.changedById);
                    return (
                      <div key={h.id} className="flex gap-3 text-sm">
                        <div className="flex flex-col items-center">
                          <div className={`w-2.5 h-2.5 rounded-full mt-1.5 ${i === 0 ? "bg-primary" : "bg-muted-foreground/30"}`} />
                          {i < history.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                        </div>
                        <div className="pb-3">
                          <p className="font-medium">{getStatusLabel(h.toStatus)}</p>
                          <p className="text-xs text-muted-foreground">
                            {changedBy?.name || "-"} — {new Date(h.createdAt).toLocaleString(locale)}
                          </p>
                          {h.notes && (
                            <p className="text-xs text-muted-foreground mt-0.5 bg-muted/50 rounded p-1.5 whitespace-pre-wrap" dir="auto">
                              {historyTranslations[Number(h.id)]?.notes || localizeTicketTimelineSystemText(h.notes, language)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="text-sm text-muted-foreground">{t.common.noData}</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>

    {/* ===== LIGHTBOX DIALOG ===== */}
    <Dialog open={!!lightboxUrl} onOpenChange={(open) => { if (!open) setLightboxUrl(null); }}>
      <DialogContent className="max-w-3xl w-full p-2 bg-black/90 border-none shadow-2xl" style={{ borderRadius: "12px" }}>
        <button
          onClick={() => setLightboxUrl(null)}
          className="absolute top-3 right-3 z-50 bg-black/60 hover:bg-black/80 text-white rounded-full p-1.5 transition-colors"
          aria-label={t.workflow.ticket.closeLabel}
        >
          <X className="w-5 h-5" />
        </button>
        {lightboxUrl && (
          <img
            src={lightboxUrl}
            alt={t.workflow.ticket.imagePreview}
            className="w-full max-h-[80vh] object-contain rounded-lg"
          />
        )}
      </DialogContent>
    </Dialog>

    {/* ===== TRIAGE DIALOG ===== */}
      <Dialog open={showTriageDialog} onOpenChange={setShowTriageDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-amber-600" />
              {t.workflow.ticket.triageDialogTitle}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-lg">
              <p className="font-medium text-sm">{ticket?.ticketNumber}</p>
              <p className="text-sm text-muted-foreground">{ticket && getField("title")}</p>
            </div>

            {/* الهيكل الجديد إلزامي للبلاغات الجديدة: جهة واحدة أو أكثر ثم المهام. */}
            <div className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50/60 dark:bg-purple-950/20 p-3">
              <p className="text-sm font-medium">{t.workflow.ticket.multiTriageTitle}</p>
              <p className="text-xs text-muted-foreground mt-1">{t.workflow.ticket.multiTriageHelp}</p>
            </div>

            {triageMode === "single" && (
            <div className="space-y-2">
              <Label>{t.workflow.ticket.responsibleDepartmentRequired}</Label>
              <Select value={triageDepartment} onValueChange={(value) => {
                setTriageDepartment(value);
                setTriageAssignedTo("");
                setTriageResponsibleManagerId("");
              }}>
                <SelectTrigger><SelectValue placeholder={t.workflow.ticket.chooseResponsibleDepartment} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL}>{t.workflow.ticket.departmentGeneral}</SelectItem>
                  <SelectItem value={MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION}>{t.workflow.ticket.departmentConstruction}</SelectItem>
                  <SelectItem value={MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT}>{t.workflow.ticket.departmentIt}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            )}
            {triageMode === "single" && selectedDepartmentManagers.length > 1 && (
              <div className="space-y-2">
                <Label>{t.workflow.ticket.receivingManagerRequired}</Label>
                <Select value={triageResponsibleManagerId} onValueChange={setTriageResponsibleManagerId}>
                  <SelectTrigger><SelectValue placeholder={t.workflow.ticket.chooseManager} /></SelectTrigger>
                  <SelectContent>
                    {selectedDepartmentManagers.map((manager: any) => (
                      <SelectItem key={manager.id} value={String(manager.id)}>{manager.name || manager.username}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {triageMode === "single" && triageDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL && (
              <div className="space-y-2">
                <Label>{t.workflow.ticket.assignTechnicianRequired} <span className="text-muted-foreground text-xs">({t.workflow.ticket.required})</span></Label>
                <TechnicianCombobox
                  value={triageAssignedTo}
                  onValueChange={setTriageAssignedTo}
                  placeholder={t.workflow.ticket.chooseInspectionTechnician}
                  options={technicians.map(tech => ({
                    value: tech.id.toString(),
                    label: tech.name || tech.email,
                  }))}
                />
              </div>
            )}

            {/* الفرز المتعدد: الجهة والمسؤول فقط؛ المهام والفنيون لاحقًا. */}
            {triageMode === "multi" && (
              <div className="space-y-3 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20 p-3">
                <p className="text-xs text-muted-foreground">
                  {t.workflow.ticket.triageDepartmentsHelp}
                </p>
                {[
                  { key: MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL, label: t.workflow.ticket.departmentGeneral, mgrs: generalManagers },
                  { key: MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION, label: t.workflow.ticket.departmentConstruction, mgrs: constructionManagers },
                  { key: MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT, label: t.workflow.ticket.departmentIt, mgrs: itManagers },
                ]
                  // ⚠️ 2026-08-13: مدير الإنشاءات والمشتريات يصنّف بلاغه الشخصي فقط (راجع
                  // canRouteTicket أعلاه)، فلا معنى لعرض خيار توجيهه لجهة ليست جهته. يبقى
                  // "قسم الإنشاءات" وحده ظاهرًا له؛ بقية سير العمل (المهام، الفنيون، الإغلاق)
                  // يستمر بنفس آلية الفرز المتعدد المستخدَمة مع مدير الصيانة العامة حرفيًا —
                  // لا تعديل عليها. بقية الأدوار (مدير الصيانة العامة/الأدمن/المالك) تبقى ترى
                  // الخيارين معًا كما كانت. راجع docs/CONSTRUCTION_MANAGER_OWN_TICKET_TRIAGE.md.
                  .filter(({ key }) =>
                    role !== APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER ||
                    key === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION
                  )
                  .map(({ key, label, mgrs }) => {
                  const a = multiAssignments[key] || { selected: false, managerId: "", organizationalTitle: "" };
                  return (
                    <div key={key} className="rounded-md border bg-background p-3 space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={a.selected} onChange={(e) => updateAssignment(key, { selected: e.target.checked })} className="w-4 h-4 accent-purple-600" />
                        <span className="text-sm font-medium">{label}</span>
                      </label>
                      {a.selected && (
                        <div className="space-y-2 pt-1">
                          {mgrs.length > 1 ? (
                            <>
                              <Label className="text-xs">{t.workflow.ticket.departmentManagerRequired}</Label>
                              <Select value={a.managerId} onValueChange={(v) => updateAssignment(key, { managerId: v })}>
                                <SelectTrigger><SelectValue placeholder={t.workflow.ticket.chooseManager} /></SelectTrigger>
                                <SelectContent>{mgrs.map((m: any) => <SelectItem key={m.id} value={String(m.id)}>{m.name || m.username}</SelectItem>)}</SelectContent>
                              </Select>
                            </>
                          ) : mgrs.length === 1 ? (
                            <p className="text-xs text-muted-foreground">{t.workflow.ticket.departmentManager}: {mgrs[0].name || mgrs[0].username}</p>
                          ) : null}
                          {key === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION && (
                            <div className="space-y-1">
                              <Label className="text-xs">{t.workflow.ticket.constructionTitleRequired}</Label>
                              <Input
                                value={a.organizationalTitle}
                                maxLength={300}
                                onChange={(e) => updateAssignment(key, { organizationalTitle: e.target.value })}
                                placeholder={t.workflow.ticket.constructionTitlePlaceholder}
                              />
                              <p className="text-[11px] text-muted-foreground">{t.workflow.ticket.constructionTitleHelp}</p>
                            </div>
                          )}
                          <p className="text-[11px] text-muted-foreground">{t.workflow.ticket.tasksAssignedLater}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {triageMode === "single" && (
            <p className="text-xs text-muted-foreground">
              {triageDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION
                ? t.workflow.ticket.constructionRoutingHint
                : t.workflow.ticket.generalRoutingHint}
            </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTriageDialog(false)}>{t.workflow.ticket.cancel}</Button>
            <Button
              onClick={() => {
                if (triageMode === "multi") {
                  const selected = Object.entries(multiAssignments).filter(([, v]) => v?.selected);
                  if (selected.length === 0) { toast.error(t.workflow.ticket.chooseOneDepartment); return; }
                  for (const [dept, v] of selected) {
                    const mgrs = dept === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT ? itManagers : dept === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION ? constructionManagers : generalManagers;
                    if (mgrs.length === 0) { toast.error(t.workflow.ticket.noActiveDepartmentManager); return; }
                    if (mgrs.length > 1 && !v.managerId) { toast.error(t.workflow.ticket.chooseEveryDepartmentManager); return; }
                    if (dept === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION && !v.organizationalTitle.trim()) { toast.error(t.workflow.ticket.constructionTitleValidation); return; }
                  }
                  triageMultiMut.mutate({
                    id: ticket!.id,
                    assignments: selected.map(([dept, v]) => {
                      const mgrs = dept === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT ? itManagers : dept === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION ? constructionManagers : generalManagers;
                      return {
                        department: dept as any,
                        responsibleManagerId: v.managerId ? parseInt(v.managerId) : (mgrs.length === 1 ? mgrs[0].id : undefined),
                        organizationalTitle: dept === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION ? v.organizationalTitle.trim() : undefined,
                      };
                    }),
                  });
                  setShowTriageDialog(false);
                  return;
                }
                const assignedToId = triageDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL && triageAssignedTo
                  ? parseInt(triageAssignedTo)
                  : undefined;
                const autoManagerId = selectedDepartmentManagers.length === 1 ? selectedDepartmentManagers[0].id : undefined;
                if (triageDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT) {
                  triageMultiMut.mutate({ id: ticketId, assignments: [{ department: MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT }] });
                  return;
                }
                triageMut.mutate({
                  id: ticket!.id,
                  assignedToId,
                  maintenanceResponsibleDepartment: triageDepartment as any,
                  maintenanceResponsibleManagerId: triageResponsibleManagerId ? parseInt(triageResponsibleManagerId) : autoManagerId,
                });
                setShowTriageDialog(false);
              }}
              disabled={
                triageMode === "multi"
                  ? (triageMultiMut.isPending || Object.values(multiAssignments).filter((v: any) => v?.selected).length === 0)
                  : (
                    triageMut.isPending ||
                    !triageDepartment ||
                    (selectedDepartmentManagers.length === 0) ||
                    (selectedDepartmentManagers.length > 1 && !triageResponsibleManagerId) ||
                    (triageDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL && !triageAssignedTo)
                  )
              }
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {(triageMode === "multi" ? triageMultiMut.isPending : triageMut.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {triageMode === "multi" ? t.workflow.ticket.confirmMultiTriage : t.workflow.ticket.confirmTriage}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تعديل البلاغ — متاح فقط طالما لم يُصنَّف بعد (pending_triage) */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5" /> {t.common.edit} — {ticket?.ticketNumber}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t.tickets.ticketTitle}</Label>
              <Textarea value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>{t.tickets.description}</Label>
              <Textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} rows={4} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.tickets.priority}</Label>
                <Select value={editForm.priority} onValueChange={v => setEditForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(t.priority).map(k => <SelectItem key={k} value={k}>{getPriorityLabel(k)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t.tickets.category}</Label>
                <Select value={editForm.categoryId || "__legacy__"} onValueChange={v => setEditForm(f => ({ ...f, categoryId: v === "__legacy__" ? "" : v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {!ticket?.categoryId && <SelectItem value="__legacy__">{ticket?.centerCategoryName || getCategoryLabel(ticket?.category || "general")} (تاريخي)</SelectItem>}
                    {(centerCategories as any[]).filter((category: any) => category.isActive || Number(category.id) === Number(ticket?.categoryId)).map((category: any) => (
                      <SelectItem key={category.id} value={String(category.id)}>{category.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t.tickets.location}</Label>
              <Textarea value={editForm.locationDetail} onChange={e => setEditForm(f => ({ ...f, locationDetail: e.target.value }))} rows={1} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>{t.common.cancel}</Button>
            <Button
              onClick={() => {
                if (!ticket) return;
                updateTicketMut.mutate({
                  id: ticket.id,
                  title: editForm.title,
                  description: editForm.description,
                  priority: editForm.priority,
                  categoryId: editForm.categoryId ? Number(editForm.categoryId) : undefined,
                  locationDetail: editForm.locationDetail,
                });
              }}
              disabled={updateTicketMut.isPending || !editForm.title.trim()}
            >
              {updateTicketMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}
