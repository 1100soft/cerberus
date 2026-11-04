/** Small session-only snapshots: paint prior data immediately, then revalidate.
 * Pending reads are shared across remounts; failed reads never erase good data.
 */
export class PageSnapshots<T> {
  private values=new Map<string,T>();
  private pending=new Map<string,Promise<T>>();
  constructor(private capacity=32){}
  peek(key:string){return this.values.get(key);}
  set(key:string,value:T){
    this.values.delete(key);this.values.set(key,value);
    while(this.values.size>this.capacity)this.values.delete(this.values.keys().next().value!);
  }
  clear(matches:(key:string)=>boolean=()=>true){
    for(const key of new Set([...this.values.keys(),...this.pending.keys()]))if(matches(key)){this.values.delete(key);this.pending.delete(key);}
  }
  load(key:string,read:()=>Promise<T>,force=false):Promise<T>{
    const existing=this.pending.get(key);if(existing&&!force)return existing;
    const request=Promise.resolve().then(read).then(value=>{if(this.pending.get(key)===request)this.set(key,value);return value;}).finally(()=>{if(this.pending.get(key)===request)this.pending.delete(key);});
    this.pending.set(key,request);return request;
  }
}
