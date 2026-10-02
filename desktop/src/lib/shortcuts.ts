/** Stable command IDs keep bindings independent of UI layout and ready for customization. */
type Binding = {key: string; aliases?: string[]; ctrl?: boolean; shift?: boolean; primary?: boolean; allowShift?: boolean; label: string; description: string};
export const shortcuts = {
  'view.zoomIn': { key: '+', aliases:['='], primary:true, allowShift:true, label:'Ctrl/Cmd++', description:'Zoom in (also Ctrl/Cmd+wheel)' },
  'view.zoomOut': { key: '-', aliases:['_'], primary:true, allowShift:true, label:'Ctrl/Cmd+−', description:'Zoom out' },
  'view.zoomReset': { key: '0', primary:true, label:'Ctrl/Cmd+0', description:'Reset zoom' },
  'repository.previous': { key: 'ArrowUp', label: '↑', description: 'Previous repository' },
  'repository.next': { key: 'ArrowDown', label: '↓', description: 'Next repository' },
  'control.previous': { key: 'ArrowLeft', label: '←', description: 'Previous repository action' },
  'control.next': { key: 'ArrowRight', label: '→', description: 'Next repository action' },
  'control.activate': { key: 'Enter', label: 'Enter', description: 'Activate selected action' },
  'repository.focus': { key: 'Escape', label: 'Esc', description: 'Return to repository actions' },
  'conversation.previous': { key: 'ArrowUp', ctrl: true, label: 'Ctrl+↑', description: 'Previous conversation' },
  'conversation.next': { key: 'ArrowDown', ctrl: true, label: 'Ctrl+↓', description: 'Next conversation' },
  'search.repositories': { key: 'f', aliases:['F'], label:'F', description:'Search repositories' },
  'search.conversations': { key:'f', aliases:['F'], ctrl:true, label:'Ctrl+F', description:'Search conversations in this repository' },
  'search.messages': { key:'F', aliases:['f'], ctrl:true, shift:true, label:'Ctrl+Shift+F', description:'Search this conversation' },
  'search.next': {key:'Enter',label:'Enter',description:'Next match while searching'},
  'search.previous': {key:'Enter',shift:true,label:'Shift+Enter',description:'Previous match while searching'},
  'message.first': { key:'Home', ctrl:true, shift:true, label:'Ctrl+Shift+Home', description:'Beginning of conversation' },
  'message.last': { key:'End', ctrl:true, shift:true, label:'Ctrl+Shift+End', description:'End of conversation' },
  'message.previous': { key:'PageUp', ctrl:true, label:'Ctrl+PgUp', description:'Previous prompt or response' },
  'message.next': { key:'PageDown', ctrl:true, label:'Ctrl+PgDn', description:'Next prompt or response' },
  'chat.send': { key: 'Enter', ctrl: true, label: 'Ctrl+Enter', description: 'Send message (Enter inserts a line)' },
  'commit.previous': { key: 'ArrowUp', shift: true, label: 'Shift+↑', description: 'Previous commit' },
  'commit.next': { key: 'ArrowDown', shift: true, label: 'Shift+↓', description: 'Next commit' },
  'branch.previous': { key: 'ArrowLeft', shift: true, label: 'Shift+←', description: 'Previous branch' },
  'branch.next': { key: 'ArrowRight', shift: true, label: 'Shift+→', description: 'Next branch' },
} satisfies Record<string, Binding>;
export type ShortcutCommand = keyof typeof shortcuts;
export function matchesShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'isComposing'>, command: ShortcutCommand) {
  const binding: Binding = shortcuts[command];
  return !event.isComposing && !event.altKey && (event.key === binding.key || !!binding.aliases?.includes(event.key)) && (binding.primary ? (event.ctrlKey || event.metaKey) : !event.metaKey && event.ctrlKey === !!binding.ctrl) && (!!binding.allowShift || event.shiftKey === !!binding.shift);
}
export const repositoryActionKeys = { chat: 'A', identity: 'I', editor: 'E', cursor: 'C', locate: 'I', clone: 'C', hosted: 'G', configure: ',' };
