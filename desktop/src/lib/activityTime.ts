/** Compact local time; retain the exact instant in the timestamp's tooltip. */
export function activityTime(timestamp:number,now=Date.now()):string {
  if(!Number.isFinite(timestamp)||timestamp<=0)return '—';
  const date=new Date(timestamp),age=now-timestamp;
  if(age>-60000&&age<60000)return 'Now';
  if(age>=0&&age<86400000)return date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:false});
  return date.toLocaleDateString([], {month:'short',day:'numeric',...(date.getFullYear()!==new Date(now).getFullYear()?{year:'numeric'}:{})});
}
