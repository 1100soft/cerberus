import { api } from "./api";
import type { CodexMessage, CodexThread } from "../types";

export type Provider = "codex" | "cursor" | "copilot" | "claude";
export type Thread = CodexThread & { provider: Provider; key: string };
export type ThreadList = { threads: Thread[]; cursors: Partial<Record<Provider, string | null>>; error: string };
export type MessageCache = { updatedAt: number; messages: CodexMessage[]; nextCursor?: string | null };

const lists = new Map<string, ThreadList>();
const messageStore = new Map<string, MessageCache>();
const messageOrder: string[] = [];
const listInflight = new Map<string, Promise<ThreadList>>();
const messageInflight = new Map<string, Promise<MessageCache>>();
const listeners = new Set<() => void>();
const settledCursor = new Map<string, number>();

export const providerName = (provider: Provider) => ({ codex: "Codex", cursor: "Cursor", copilot: "Copilot", claude: "Claude" })[provider];
/** Providers mix unix seconds and milliseconds. Compare both as milliseconds, newest first. */
export function updatedMillis(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 10_000_000_000 ? value : value * 1000;
}
export const ordered = (threads: Thread[]) => [...new Map([...threads].sort((a,b)=>updatedMillis(a.updatedAt)-updatedMillis(b.updatedAt)).map(thread=>[thread.key,thread])).values()].sort((a, b) => updatedMillis(b.updatedAt) - updatedMillis(a.updatedAt) || a.key.localeCompare(b.key));
export const listKey = (repositoryId: string, archived: boolean, enabled: Provider[]) => `${repositoryId}:${archived ? "1" : "0"}:${enabled.join(",")}`;
export const messageKey = (repositoryId: string, threadKey: string) => `${repositoryId}:${threadKey}`;
export const messagesAreCurrent = (cached: MessageCache | undefined, threadUpdatedAt: number) => !!cached && cached.updatedAt >= threadUpdatedAt;
export const listFingerprint = (list?: ThreadList) => list ? `${list.error}|${list.threads.map((thread) => `${thread.key}:${thread.updatedAt}:${thread.working}`).join(";")}` : "";

function notify() { for (const listener of listeners) listener(); }
export function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function peekList(key: string) { return lists.get(key); }
export function repositoryHistoryWorking(repositoryId:string){
 for(const [key,list] of lists)if(key.startsWith(`${repositoryId}:`) && list.threads.some(thread=>thread.working))return true;
 return false;
}
export function peekMessages(key: string) { return messageStore.get(key); }

function threadListRequest(provider: Provider, repositoryId: string, archived: boolean, cursor?: string | null) {
  if (provider === "codex") return api.codexThreads(repositoryId, archived, cursor);
  if (provider === "cursor") return api.cursorThreads(repositoryId, archived, cursor);
  if (provider === "copilot") return api.copilotThreads(repositoryId, archived);
  return api.claudeThreads(repositoryId, archived);
}

export function readMessages(repositoryId: string, key: string, cursor?: string | null) {
  const separator = key.indexOf(":");
  const provider = key.slice(0, separator);
  const thread = key.slice(separator + 1);
  if (provider === "codex") return api.codexMessages(repositoryId, thread, cursor);
  if (provider === "cursor") return api.cursorMessages(repositoryId, thread);
  if (provider === "copilot") return api.copilotMessages(repositoryId, thread);
  return api.claudeMessages(repositoryId, thread);
}

export async function refreshThreadList(repositoryId: string, archived: boolean, enabled: Provider[], only?: Provider): Promise<ThreadList> {
  const key = listKey(repositoryId, archived, enabled);
  const inflightKey = only ? `${key}:${only}` : key;
  const pending = listInflight.get(inflightKey);
  if (pending) return pending;
  const targets = only ? enabled.filter((provider) => provider === only) : enabled;
  const work = (async () => {
    const prior = lists.get(key);
    let threads: Thread[] = prior?.threads.filter(thread => enabled.includes(thread.provider)) ?? [];
    const cursors: Partial<Record<Provider, string | null>> = { ...prior?.cursors };
    const errors: string[] = prior && only ? prior.error.split("\n").filter((line) => line && !line.startsWith(`${providerName(only)}:`)) : [];
    await Promise.all(targets.map(async provider => {
      try {
        const page = await threadListRequest(provider, repositoryId, archived);
        const nextThreads = page.data.map(thread => settleThread({ ...thread, provider, key: `${provider}:${thread.id}` }));
        threads = [...threads.filter(thread => thread.provider !== provider), ...nextThreads];
        cursors[provider] = page.nextCursor;
        const partial: ThreadList = { threads: ordered(threads), cursors: { ...cursors }, error: errors.join("\n") };
        const changed = listFingerprint(lists.get(key)) !== listFingerprint(partial);
        lists.set(key, partial);
        if (changed) notify();
      } catch (error) { errors.push(`${providerName(provider)}: ${String(error)}`); }
    }));
    const next: ThreadList = { threads: ordered(threads), cursors, error: errors.join("\n") };
    lists.set(key, next); notify();
    return next;
  })();
  listInflight.set(inflightKey, work);
  try { return await work; } finally { listInflight.delete(inflightKey); }
}

function settleThread(thread: Thread): Thread {
  if (thread.provider !== "cursor" || !thread.working) return thread;
  const settledAt = settledCursor.get(thread.key);
  if (settledAt === undefined) return thread;
  // The completion record can land just after the desktop notification. A later checkpoint is a new run.
  if (updatedMillis(thread.updatedAt) > settledAt + 5000) {
    settledCursor.delete(thread.key);
    return thread;
  }
  return { ...thread, working: false };
}
export function settleCursorActivity() {
  const settledAt = Date.now();
  let changed = false;
  for (const [key, list] of lists) {
    if (!list.threads.some((thread) => thread.provider === "cursor" && thread.working)) continue;
    lists.set(key, { ...list, threads: list.threads.map((thread) => {
      if (thread.provider !== "cursor" || !thread.working) return thread;
      settledCursor.set(thread.key, settledAt);
      changed = true;
      return { ...thread, working: false };
    }) });
  }
  if (changed) notify();
}
function parseListKey(key: string) {
  const archivedAt = key.indexOf(":");
  const providersAt = key.indexOf(":", archivedAt + 1);
  if (archivedAt < 1 || providersAt < 0) return undefined;
  const enabled = key.slice(providersAt + 1).split(",").filter((provider): provider is Provider => provider === "codex" || provider === "cursor" || provider === "copilot" || provider === "claude");
  return { repositoryId: key.slice(0, archivedAt), archived: key.slice(archivedAt + 1, providersAt) === "1", enabled };
}
export function watchCursorCompletion() {
  if (!("__TAURI_INTERNALS__" in window)) return () => {};
  let stop = false;
  let unlisten: (() => void) | undefined;
  void import("@tauri-apps/api/event").then(({ listen }) => listen("cursor-agent-settled", () => {
    settleCursorActivity();
    for (const key of [...lists.keys()]) {
      const parsed = parseListKey(key);
      if (!parsed?.enabled.includes("cursor")) continue;
      void refreshThreadList(parsed.repositoryId, parsed.archived, parsed.enabled, "cursor").catch(() => {});
    }
  })).then((fn) => { if (stop) fn(); else unlisten = fn; });
  return () => { stop = true; unlisten?.(); };
}
function retainMessages(key: string) {
  const index = messageOrder.indexOf(key);
  if (index >= 0) messageOrder.splice(index, 1);
  messageOrder.push(key);
  while (messageOrder.length > 4) {
    const oldest = messageOrder.shift();
    if (oldest) messageStore.delete(oldest);
  }
}

function transcriptMark(messages: CodexMessage[]) {
  let chars = 0;
  for (const message of messages) chars += message.text.length;
  const last = messages[messages.length - 1];
  return `${messages.length}:${last?.id ?? ""}:${chars}`;
}

export async function refreshMessages(repositoryId: string, thread: Thread, force = false): Promise<MessageCache> {
  const key = messageKey(repositoryId, thread.key);
  const cached = messageStore.get(key);
  if (!force && messagesAreCurrent(cached, thread.updatedAt)) return cached!;
  const pending = messageInflight.get(key);
  if (pending) return pending;
  const work = (async () => {
    const page = await readMessages(repositoryId, thread.key);
    const next: MessageCache = { updatedAt: thread.updatedAt, messages: page.data, nextCursor: page.nextCursor };
    const previous = messageStore.get(key);
    messageStore.set(key, next);
    retainMessages(key);
    if (!previous || previous.updatedAt !== next.updatedAt || previous.nextCursor !== next.nextCursor || transcriptMark(previous.messages) !== transcriptMark(next.messages)) notify();
    return next;
  })();
  messageInflight.set(key, work);
  try { return await work; } finally { messageInflight.delete(key); }
}

export async function loadOlderMessages(repositoryId: string, thread: Thread, cursor: string | null | undefined): Promise<MessageCache> {
  const key = messageKey(repositoryId, thread.key);
  const page = await readMessages(repositoryId, thread.key, cursor);
  const previous = messageStore.get(key);
  const next: MessageCache = { updatedAt: previous?.updatedAt ?? thread.updatedAt, messages: [...page.data, ...(previous?.messages ?? [])], nextCursor: page.nextCursor };
  messageStore.set(key, next);
  retainMessages(key);
  notify();
  return next;
}

export async function loadOlderThreads(repositoryId: string, archived: boolean, enabled: Provider[], provider: Provider, cursor: string | null | undefined): Promise<ThreadList> {
  const key = listKey(repositoryId, archived, enabled);
  const page = await threadListRequest(provider, repositoryId, archived, cursor);
  const current = lists.get(key) ?? { threads: [], cursors: {}, error: "" };
  const extra = page.data.map((thread) => settleThread({ ...thread, provider, key: `${provider}:${thread.id}` })).filter((thread) => !current.threads.some((item) => item.key === thread.key));
  const next: ThreadList = { threads: ordered([...current.threads, ...extra]), cursors: { ...current.cursors, [provider]: page.nextCursor }, error: current.error };
  lists.set(key, next);
  notify();
  return next;
}

export async function warmRepository(repositoryId: string, enabled: Provider[], archived = false) {
  if (!enabled.length) return;
  const list = await refreshThreadList(repositoryId, archived, enabled);
  for (const thread of list.threads.slice(0, 8)) await refreshMessages(repositoryId, thread);
}
