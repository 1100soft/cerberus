/** Run overdue cleanup immediately; recovery must never hold the first sweep hostage. */
export function startAutomationMaintenance(recover:()=>Promise<unknown>,cleanup:()=>Promise<unknown>,report:(error:unknown)=>void){
  const sweep=()=>Promise.resolve().then(cleanup).catch(report);
  const initial=sweep();
  const recovered=Promise.resolve().then(recover).catch(report).then(sweep);
  return Promise.all([initial,recovered]);
}
