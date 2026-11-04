import { isDelegateRole } from "./delegate-role";
export const EXTERNAL_DELEGATE_QUERY = "externalMaintenance.listForDelegate";
export const EXTERNAL_DELEGATE_MUTATION = "externalMaintenance.decideDelegateReceipt";
export const EXTERNAL_DELEGATE_PREPURCHASE_STATUSES = ["waiting_delegate_receipt", "waiting_gate_exit", "waiting_warehouse_preparation"] as const;

/** These two capabilities use the real assigned delegate, with no role projection. */
export function externalDelegateRpcAllowed(user: {id:number;role:string;isActive?:number}|null|undefined,type:string,path:string):boolean {
  if(path!==EXTERNAL_DELEGATE_QUERY && path!==EXTERNAL_DELEGATE_MUTATION) return true;
  return !!user && isDelegateRole(user.role) && user.isActive===1 && Number.isSafeInteger(user.id) && user.id>0
    && ((path===EXTERNAL_DELEGATE_QUERY && type==="query") || (path===EXTERNAL_DELEGATE_MUTATION && type==="mutation"));
}
