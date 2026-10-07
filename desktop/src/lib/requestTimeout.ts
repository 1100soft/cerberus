/** Bound UI requests without letting late responses change the selected context. */
export function requestTimeout<T>(request:Promise<T>,label:string,timeoutMs=30_000):Promise<T>{
  return new Promise((resolve,reject)=>{
    const timer=window.setTimeout(()=>reject(new Error(`${label} timed out. Retry the request.`)),timeoutMs);
    request.then(resolve,reject).finally(()=>window.clearTimeout(timer));
  });
}
