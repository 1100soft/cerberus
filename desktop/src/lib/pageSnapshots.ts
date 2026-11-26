/** Small session-only snapshots: paint prior data immediately, then revalidate.
 * Pending reads are shared across remounts; failed reads never erase good data.
 */
export class PageSnapshots<T> {
  private values=new Map<string,T>();
  private pending=new Map<string,Promise<T>>();
  private stamps=new Map<string,number>();
  constructor(private capacity=32){}
  peek(key:string){return this.values.get(key);}
  set(key:string,value:T){
    this.stamps.set(key,(this.stamps.get(key)||0)+1);
    this.values.delete(key);this.values.set(key,value);
    while(this.values.size>this.capacity){const oldest=this.values.keys().next().value!;this.values.delete(oldest);this.stamps.delete(oldest);}
  }
  clear(matches:(key:string)=>boolean=()=>true){
    for(const key of new Set([...this.values.keys(),...this.pending.keys(),...this.stamps.keys()]))if(matches(key)){this.values.delete(key);this.pending.delete(key);this.stamps.delete(key);}
  }
  load(key:string,read:()=>Promise<T>,force=false):Promise<T>{
    const existing=this.pending.get(key);if(existing&&!force)return existing;
    const stamp=this.stamps.get(key)||0;
    const request=Promise.resolve().then(read).then(value=>{if(this.pending.get(key)===request&&(this.stamps.get(key)||0)===stamp)this.set(key,value);return value;}).finally(()=>{if(this.pending.get(key)===request)this.pending.delete(key);});
    this.pending.set(key,request);return request;
  }
}
