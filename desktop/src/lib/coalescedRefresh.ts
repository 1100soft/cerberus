/** One bounded-rate read per key, with one follow-up for changes during a read. */
export function coalescedRefresh<T>(read:(key:string)=>Promise<T>,publish:(key:string,value:T,at:number)=>void,onError:(error:unknown)=>void,delay=300){
  const entries=new Map<string,{at:number;timer?:ReturnType<typeof setTimeout>;running:boolean;dirty:boolean}>();
  const enqueue=(key:string,at:number)=>{
    let entry=entries.get(key);
    if(!entry){entry={at,running:false,dirty:false};entries.set(key,entry);}
    entry.at=Math.max(entry.at,at);entry.dirty=true;
    if(entry.running||entry.timer!==undefined)return;
    const current=entry;
    current.timer=setTimeout(async()=>{
      current.timer=undefined;current.running=true;current.dirty=false;
      const startedAt=current.at;
      try{const value=await read(key);if(entries.get(key)===current)publish(key,value,startedAt);}
      catch(error){if(entries.get(key)===current)onError(error);}
      finally{current.running=false;if(entries.get(key)===current){if(current.dirty)enqueue(key,current.at);else entries.delete(key);}}
    },delay);
  };
  return {enqueue,clear(){for(const entry of entries.values())clearTimeout(entry.timer);entries.clear();}};
}
