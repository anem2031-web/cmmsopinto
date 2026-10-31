import "dotenv/config";
import { createTRPCProxyClient, httpLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../server/routers";
import { createInterface } from "node:readline";
import {mkdir,writeFile,readFile} from "node:fs/promises";

if (new URL(process.env.DATABASE_URL || "").pathname.slice(1).toLowerCase() !== "copycmms2") throw Error("COPYCMMS2 only");
const line = await new Promise<string>(resolve => {
  const input = createInterface({input:process.stdin});
  input.once("line", value => { input.close(); resolve(value); });
});
const credentials = JSON.parse(line) as {username:string;password:string};
let cookie = "";
const client = createTRPCProxyClient<AppRouter>({ links: [httpLink({
  url: "http://localhost:4002/api/trpc", transformer: superjson,
  fetch: async (url, options) => {
    if (!String(url).startsWith("http://localhost:4002/api/trpc")) throw Error("Trial URL only");
    const response = await fetch(url, {...options, headers:{...options?.headers, ...(cookie ? {cookie} : {})}});
    const values = response.headers.getSetCookie();
    if (values.length) cookie = values.map(value => value.split(";")[0]).join("; ");
    return response;
  },
})] });
try {
  await client.auth.login.mutate(credentials);
  credentials.password = "";
  const action = process.argv[2] || "inspect";
  const rpc = {
    query: (path: string, input?: unknown) => path.split(".").reduce((value: any, key) => value[key], client as any).query(input),
    mutate: (path: string, input?: unknown) => path.split(".").reduce((value: any, key) => value[key], client as any).mutate(input),
  };
  const evidence = "docs/runtime-uat/2026-10-30-compensation";
  const checkpoint = async (stage:string, value:unknown) => {
    await mkdir(evidence,{recursive:true});
    await writeFile(`${evidence}/${stage}.json`,JSON.stringify(value,null,2));
    console.log(JSON.stringify({stage,ids:value}));
  };
  const assertTrial = async () => {
    if (new URL(process.env.DATABASE_URL || "").pathname.slice(1).toLowerCase() !== "copycmms2") throw Error("Trial changed");
  };
  if (action === "inspect") {
    const [first,second] = await Promise.all([client.operationalIssues.detail.query({id:1}),client.operationalIssues.detail.query({id:2})]);
    const available = await client.operationalIssues.availability.query({id:1});
    console.log(JSON.stringify({first,second,available},null,2));
  } else if (action === "team-review") {
    const source=JSON.parse(await readFile(`${evidence}/team-source.json`,"utf8"));
    const current=await rpc.query("ticketTeamExecution.details",{assignmentId:source.assignmentId,language:"ar"});
    if(current.assignments[0].stage==="awaiting_review") await rpc.mutate("ticketTeamExecution.review",{assignmentId:source.assignmentId,
      expectedRevision:current.assignments[0].revision,operationKey:"uat-team-review:30001",decision:"approve_result",note:"UAT COPYCMMS2 — اعتماد نتيجة اختبار البديل واستخدام5 وإرجاع1"});
    const after=await rpc.query("ticketTeamExecution.details",{assignmentId:source.assignmentId,language:"ar"});
    await checkpoint("team-reviewed",{assignment:after.assignments[0],needs:after.needs,deliveries:after.deliveries,returns:after.returns});
  } else if (action === "trial-cleanup") {
    for(const file of ["pmv2-source-state","pmv2-source-state-b"]) {
      const fixture=JSON.parse(await readFile(`${evidence}/${file}.json`,"utf8"));
      const current=await rpc.query("pmv2.programs.get",{id:fixture.programId});
      if(current.program?.title!==fixture.label||!fixture.label.startsWith("TEST-SUPPLIER-RETURN-PMV2-"))throw Error("Cleanup scope mismatch");
      if(current.program.isActive)await rpc.mutate("pmv2.programs.update",{id:fixture.programId,isActive:false});
    }
    await checkpoint("trial-programs-deactivated",{programIds:[60001,60002],reason:"Acceptance complete; preserve history and stop future generation"});
  } else if (action === "team-complete") {
    const {completeTeamCompensationNeed}=await import("./team-compensation-api");
    const source=JSON.parse(await readFile(`${evidence}/team-source.json`,"utf8"));
    let resume;try{resume=JSON.parse(await readFile(`${evidence}/team-completion-state.json`,"utf8"));}catch{}
    const result=await completeTeamCompensationNeed(rpc,source,assertTrial,true,{resume,checkpoint:async(stage,value)=>{
      await checkpoint("team-completion-state",value);console.log(JSON.stringify({phase:stage}));
    }});
    await checkpoint("team-completed",result);
  } else if (action === "pmv2-complete") {
    const {completePmv2CompensationNeed}=await import("../supplier-return-followup/pmv2-complete-need.mjs");
    const source=JSON.parse(await readFile(`${evidence}/pmv2-source-b.json`,"utf8"));
    let resume;try{resume=JSON.parse(await readFile(`${evidence}/pmv2-completion-state.json`,"utf8"));}catch{}
    const result=await completePmv2CompensationNeed(rpc,source,{databaseName:"copycmms2",baseUrl:"http://localhost:4002",resume,
      expectedReplacementCatalogItemId:180302,expectedPhysicalQuantity:6,usedPhysicalQuantity:5,
      checkpoint:async(value:any)=>{await mkdir(evidence,{recursive:true});await writeFile(`${evidence}/pmv2-completion-state.json`,JSON.stringify(value,null,2));console.log(JSON.stringify({phase:value.stage}));}});
    await checkpoint("pmv2-completed",result.result);
  } else if (action.startsWith("source-return-")) {
    console.log(JSON.stringify(await (await import("./source-returns-api")).sourceReturnAction(rpc,action),null,2));
  } else if (action.startsWith("source-purchase-") || action.startsWith("replacement-purchase-")) {
    const {processTrialPurchaseOrders}=await import("./operational-compensation-api");
    const team=JSON.parse(await readFile(`${evidence}/team-source.json`,"utf8")),pm=JSON.parse(await readFile(`${evidence}/pmv2-source-b.json`,"utf8"));
    const shared=JSON.parse(await readFile(`${evidence}/operational-api-state.json`,"utf8"));
    const replacement=action.startsWith("replacement-purchase-"), prefix=replacement?"replacement-purchase-":"source-purchase-";
    const ids=replacement?JSON.parse(await readFile(`${evidence}/source-return-state.json`,"utf8")).entries.map((entry:any)=>entry.replacementOrderId):[team.purchaseOrderId,pm.purchaseOrderId];
    console.log(JSON.stringify(await processTrialPurchaseOrders(rpc,action.slice(prefix.length) as any,
      {purchaseOrderIds:ids,delegateId:shared.delegateId,warehouseId:1,pricePerUnit:1,
        photos:shared.photos,supplier:shared.supplier,runId:replacement?"UAT-ALTERNATIVES-20261030":"UAT-SOURCES-20261030"}),null,2));
  } else if (action === "pmv2-source" || action === "pmv2-source-clean") {
    const {createPmv2SourceFixture} = await import("../supplier-return-followup/pmv2-source-fixture.mjs");
    const clean=action==="pmv2-source-clean", stateName=clean?"pmv2-source-state-b":"pmv2-source-state";
    let resume; try { resume=JSON.parse(await readFile(`${evidence}/${stateName}.json`,"utf8")); } catch {}
    const result=await createPmv2SourceFixture(rpc,{proof:{databaseName:"copycmms2",baseUrl:"http://localhost:4002"},
      teamId:30001,siteId:390001,sectionId:150011,categoryId:2,catalogItemId:clean?180300:180230,unit:"قطعة",quantity:4,date:"2026-10-30",
      photoUrl:"/api/media?key=cmms%2Fuploads%2F1791666727566-LwHMABqv.webp",
      label:clean?"TEST-SUPPLIER-RETURN-PMV2-20261030-B":"TEST-SUPPLIER-RETURN-PMV2-20261030",resume,checkpoint:async(value:unknown)=>checkpoint(stateName,value)});
    await checkpoint(clean?"pmv2-source-b":"pmv2-source",result);
  } else if (action === "pmv2-references") {
    console.log(JSON.stringify(await rpc.query("pmv2.organization.teams.list"),null,2));
  } else if (action === "feature-status") {
    console.log(JSON.stringify({supplier:await rpc.query("supplierReturns.status"),bundles:await rpc.query("delegatePricingBundles.status"),operational:await rpc.query("operationalIssues.status")}));
  } else if (action.startsWith("operational-")) {
    const {runOperationalCompensationAction} = await import("./operational-compensation-api");
    console.log(JSON.stringify(await runOperationalCompensationAction(rpc,action,{categoryId:2}),null,2));
  } else if (action === "team-source" || action === "team-resume") {
    const {createTeamCompensationSource} = await import("./team-compensation-api");
    const ticket=await rpc.query("tickets.getById",{id:2010107});
    const refs={teamId:2,managerId:19080005,siteId:390001,sectionId:150011,categoryId:2,
      photoUrl:ticket.beforePhotoUrl,catalogItemId:180213,itemName:"سكين معجون بيد بلاستيك 10 انش",unit:"قطعة",quantity:4};
    const result=action==="team-source" ? await createTeamCompensationSource(rpc,refs,assertTrial,checkpoint)
      : await (await import("./team-compensation-api")).continueTeamCompensationSource(rpc,JSON.parse(await readFile(`${evidence}/team-assigned.json`,"utf8")),refs,assertTrial,checkpoint);
    await checkpoint("team-source",result);
  } else if (action === "source-references") {
    const [teams,managers,ticket,categories] = await Promise.all([
      rpc.query("ticketTeamAssignments.candidates"),rpc.query("users.byRole",{role:"general_maintenance_manager"}),
      rpc.query("tickets.getById",{id:2010107}),rpc.query("centerCategories.list",{activeOnly:true}),
    ]);
    console.log(JSON.stringify({teams,managers:managers.map((manager:any)=>({id:manager.id,name:manager.name,isActive:manager.isActive})),
      photoUrl:ticket.beforePhotoUrl,categories},null,2));
  } else if (action === "duplicate-operational") {
    const before = await client.operationalIssues.detail.query({id:3});
    let rejected = false;
    try {
      await client.operationalIssues.issuePrepared.mutate({orderId:3,revision:before.order.revision,
        operationKey:"UAT-20261030-repeat-completed",items:before.items.map(item=>({itemId:Number(item.id),notes:""}))});
    } catch { rejected=true; }
    const after = await client.operationalIssues.detail.query({id:3});
    if (!rejected || after.deliveries.length !== before.deliveries.length || after.cost.net !== before.cost.net) throw Error("Duplicate issue protection failed");
    console.log(JSON.stringify({orderNumber:after.order.orderNumber,rejected,deliveryCount:after.deliveries.length,cost:after.cost.net}));
  } else throw Error("Unknown acceptance action");
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1; }
