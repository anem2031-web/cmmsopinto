import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, SlidersHorizontal, RefreshCw } from "lucide-react";

export type DocumentFilterValues = {search:string;dateFrom:string;dateTo:string;sort:"newest"|"oldest";delegateId?:string};
type Props = {
  values:DocumentFilterValues; onChange:(values:DocumentFilterValues)=>void; onRefresh:()=>void;
  refreshing?:boolean; placeholder?:string; delegates?:Array<[string,string]>; delegateVisible?:boolean;
};
export default function DocumentFilters({values,onChange,onRefresh,refreshing,placeholder="ابحث برقم المستند أو المرجع...",delegates,delegateVisible=false}:Props) {
  const [expanded,setExpanded]=useState(false);
  const active=!!(values.dateFrom||values.dateTo||values.sort!=="newest"||values.delegateId&&values.delegateId!=="all");
  const delegateControl=(delegateVisible||!!delegates?.length)&&<div className="space-y-1"><span className="text-xs">{delegateVisible?"حسب المندوب":"المندوب"}</span><Select value={values.delegateId||"all"} onValueChange={delegateId=>onChange({...values,delegateId})}><SelectTrigger aria-label="المندوب" className="w-[180px]"><SelectValue placeholder="كل المندوبين" /></SelectTrigger><SelectContent><SelectItem value="all">كل المندوبين</SelectItem>{delegates?.map(([id,name])=><SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent></Select></div>;
  return <div className="space-y-3">
    <div className="flex gap-2 flex-wrap items-end">
      <div className="relative flex-1 min-w-[200px] max-w-xl"><Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input aria-label="البحث في المستندات" placeholder={placeholder} value={values.search} onChange={event=>onChange({...values,search:event.target.value})} className="pr-10" /></div>
      {delegateVisible&&delegateControl}
      <Button variant={active?"secondary":"outline"} aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><SlidersHorizontal className="w-4 h-4 me-1" />تصفية{active?" •":""}</Button>
      <Button variant="outline" disabled={refreshing} onClick={onRefresh}><RefreshCw className={`w-4 h-4 me-1 ${refreshing?"animate-spin":""}`} />تحديث</Button>
    </div>
    {expanded&&<div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3">
      <label className="flex flex-col gap-1 text-xs">من تاريخ<Input type="date" value={values.dateFrom} max={values.dateTo||undefined} onChange={event=>onChange({...values,dateFrom:event.target.value})} className="w-[150px]" /></label>
      <label className="flex flex-col gap-1 text-xs">إلى تاريخ<Input type="date" value={values.dateTo} min={values.dateFrom||undefined} onChange={event=>onChange({...values,dateTo:event.target.value})} className="w-[150px]" /></label>
      {!delegateVisible&&delegateControl}
      <div className="space-y-1"><span className="text-xs">الترتيب</span><Select value={values.sort} onValueChange={sort=>onChange({...values,sort:sort as "newest"|"oldest"})}><SelectTrigger aria-label="الترتيب" className="w-[160px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="newest">الأحدث أولًا</SelectItem><SelectItem value="oldest">الأقدم أولًا</SelectItem></SelectContent></Select></div>
      <Button variant="ghost" size="sm" onClick={()=>onChange({search:"",dateFrom:"",dateTo:"",sort:"newest",delegateId:"all"})}>مسح الفلاتر</Button>
    </div>}
  </div>;
}
