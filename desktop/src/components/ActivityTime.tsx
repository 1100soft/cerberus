import {useSyncExternalStore} from 'react';
import {activityTime} from '../lib/activityTime';
let now=Date.now(),timer:number|undefined;
const listeners=new Set<()=>void>();
function tick(){now=Date.now();for(const notify of listeners)notify();}
function subscribe(listener:()=>void){
 listeners.add(listener);
 if(timer===undefined){now=Date.now();timer=window.setInterval(tick,30000);window.addEventListener('focus',tick);document.addEventListener('visibilitychange',tick);}
 return()=>{listeners.delete(listener);if(!listeners.size){window.clearInterval(timer);timer=undefined;window.removeEventListener('focus',tick);document.removeEventListener('visibilitychange',tick);}};
}
export function ActivityTime({timestamp}:{timestamp?:number}) {
 const current=useSyncExternalStore(subscribe,()=>now,()=>now);
 const valid=!!timestamp&&Number.isFinite(timestamp)&&timestamp>0;
 return <time className="activity-time" dateTime={valid?new Date(timestamp!).toISOString():undefined} title={valid?new Date(timestamp!).toLocaleString():'Timestamp unavailable in older history'}>{activityTime(timestamp||0,Math.max(current,Date.now()))}</time>;
}
