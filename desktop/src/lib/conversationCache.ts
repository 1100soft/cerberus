import { api } from "./api";
import type { CodexMessage, CodexThread } from "../types";

export type Provider = "codex" | "cursor" | "copilot" | "claude";
export type Thread = CodexThread & { provider: Provider; key: string };
export type ThreadList = { threads: Thread[]; cursors: Partial<Record<Provider, string | null>>; error: string };
export type MessageCache = { updatedAt: number; messages: CodexMessage[]; nextCursor?: string | null };

const lists = new Map<string, ThreadList>();
const messageStore = new Map<string, MessageCache>();
const listInflight = new Map<string, Promise<ThreadList>>();
const messageInflight = new Map<string, Promise<MessageCache>>();
const listeners = new Set<() => void>();

export const providerName = (provider: Provider) => ({ codex: "Codex", cursor: "Cursor", copilot: "Copilot", claude: "Claude" })[provider];
export const ordered = (threads: Thread[]) => [...threads].sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));
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

export async function refreshThreadList(repositoryId: string, archived: boolean, enabled: Provider[]): Promise<ThreadList> {
  const key = listKey(repositoryId, archived, enabled);
  const pending = listInflight.get(key);
  if (pending) return pending;
  const work = (async () => {
    const prior = lists.get(key);
    const threads: Thread[] = prior?.threads.filter(thread => enabled.includes(thread.provider)) ?? [];
    const cursors: Partial<Record<Provider, string | null>> = { ...prior?.cursors };
    const errors: string[] = [];
    await Promise.all(enabled.map(async provider => {
      try {
        const page = await threadListRequest(provider, repositoryId, archived);
        const nextThreads = page.data.map(thread => ({ ...thread, provider, key: `${provider}:${thread.id}` }));
        threads.splice(0, threads.length, ...threads.filter(thread => thread.provider !== provider), ...nextThreads);
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
  listInflight.set(key, work);
  try { return await work; } finally { listInflight.delete(key); }
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
    if (!previous || previous.updatedAt !== next.updatedAt || previous.messages.length !== next.messages.length || previous.nextCursor !== next.nextCursor) notify();
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
  notify();
  return next;
}

export async function loadOlderThreads(repositoryId: string, archived: boolean, enabled: Provider[], provider: Provider, cursor: string | null | undefined): Promise<ThreadList> {
  const key = listKey(repositoryId, archived, enabled);
  const page = await threadListRequest(provider, repositoryId, archived, cursor);
  const current = lists.get(key) ?? { threads: [], cursors: {}, error: "" };
  const extra = page.data.map((thread) => ({ ...thread, provider, key: `${provider}:${thread.id}` as const })).filter((thread) => !current.threads.some((item) => item.key === thread.key));
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
