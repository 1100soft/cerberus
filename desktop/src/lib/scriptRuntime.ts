export type ScriptRuntime={preset:'auto'|'default'|'bash'|'powershell'|'python'|'node'|'ruby'|'custom';executable?:string;args?:string[];extension?:string};
export type RuntimeStatus={preset:string;executable?:string;version?:string;error?:string};
export const runtimeOptions=[{value:'auto',label:'Automatic'},{value:'default',label:'App default'},{value:'bash',label:'Bash'},{value:'powershell',label:'PowerShell'},{value:'python',label:'Python'},{value:'node',label:'Node.js'},{value:'ruby',label:'Ruby'},{value:'custom',label:'Custom'}];
export function runtimeLabel(runtime?:ScriptRuntime){return runtimeOptions.find(option=>option.value===runtime?.preset)?.label||(runtime?'App default':'Bash');}
export function runtimeError(runtime:ScriptRuntime){return runtime.preset==='custom'&&!runtime.executable?.trim()?'Enter the custom interpreter executable.':'';}
export function detectScriptRuntime(source:string):ScriptRuntime['preset']|undefined{
 const first=source.trimStart().split(/\r?\n/,1)[0];
 if(first.startsWith('#!')){for(const [pattern,preset] of [[/\bpython(?:\d+(?:\.\d+)*)?\b/,'python'],[/\b(?:pwsh|powershell)(?:\.exe)?\b/,'powershell'],[/\bnode(?:js)?\b/,'node'],[/\bruby\b/,'ruby'],[/\b(?:bash|sh)\b/,'bash']] as const)if(pattern.test(first))return preset;return undefined;}
 if(/^\s*(?:python[\d.]*|node|ruby|cat)\s+[^\n]*<</m.test(source))return 'bash';
 const detected:ScriptRuntime['preset'][]=[];
 if(/^\s*(?:from\s+[\w.]+\s+import\s|import\s+[\w.]+(?:\s+as\s+\w+)?\s*(?:$|#)|(?:async\s+)?def\s+\w+\(.*\)\s*(?:->.*?)?:|if\s+__name__\s*==|print\s*\()/m.test(source))detected.push('python');
 if(/\$env:|^\s*(?:Write-Host|Write-Output|Set-StrictMode|\[CmdletBinding\()/mi.test(source))detected.push('powershell');
 if(/^\s*(?:(?:const|let|var)\s+\w+\s*=|import\s+.+\s+from\s+['"]|(?:console\.(?:log|error)|process\.env)\b)/m.test(source))detected.push('node');
 if(/^\s*(?:puts\s+|require(?:_relative)?\s+['"])/m.test(source))detected.push('ruby');
 if(/^\s*(?:set\s+-[A-Za-z]+|export\s+\w+=|if\s+\[\[)/m.test(source))detected.push('bash');
 return detected.length===1?detected[0]:undefined;
}
export function availableRuntimeOptions(platform:string,available:string[],selected:string,allowDefault=true){return runtimeOptions.filter(option=>(allowDefault||!['auto','default'].includes(option.value))&&(!['bash','powershell'].includes(option.value)||option.value===platform||available.includes(option.value)||option.value===selected));}

export function resolveScriptRuntime(source:string,runtime:ScriptRuntime,fallback:ScriptRuntime):ScriptRuntime{if(runtime.preset==='default')return fallback;if(runtime.preset!=='auto')return runtime;const detected=detectScriptRuntime(source);return !detected||detected===fallback.preset?fallback:{preset:detected};}
