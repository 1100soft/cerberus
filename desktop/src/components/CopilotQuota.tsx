export type CopilotQuotaResponse={quota?:{quotaSnapshots?:Record<string,{entitlementRequests:number;usedRequests:number;remainingPercentage?:number;resetDate?:string}>}};
const premiumLabel='Premium requests';
export function CopilotQuota({usage}:{usage?:CopilotQuotaResponse|null}){
 const limit=usage?.quota?.quotaSnapshots?.premium_interactions;
 if(!limit || limit.entitlementRequests<=0)return null;
 const reset=limit.resetDate && new Date(limit.resetDate);
 return <div className="copilot-limits"><span><b>{premiumLabel}</b> {limit.usedRequests} / {limit.entitlementRequests}{reset && Number.isFinite(reset.getTime()) && <small> · Resets {reset.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</small>}</span></div>;
}
