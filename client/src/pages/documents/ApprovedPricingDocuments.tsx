import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Eye, Printer, FileStack, Download } from "lucide-react";
import { toast } from "sonner";
import { APPROVED_PRICING_DOCUMENT_TITLE } from "@shared/approved-pricing-documents";
import { downloadPricingBundlePdf } from "@/lib/downloadPricingBundlePdf";
import DocumentFilters from "@/components/documents/DocumentFilters";

export default function ApprovedPricingDocuments({embedded=false}: {embedded?:boolean}) {
  const [search, setSearch] = useState(""), [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1), [busy, setBusy] = useState<number | null>(null);
  const [dateFrom,setDateFrom]=useState(""),[dateTo,setDateTo]=useState(""),[sort,setSort]=useState<"newest"|"oldest">("newest");
  useEffect(() => { const timer = setTimeout(() => { setDebounced(search); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
  const query = trpc.approvedPricingDocuments.listPage.useQuery({page,pageSize:20,search:debounced,sort,dateFrom:dateFrom||undefined,dateTo:dateTo||undefined}, {retry:false});
  const pdf = trpc.approvedPricingDocuments.pdf.useMutation();
  const download = async (id: number) => {
    setBusy(id);
    try { downloadPricingBundlePdf(await pdf.mutateAsync({id})); }
    catch (error: any) { toast.error(error.message || "تعذر تنزيل الوثيقة"); }
    finally { setBusy(null); }
  };
  const open = async (id: number) => {
    // Reserve a window during the click so popup blocking does not lose the PDF.
    const preview = window.open("", "_blank");
    if (!preview) { toast.error("اسمح بفتح النوافذ لعرض الوثيقة وطباعتها"); return; }
    preview.opener = null;
    setBusy(id);
    try {
      const file = await pdf.mutateAsync({id});
      const bytes = Uint8Array.from(atob(file.content), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], {type:"application/pdf"}));
      preview.location.replace(url);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error: any) { preview.close(); toast.error(error.message || "تعذر فتح الوثيقة"); }
    finally { setBusy(null); }
  };
  return <div className="space-y-5" dir="rtl">
    {!embedded&&<h1 className="text-2xl font-bold flex items-center gap-2"><FileStack className="w-6 h-6" />{APPROVED_PRICING_DOCUMENT_TITLE}</h1>}
    <DocumentFilters values={{search,dateFrom,dateTo,sort}} onChange={value=>{setSearch(value.search);setDateFrom(value.dateFrom);setDateTo(value.dateTo);setSort(value.sort);setPage(1);}} onRefresh={()=>query.refetch()} refreshing={query.isFetching} placeholder="ابحث برقم الحزمة أو المندوب..." />
    {!query.error&&!query.isLoading&&<p className="text-sm text-muted-foreground" role="status">{query.data?.total||0} مستند مطابق</p>}
    {query.error ? <p role="alert">{query.error.message}</p> : query.isLoading ? <p role="status">جارٍ تحميل الوثائق…</p> : <Card><CardContent className="pt-5 overflow-x-auto">
      <Table><TableHeader><TableRow><TableHead className="text-start">رقم الحزمة</TableHead><TableHead className="text-start">المندوب</TableHead><TableHead className="text-start">تاريخ الاعتماد</TableHead><TableHead className="text-start">الإجمالي المعتمد</TableHead><TableHead className="text-start">الإجراءات</TableHead></TableRow></TableHeader>
        <TableBody>{query.data?.rows.map(row => <TableRow key={row.id}>
          <TableCell className="font-mono">{row.bundleNumber}</TableCell><TableCell>{row.delegateName}</TableCell><TableCell>{row.approvedAt ? new Date(row.approvedAt).toLocaleDateString("ar-SA") : "—"}</TableCell><TableCell>{row.total.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})} ر.س</TableCell>
          <TableCell><div className="flex flex-col items-start gap-2 sm:flex-row"><Button variant="outline" size="sm" disabled={busy !== null} onClick={() => open(row.id)}><Eye className="w-4 h-4 me-1" />استعراض</Button><Button variant="outline" size="sm" disabled={busy !== null} onClick={() => download(row.id)}><Download className="w-4 h-4 me-1" />تنزيل PDF</Button><Button variant="outline" size="sm" disabled={busy !== null} onClick={() => open(row.id)}><Printer className="w-4 h-4 me-1" />طباعة</Button></div></TableCell>
        </TableRow>)}{!query.data?.rows.length && <TableRow><TableCell colSpan={5}>لا توجد حزم تسعير معتمدة.</TableCell></TableRow>}</TableBody>
      </Table>
      <div className="flex items-center justify-between mt-4"><Button variant="outline" disabled={!query.data || query.data.page<=1 || query.isFetching} onClick={() => setPage((query.data?.page || 1)-1)}>السابق</Button><span>صفحة {query.data?.page || 1} — {query.data?.total || 0} وثيقة</span><Button variant="outline" disabled={!query.data || query.data.page*20>=query.data.total || query.isFetching} onClick={() => setPage((query.data?.page || 1)+1)}>التالي</Button></div>
    </CardContent></Card>}
  </div>;
}
