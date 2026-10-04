import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

type Option = { value: string; label: string; count?: number };
type Props = {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
  controlIndex?: number;
  tabIndex?: number;
  onFocus?: () => void;
  onPointerEnter?: () => void;
  triggerContent?: ReactNode;
  openOnArrowKeys?: boolean;
  autoOpen?: boolean;
  onClose?: () => void;
};

/** App-rendered options inherit application zoom; native select popups do not. */
export function Select({ value, options, onChange, label, disabled, className = "", style, title, controlIndex, tabIndex, onFocus, onPointerEnter, triggerContent, openOnArrowKeys = true, autoOpen, onClose }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const id = useId();
  const preserveFocus = useRef(false);
  function close(restore = false) { setOpen(false); if (restore && !autoOpen && !preserveFocus.current) trigger.current?.focus(); onClose?.(); }
  function show() { preserveFocus.current = !!trigger.current?.closest('.shell[data-repository-focus]'); setActive(Math.max(0, options.findIndex((option) => option.value === value))); setOpen(true); }
  useLayoutEffect(() => { if (autoOpen) show(); }, [autoOpen]);

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const zoom = Number.parseFloat(getComputedStyle(document.body).zoom) || 1;
    const width = Math.min(Math.max(rect.width / zoom, 200), window.innerWidth / zoom - 16);
    const anchorTop = Math.max(8 * zoom, Math.min(rect.top, window.innerHeight - 8 * zoom));
    const anchorBottom = Math.max(8 * zoom, Math.min(rect.bottom, window.innerHeight - 8 * zoom));
    const below = (window.innerHeight - anchorBottom) / zoom - 8;
    const above = anchorTop / zoom - 8;
    const up = below < 180 && above > below;
    setPosition({ left: Math.max(8, Math.min(rect.left / zoom, window.innerWidth / zoom - width - 8)), width,
      ...(up ? { bottom: Math.max(8, (window.innerHeight - anchorTop) / zoom + 4) } : { top: anchorBottom / zoom + 4 }),
      maxHeight: Math.max(40, Math.min(300, up ? above : below)),
      fontSize: Math.max(12, Number.parseFloat(getComputedStyle(trigger.current).fontSize)) });
    if (!preserveFocus.current) list.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!trigger.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) close(); };
    const moved = (event: Event) => { if (!list.current?.contains(event.target as Node)) close(); };
    const observer = new MutationObserver(() => close(true));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    document.addEventListener("mousedown", outside);
    window.addEventListener("resize", moved);
    document.addEventListener("scroll", moved, true);
    return () => { observer.disconnect(); document.removeEventListener("mousedown", outside); window.removeEventListener("resize", moved); document.removeEventListener("scroll", moved, true); };
  }, [open]);
  useEffect(() => {
    const menu = list.current;
    const option = menu?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!menu || !option) return;
    // Scroll only the menu; ancestor scrolling would dismiss it.
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight)
      menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
  }, [active, open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  function menuKey(event: KeyboardEvent | React.KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(true); }
    else if (event.key === "Tab") { event.preventDefault(); close(true); }
    else if (["Enter", " "].includes(event.key)) { event.preventDefault(); choose(active); }
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); setActive((current) => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const text = (Date.now() - search.current.time < 700 ? search.current.text : "") + event.key.toLowerCase();
      search.current = { text, time: Date.now() };
      const index = options.findIndex((option) => option.label.toLowerCase().startsWith(text));
      if (index >= 0) setActive(index);
    }
  }
  useEffect(() => {
    if (!open || !preserveFocus.current) return;
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (['Escape','Tab','Enter',' ','ArrowDown','ArrowUp','Home','End'].includes(event.key) || event.key.length === 1) { event.preventDefault(); menuKey(event); }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [open, active, options]);
  function choose(index: number) { if (options[index]) onChange(options[index].value); close(true); }
  return <>
    <button data-control-index={controlIndex} tabIndex={tabIndex} onFocus={onFocus} onPointerEnter={onPointerEnter} ref={trigger} type="button" role={triggerContent ? "button" : "combobox"} aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="listbox" disabled={disabled}
      className={`app-select ${triggerContent ? "app-select-button" : ""} ${className}`} style={style} title={title} onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); open ? close() : show(); }}
      onKeyDown={(event) => { if (openOnArrowKeys && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); show(); } }}>
      {triggerContent || <><span>{options.find((option) => option.value === value)?.label ?? "Choose…"}</span><ChevronDown size={13} /></>}
    </button>
    {open && createPortal(<div ref={list} id={id} role="listbox" aria-label={label} tabIndex={-1} aria-activedescendant={`${id}-${active}`} className="app-select-menu" style={position}
      onKeyDown={menuKey}>
      {options.map((option, index) => <div id={`${id}-${index}`} data-index={index} data-value={option.value} role="option" aria-selected={option.value === value} key={option.value} className={index === active ? "active" : ""}
        onMouseMove={() => setActive(index)} onClick={() => choose(index)}><span>{option.label}</span>{option.count != null && <span className="option-count">{option.count}</span>}{option.value === value && <Check size={14} />}</div>)}
    </div>, document.body)}
  </>;
}
