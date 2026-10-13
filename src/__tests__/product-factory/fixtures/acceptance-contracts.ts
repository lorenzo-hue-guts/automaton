import type { JsonValue, ProductBriefContent, AcceptanceProbe } from "../../../product-factory/index.js";
export const read=(path:string)=>({read:path});
export const op=(operator:string,...args:any[])=>({op:operator,args});
export const obj=(fields:Record<string,any>)=>({object:fields});
export const literal=(value:any)=>({literal:value});
export const list=(table:string)=>read(`db.${table}`);
export const size=(table:string)=>({call:"length",value:list(table)});
const check=(test:any,error:string)=>({check:test,error});
const record=(table:string,fields:any)=>[{let:"record",value:obj({id:op("+",size(table),1),...fields})},{push:table,value:read("record")},{return:read("record")}];
const find=(table:string,id:any)=>({call:"find",array:list(table),as:"row",where:op("===",read("row.id"),id)});
export interface Contract { label:string; shape:string; tables:Record<string,string[]>; routes:{name:string;method:string;path:string;statements:any[]}[]; ui?:{heading:string;route:string;fields:{name:string;type:string}[]}; persistence:boolean }
const probe=(id:string,method:any,path:string,input:JsonValue,expected:JsonValue,kind:AcceptanceProbe["kind"]="functional",status=200,restartBefore=false):AcceptanceProbe=>({id,entry:"private-http",featureIds:["journey"],transport:"http",http:{method,path,status,restartBefore},input,expected,kind});
export interface BenchmarkBrief { contract:Contract; journey:string; content:ProductBriefContent; repair:"compile"|"runtime"|"acceptance"|"malformed"|"none" }
function brief(contract:Contract,journey:string,probes:AcceptanceProbe[],repair:BenchmarkBrief["repair"]):BenchmarkBrief {
  probes.unshift(probe("readiness","GET","/health",null,{ready:true,service:contract.label},"startup"));
  const metric=probe("instrumentation","GET","/metrics",null,null,"metric");metric.http!.assertions=[{path:"requests",minimum:1}];probes.push(metric);
  if (contract.ui) probes.push({id:"browser-journey",entry:"private-browser",featureIds:["journey"],transport:"browser",browser:{path:"/",steps:[{action:"fill",selector:`[name=${contract.ui.fields[0].name}]`,value:""},{action:"click",selector:"#submit"},{action:"visible",selector:"#result",text:"required"},{action:"fill",selector:`[name=${contract.ui.fields[0].name}]`,value:"Browser-created entry"},{action:"click",selector:"#submit"},{action:"visible",selector:"#result",text:"Browser-created entry"}]},input:null,expected:null,kind:"integration"});
  const content:ProductBriefContent={problem:journey,targetUsers:[contract.shape+" users"],valueProposition:journey,proposedSolution:"An original private application meeting the attached product contract",criticalHypotheses:["Market demand is not validated"],mvpFeatures:[{id:"journey",title:journey,acceptanceCriterion:"All approved HTTP/browser contract probes pass"}],nonGoals:["Public deployment","Commercial actions"],architecture:"Choose components appropriate to the contract; private HTTP, persistent storage only where required",hypotheticalPricing:"Out of scope",validationCriteria:probes.map(p=>({id:p.id,kind:p.kind==="metric"?"metric":"test",target:`acceptance:${p.id}`,description:p.kind})),risks:["No evidence of generalization from a real external model yet"],estimatedCostCents:0,complexity:"medium",metrics:["requests"],successCriteria:probes.map(p=>p.id),failureCriteria:["Incorrect journey or persistence","Unavailable required browser"],acceptanceProbes:probes,applicationContract:contract as unknown as JsonValue};
  return {contract,journey,content,repair};
}
export const UNKNOWN_BRIEFS:BenchmarkBrief[]=[
  brief({label:"purchase-review",shape:"workflow/business SaaS",persistence:true,tables:{requests:["id","amount","department","state"]},routes:[
    {name:"request",method:"POST",path:"/requests",statements:[check(op(">",read("input.amount"),0),"positive amount required"),...record("requests",{amount:read("input.amount"),department:read("input.department"),state:"draft"})]},
    {name:"approve",method:"POST",path:"/approve",statements:[{let:"request",value:find("requests",read("input.id"))},check(read("request"),"unknown request"),check(op("===",read("input.role"),"manager"),"manager required"),check(op("===",read("request.state"),"draft"),"already reviewed"),{assign:"request.state",value:"approved"},{return:read("request")}]},
    {name:"queue",method:"GET",path:"/requests",statements:[{return:list("requests")}]}
  ]},"Submit a departmental purchase request, refuse an unauthorized review, then approve exactly once",[
    probe("submit","POST","/requests",{amount:120,department:"engineering"},{id:1,amount:120,department:"engineering",state:"draft"}),
    probe("unauthorized","POST","/approve",{id:1,role:"reader"},{error:"manager required"},"error",400),
    probe("review","POST","/approve",{id:1,role:"manager"},{id:1,amount:120,department:"engineering",state:"approved"},"integration"),
    probe("durable-review","GET","/requests",null,[{id:1,amount:120,department:"engineering",state:"approved"}],"persistence",200,true),
    probe("duplicate-review","POST","/approve",{id:1,role:"manager"},{error:"already reviewed"},"error",400)
  ],"compile"),
  brief({label:"habit-log",shape:"personal productivity UI",persistence:true,tables:{habits:["id","title","target"],entries:["id","habitId","day"]},ui:{heading:"Weekly habit tracker",route:"/habits",fields:[{name:"title",type:"text"},{name:"target",type:"number"}]},routes:[
    {name:"habit",method:"POST",path:"/habits",statements:[check(read("input.title"),"title required"),check(op(">",read("input.target"),0),"positive target required"),...record("habits",{title:read("input.title"),target:read("input.target")})]},
    {name:"checkin",method:"POST",path:"/checkins",statements:[check(find("habits",read("input.habitId")),"habit required"),check({call:"every",array:list("entries"),as:"entry",where:op("||",op("!==",read("entry.habitId"),read("input.habitId")),op("!==",read("entry.day"),read("input.day")))},"duplicate day"),...record("entries",{habitId:read("input.habitId"),day:read("input.day")})]},
    {name:"progress",method:"GET",path:"/progress",statements:[{return:obj({completed:size("entries"),remaining:op("-",3,size("entries"))})}]}
  ]},"Create a habit, record a daily check-in once, then read durable progress and complete the UI form",[
    probe("new-habit","POST","/habits",{title:"Read",target:3},{id:1,title:"Read",target:3}),probe("check-in","POST","/checkins",{habitId:1,day:"2026-10-07"},{id:1,habitId:1,day:"2026-10-07"},"integration"),probe("duplicate-day","POST","/checkins",{habitId:1,day:"2026-10-07"},{error:"duplicate day"},"error",400),probe("progress-restart","GET","/progress",null,{completed:1,remaining:2},"persistence",200,true)
  ],"runtime"),
  brief({label:"stock-reconciliation",shape:"data/import/reporting",persistence:true,tables:{counts:["id","sku","warehouse","expected","actual","variance"]},routes:[
    {name:"import",method:"POST",path:"/counts",statements:[check(read("input.sku"),"sku required"),check(op(">=",read("input.actual"),0),"nonnegative actual required"),...record("counts",{sku:read("input.sku"),warehouse:read("input.warehouse"),expected:read("input.expected"),actual:read("input.actual"),variance:op("-",read("input.actual"),read("input.expected"))})]},
    {name:"report",method:"GET",path:"/discrepancies",statements:[{return:{call:"filter",array:list("counts"),as:"row",where:op("!==",read("row.variance"),0)}}]}
  ]},"Import warehouse counts and report only discrepancies, retaining the reconciled records across restart",[
    probe("import-count","POST","/counts",{sku:"SKU-7",warehouse:"north",expected:10,actual:7},{id:1,sku:"SKU-7",warehouse:"north",expected:10,actual:7,variance:-3}),probe("report","GET","/discrepancies",null,[{id:1,sku:"SKU-7",warehouse:"north",expected:10,actual:7,variance:-3}],"integration"),probe("bad-count","POST","/counts",{sku:"SKU-8",actual:-1},{error:"nonnegative actual required"},"error",400),probe("report-restart","GET","/discrepancies",null,[{id:1,sku:"SKU-7",warehouse:"north",expected:10,actual:7,variance:-3}],"persistence",200,true)
  ],"acceptance"),
  brief({label:"linked-knowledge",shape:"knowledge/content UI",persistence:true,tables:{notes:["id","title","text"],links:["id","source","target"]},ui:{heading:"Linked knowledge notes",route:"/notes",fields:[{name:"title",type:"text"},{name:"text",type:"text"}]},routes:[
    {name:"note",method:"POST",path:"/notes",statements:[check(read("input.title"),"title required"),...record("notes",{title:read("input.title"),text:read("input.text")})]},
    {name:"link",method:"POST",path:"/links",statements:[check(find("notes",read("input.source")),"source required"),check(find("notes",read("input.target")),"target required"),check(op("!==",read("input.source"),read("input.target")),"self link forbidden"),...record("links",{source:read("input.source"),target:read("input.target")})]},
    {name:"backlinks",method:"GET",path:"/backlinks",statements:[{return:{call:"map",array:list("links"),as:"edge",where:obj({from:find("notes",read("edge.source")),to:find("notes",read("edge.target"))})}}]}
  ]},"Create two knowledge notes, link them, reject a self-link and retrieve persistent backlinks via HTTP and UI",[
    probe("first-note","POST","/notes",{title:"Design",text:"Original design notes"},{id:1,title:"Design",text:"Original design notes"}),probe("second-note","POST","/notes",{title:"Implementation",text:"Original implementation notes"},{id:2,title:"Implementation",text:"Original implementation notes"}),probe("link","POST","/links",{source:1,target:2},{id:1,source:1,target:2},"integration"),probe("self-link","POST","/links",{source:1,target:1},{error:"self link forbidden"},"error",400),probe("backlinks-restart","GET","/backlinks",null,[{from:{id:1,title:"Design",text:"Original design notes"},to:{id:2,title:"Implementation",text:"Original implementation notes"}}],"persistence",200,true)
  ],"malformed"),
  brief({label:"dimension-conversion",shape:"stateless API/service",persistence:false,tables:{},routes:[
    {name:"convert",method:"POST",path:"/convert",statements:[{let:"units",value:literal({km:{dimension:"length",scale:1000},m:{dimension:"length",scale:1},kg:{dimension:"mass",scale:1}})},{let:"source",value:{lookup:read("units"),key:read("input.from")}},{let:"target",value:{lookup:read("units"),key:read("input.to")}},check(op("&&",read("source"),read("target")),"known units required"),check(op("===",read("source.dimension"),read("target.dimension")),"incompatible dimensions"),check(op("type",read("input.value"),"number"),"numeric value required"),{return:obj({value:op("/",op("*",read("input.value"),read("source.scale")),read("target.scale")),unit:read("input.to")})}]}
  ]},"Convert compatible dimensions with exact scale factors, reject unknown/incompatible units, and serve multiple stateless requests",[
    probe("convert-length","POST","/convert",{value:1.5,from:"km",to:"m"},{value:1500,unit:"m"},"integration"),probe("reverse","POST","/convert",{value:250,from:"m",to:"km"},{value:0.25,unit:"km"}),probe("incompatible","POST","/convert",{value:3,from:"kg",to:"m"},{error:"incompatible dimensions"},"error",400),probe("restart-stateless","POST","/convert",{value:2,from:"km",to:"m"},{value:2000,unit:"m"},"functional",200,true)
  ],"none")
];
