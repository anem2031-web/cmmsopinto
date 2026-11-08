import React, { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { SupplyWaitExplanation, SupplyWaitProvider } from "../../client/src/components/purchase/SupplyWaitExplanation";
import { preview } from "./preview-mocks";

function App() {
  const [, render] = React.useReducer(value => value + 1, 0);
  const change = (work: () => void) => { work(); preview.tick(); render(); };
  return <main dir="rtl" className="mx-auto max-w-4xl space-y-6 p-6">
    <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">معاينة اختبار معزولة — لا اتصال بقاعدة البيانات</div>
    <div className="flex flex-wrap gap-3"><label>حساب المعاينة <select aria-label="حساب المعاينة" className="rounded border p-2" value={preview.state.role} onChange={event => change(() => { preview.state.role = event.target.value; })}>
      <option value="delegate">المندوب</option><option value="delegate_manager">مسئول المناديب</option><option value="warehouse">منشئ الطلب</option><option value="senior_management">المراجع الفعلي</option><option value="admin">الأدمن</option>
    </select></label><button className="rounded border bg-white px-3" onClick={() => change(() => { preview.state.offset += 7200001; })}>تقديم الوقت ساعتين</button><button className="rounded border bg-white px-3" onClick={() => change(() => { preview.state.offset = 0; preview.state.note = null; })}>إعادة المعاينة</button></div>
    <SupplyWaitProvider items={[{ id: 1, purchaseOrderId: 100 }]}><article className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3"><h1 className="text-xl font-bold">لوح ألمنيوم — عينة للمعاينة</h1><span className="rounded bg-blue-100 px-3 py-1 text-sm text-blue-900">بانتظار الشراء</span></div>
      <p className="mt-2 text-sm text-gray-500">PR-DEMO-100 · الكمية: 4 قطعة · لا تُسجّل عملية شراء في هذه المعاينة</p>
      <SupplyWaitExplanation itemId={1} purchaseOrderId={100} />
    </article></SupplyWaitProvider>
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
