import type { FileEdit } from '../types';
/** Only completed writes count; reads, proposed edits and failures do not. */
export function eventEdits(event: any): FileEdit[] {
  if(event.type==='turn.diff' && typeof event.diff==='string')return unifiedEdits(event.diff);
  if(event.type==='file.patch') return (event.changes || []).filter((change:any) => typeof change.path === 'string').map((change:any) => ({path:change.path, kind:typeof change.kind === 'string' ? change.kind : change.kind?.type || 'update', diff:change.diff, source:'provider'}));
  if (event.type === 'workspace_changes') return event.changes.map((edit:FileEdit) => ({...edit, source:'workspace'}));
  if (event.type === 'item.completed' && event.item?.type === 'file_change' && event.item.status === 'completed') {
    return (event.item.changes || []).filter((c:any) => typeof c.path === 'string').map((c:any) => ({path:c.path,kind:typeof c.kind === 'string' ? c.kind : c.kind?.type || 'update',diff:c.diff,source:'provider'}));
  }
  const write = event.type === 'tool_call' && event.subtype === 'completed' && event.tool_call?.writeToolCall;
  if (write?.result?.success) return [{path:write.result.success.path || write.args.path,kind:'update',source:'provider'}];
  return [];
}
export function mergeEdits(previous:FileEdit[], next:FileEdit[], root?:string) {
  const relative = (path:string) => root && path.replaceAll('\\','/').startsWith(root.replaceAll('\\','/') + '/') ? path.replaceAll('\\','/').slice(root.length+1) : path;
  const edits = new Map(previous.map(edit => [relative(edit.path),{...edit,path:relative(edit.path)}]));
  for (const edit of next) { const existing = edits.get(edit.path); edits.set(edit.path, existing?.diff && !edit.diff ? existing : {...existing,...edit}); }
  return [...edits.values()];
}
export function agentFailure(error:string, activity='') {
  if ((error+activity).includes('list_turns is not supported yet')) return 'The Codex app-server cannot continue this paginated conversation yet. Start a separate chat to proceed. The original conversation is preserved.';
  if (/no credits remaining|insufficient_quota/i.test(error+activity)) return 'The selected API account has no credits remaining. Add API credits or use a funded account. Your conversation is preserved.';
  if ((error+activity).includes('already has an active writer')) return 'This Codex conversation is open in another process. Close that conversation in the other Codex app or IDE, then retry here. You can also start a separate chat.';
  return error;
}

export function unifiedEdits(diff:string):FileEdit[]{
 return diff.split(/(?=^diff --git )/m).filter(block=>block.trim()).flatMap(block=>{
 const added=block.match(/^\+\+\+ (?:b\/)?(.+)$/m)?.[1];const removed=block.match(/^--- (?:a\/)?(.+)$/m)?.[1];
 const path=added && added!=='/dev/null' ? added : removed;
 return path ? [{path,kind:added==='/dev/null'?'delete':removed==='/dev/null'?'add':'update',diff:block,source:'provider'}] : [];
 });
}
