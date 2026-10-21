export type ScriptRuntime={preset:'default'|'bash'|'powershell'|'python'|'node'|'ruby'|'custom';executable?:string;args?:string[];extension?:string};
export type RuntimeStatus={preset:string;executable?:string;version?:string;error?:string};
export const runtimeOptions=[{value:'default',label:'App default'},{value:'bash',label:'Bash'},{value:'powershell',label:'PowerShell'},{value:'python',label:'Python'},{value:'node',label:'Node.js'},{value:'ruby',label:'Ruby'},{value:'custom',label:'Custom'}];
export function runtimeLabel(runtime?:ScriptRuntime){return runtimeOptions.find(option=>option.value===runtime?.preset)?.label||(runtime?'App default':'Bash');}
export function runtimeError(runtime:ScriptRuntime){return runtime.preset==='custom'&&!runtime.executable?.trim()?'Enter the custom interpreter executable.':'';}
