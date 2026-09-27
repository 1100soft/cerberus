export type CopilotQuotaResponse={quota?:{quotaSnapshots?:Record<string,{entitlementRequests:number;usedRequests:number;remainingPercentage?:number;resetDate?:string}>}};
const labels:Record<string,string>={premium_interactions:'Premium requests',ai_credits:'AI credits',chat:'Chat',completions:'Completions'};
export function CopilotQuota({usage}:{usage?:CopilotQuotaResponse|null}){
 const snapshots=Object.entries(usage?.quota?.quotaSnapshots||{});
 if(!snapshots.length)return usage?<small>Copilot quota unavailable</small>:null;
 return <div className="copilot-limits">{snapshots.map(([name,limit])=>{
  const label=labels[name]||name.replaceAll('_',' ');
  const count=limit.entitlementRequests<0?'Unlimited':`${limit.usedRequests} / ${limit.entitlementRequests}`;
  const reset=limit.resetDate && new Date(limit.resetDate);
  return <span key={name}><b>{label}</b> {count}{reset && Number.isFinite(reset.getTime()) && <small> · Resets {reset.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</small>}</span>;
 })}</div>;
}
