import { useEffect, useRef } from 'react';
const ownerSelector = '.repo-row.selected [data-control-index], .repo-row.selected, .repo-grid, .codex-panel button, .codex-panel .codex-messages';
const editableSelector = 'textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), [contenteditable=true]';
/** Browsing never transfers keyboard ownership away from repository controls or chat.
 * Explicit text entry and modal forms retain ordinary editing/accessibility behavior. */
export function useWorkspaceFocus(active: boolean, repositoryId?: string) {
  const owner = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const shell = document.querySelector<HTMLElement>('.shell');
    shell?.setAttribute('data-repository-focus', '');
    const repository = () => document.querySelector<HTMLElement>('.repo-row.selected .chosen') || document.querySelector<HTMLElement>('.repo-row.selected') || document.querySelector<HTMLElement>('.repo-grid');
    const restore = () => {
      const target = owner.current?.isConnected && owner.current.matches(ownerSelector) ? owner.current : repository();
      target?.focus({preventScroll:true});
    };
    const focus = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('[role=dialog], .modal-overlay')) return;
      if (target.matches(ownerSelector)) { owner.current = target; return; }
      if (target.matches(editableSelector)) return;
      restore();
    };
    const pointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('[role=dialog], .modal-overlay')) return;
      if (target.closest(editableSelector) || target.closest('.repo-row, .codex-panel')) return;
      if (target.closest('button, a, summary, label, input, [role=listbox], [role=separator], [tabindex]')) event.preventDefault();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || document.querySelector('[role=listbox], [role=dialog]')) return;
      const current = document.activeElement as HTMLElement;
      if (event.shiftKey || current?.matches(editableSelector) || current?.closest('.codex-panel')) return;
      const chat = document.querySelector<HTMLElement>('.codex-thread-list button.active, .codex-thread-list button.provider-codex, .codex-thread-list button, .conversation-search input');
      if (!chat) return;
      event.preventDefault();
      chat.focus({preventScroll:true});
    };
    document.addEventListener('focusin', focus);
    document.addEventListener('mousedown', pointer, true);
    document.addEventListener('keydown', key, true);
    const frame = requestAnimationFrame(() => {
      const current = document.activeElement as HTMLElement;
      if (!current?.matches(`${ownerSelector}, ${editableSelector}`)) restore();
    });
    return () => { cancelAnimationFrame(frame); shell?.removeAttribute('data-repository-focus'); document.removeEventListener('focusin', focus); document.removeEventListener('mousedown', pointer, true); document.removeEventListener('keydown', key, true); };
  }, [active, repositoryId]);
}
