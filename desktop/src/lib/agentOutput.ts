// Convert documented CLI events to a readable activity log; stderr stays visible.
export function agentOutput(line: string): string {
  if (line.includes('list_turns is not supported yet')) return 'The Codex app-server cannot read this paginated conversation yet. Start a separate chat to proceed.\n';
  let event: any;
  try { event = JSON.parse(line); } catch { return line; }
  if (!event || typeof event !== 'object') return line;
  if (event.type === 'workspace_changes' || event.type === 'turn.diff' || event.type === 'file.patch' || event.type === 'turn.plan') return '';
  if (event.type === 'thread.started') return `Session ${event.thread_id}\n`;
  if (event.type === 'turn.started') return 'Working…\n';
  if (event.type === 'turn.completed') return 'Turn completed.\n';
  if (event.type === 'turn.failed' || event.type === 'error') return `${event.error?.message || event.message || 'Agent error'}\n`;
  if (event.type === 'item.completed') {
    const item = event.item || {};
    if (item.type === 'error') return `${item.message || 'Provider warning'}\n`;
    if (typeof item.text === 'string') return `${item.text}\n`;
    if (item.type === 'command_execution') return `$ ${item.command}\n${item.aggregated_output || ''}\nExit: ${item.exit_code ?? item.status}\n`;
    if (item.type === 'file_change') return `Files: ${(Array.isArray(item.changes) ? item.changes : []).map((c: any) => `${c.kind}: ${c.path}`).join(', ')}\n`;
  }
  if (event.type === 'assistant') return (Array.isArray(event.message?.content) ? event.message.content : []).filter((c: any) => c.type === 'text').map((c: any) => `${c.text}\n`).join('');
  if (event.type === 'result') return `${event.is_error ? 'Failed: ' : ''}${event.result || event.subtype || 'Finished'}\n`;
  if (event.type === 'tool_call') return `Tool ${event.subtype || ''}: ${Object.keys(event.tool_call || {}).join(', ')}\n`;
  if (event.type === 'system') return event.subtype === 'init' ? `Session ${event.session_id || ''}\n` : '';
  return line;
}
