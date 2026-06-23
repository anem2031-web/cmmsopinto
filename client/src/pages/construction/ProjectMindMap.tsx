import { useState, useCallback, useRef } from "react";
import ReactFlow, {
  Node, Edge, addEdge, Connection, useNodesState, useEdgesState,
  Controls, Background, BackgroundVariant, Panel, MiniMap,
  Handle, Position, NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Download, GitFork, Lightbulb } from "lucide-react";
import { toast } from "sonner";

// ── Custom Node ──────────────────────────────────────────────
function MindMapNode({ data, selected }: NodeProps) {
  const colorMap: Record<string, string> = {
    project: "#1A2B4A",
    phase:   "#0D9488",
    activity:"#E07B39",
    task:    "#16A34A",
    idea:    "#7C3AED",
  };
  const bg = colorMap[data.type] ?? "#1A2B4A";

  return (
    <div
      className={`px-4 py-2.5 rounded-xl shadow-md border-2 min-w-32 text-center cursor-pointer transition-all ${
        selected ? "border-[#E07B39] shadow-lg" : "border-transparent"
      }`}
      style={{ backgroundColor: bg }}
    >
      <Handle type="target" position={Position.Left} className="!bg-white/40 !border-white/60 !w-2 !h-2" />
      <p className="text-white font-semibold text-sm leading-snug">{data.label}</p>
      {data.type && data.type !== "project" && (
        <p className="text-white/60 text-xs mt-0.5">{
          data.type === "phase" ? "مرحلة" :
          data.type === "activity" ? "نشاط" :
          data.type === "task" ? "مهمة" : "فكرة"
        }</p>
      )}
      <Handle type="source" position={Position.Right} className="!bg-white/40 !border-white/60 !w-2 !h-2" />
    </div>
  );
}

const nodeTypes = { mindmap: MindMapNode };

let nodeIdCounter = 100;
const genId = () => `node_${++nodeIdCounter}`;

interface Props {
  projectId: number;
  projectName?: string;
}

export default function ProjectMindMap({ projectId, projectName }: Props) {
  const utils = trpc.useUtils();

  // Initialize with project root node
  const [nodes, setNodes, onNodesChange] = useNodesState([
    {
      id: "root",
      type: "mindmap",
      position: { x: 300, y: 200 },
      data: { label: projectName ?? `المشروع #${projectId}`, type: "project" },
    } as Node,
  ]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<"phase" | "activity" | "task" | "idea">("phase");

  const createTask = trpc.construction.tasks.create.useMutation({
    onSuccess: () => {
      utils.construction.tasks.kanban.invalidate({ projectId });
      toast.success("تم إنشاء المهمة من العقدة");
    },
    onError: err => toast.error(err.message),
  });

  const onConnect = useCallback(
    (params: Connection) => setEdges(eds => addEdge({ ...params, animated: false, style: { stroke: "#94A3B8", strokeWidth: 2 } }, eds)),
    [setEdges]
  );

  const addNode = () => {
    if (!newLabel.trim()) { toast.error("أدخل اسم العقدة"); return; }
    const parent = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : nodes[0];
    const id = genId();
    const newNode: Node = {
      id,
      type: "mindmap",
      position: {
        x: (parent?.position.x ?? 300) + 200,
        y: (parent?.position.y ?? 200) + (Math.random() - 0.5) * 160,
      },
      data: { label: newLabel.trim(), type: newType },
    };
    setNodes(nds => [...nds, newNode]);
    if (parent) {
      setEdges(eds => [...eds, {
        id: `e_${parent.id}_${id}`,
        source: parent.id,
        target: id,
        animated: false,
        style: { stroke: "#94A3B8", strokeWidth: 1.5 },
      }]);
    }
    setNewLabel("");
    toast.success("تمت إضافة العقدة");
  };

  const deleteSelected = () => {
    if (!selectedNodeId || selectedNodeId === "root") {
      toast.error("لا يمكن حذف العقدة الرئيسية");
      return;
    }
    setNodes(nds => nds.filter(n => n.id !== selectedNodeId));
    setEdges(eds => eds.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
  };

  const convertToTask = async () => {
    const node = nodes.find(n => n.id === selectedNodeId);
    if (!node) { toast.error("اختر عقدة أولاً"); return; }

    // We need activityId and phaseId — get first available
    // In a real scenario, user would pick them; here we use a simplified flow
    toast.info("يرجى إضافة المهمة من صفحة Kanban واختيار المرحلة والنشاط المناسبين");
  };

  const exportPng = () => {
    toast.info("لتصدير الخريطة كصورة، استخدم مفتاح Print Screen أو أداة التصوير في نظامك");
  };

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex gap-2 flex-1 min-w-48">
          <Input
            placeholder="اسم العقدة الجديدة..."
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            className="text-right flex-1"
            onKeyDown={e => e.key === "Enter" && addNode()}
          />
          <select
            value={newType}
            onChange={e => setNewType(e.target.value as any)}
            className="border border-slate-200 rounded-lg px-2 text-sm text-slate-700 bg-white"
          >
            <option value="phase">مرحلة</option>
            <option value="activity">نشاط</option>
            <option value="task">مهمة</option>
            <option value="idea">فكرة</option>
          </select>
        </div>
        <Button size="sm" onClick={addNode} className="bg-[#1A2B4A] text-white gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          إضافة عقدة
        </Button>
        {selectedNodeId && selectedNodeId !== "root" && (
          <>
            <Button size="sm" variant="outline" onClick={deleteSelected}
              className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" /> حذف
            </Button>
            <Button size="sm" variant="outline" onClick={convertToTask}
              className="gap-1.5 text-[#16A34A] border-green-200 hover:bg-green-50">
              <GitFork className="w-3.5 h-3.5" /> تحويل لمهمة
            </Button>
          </>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-slate-500">
        {[
          { color: "#1A2B4A", label: "مشروع" },
          { color: "#0D9488", label: "مرحلة" },
          { color: "#E07B39", label: "نشاط" },
          { color: "#16A34A", label: "مهمة" },
          { color: "#7C3AED", label: "فكرة" },
        ].map(item => (
          <span key={item.label} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>

      {/* ReactFlow Canvas */}
      <div
        className="w-full rounded-xl border border-slate-200 overflow-hidden shadow-sm"
        style={{ height: "calc(100vh - 340px)", minHeight: "450px" }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.3}
          maxZoom={2}
        >
          <Controls position="bottom-left" />
          <MiniMap
            nodeColor={node => {
              const colorMap: Record<string, string> = {
                project: "#1A2B4A", phase: "#0D9488", activity: "#E07B39",
                task: "#16A34A", idea: "#7C3AED",
              };
              return colorMap[node.data?.type] ?? "#94A3B8";
            }}
            className="!rounded-lg !border !border-slate-200"
          />
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#E2E8F0" />

          <Panel position="top-right">
            <div className="bg-white rounded-lg border border-slate-200 p-2 text-xs text-slate-500 max-w-48">
              <p className="font-medium text-slate-700 mb-1 flex items-center gap-1">
                <Lightbulb className="w-3 h-3 text-[#E07B39]" /> نصيحة
              </p>
              اضغط على عقدة لتحديدها، ثم أضف عقدة جديدة كفرع منها. اسحب بين العقد لإنشاء روابط.
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}
