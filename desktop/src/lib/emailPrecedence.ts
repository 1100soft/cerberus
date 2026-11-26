import type {SavedPrompt} from './savedPrompts';

export const validEmailRecipient = (value: string) => !value || /^[^\s<>,@]+@[^\s<>,@]+$/.test(value);
export const watchesEmail = (job: SavedPrompt) =>
  (job.conditionSets ?? [job.conditions ?? [job.trigger]]).some(set => set.includes('feedback'));
const folder = (job: SavedPrompt) =>
  job.feedbackPath?.filter(part => part !== '\0mailbox').join('/') || job.feedbackFolder || '';
const projects = (job: SavedPrompt) => job.repositoryIds?.length ? job.repositoryIds : [job.repositoryId];

export function emailCompetitors(job: SavedPrompt, jobs: SavedPrompt[]) {
  if (!watchesEmail(job)) return [];
  return jobs.filter(other => other.id !== job.id && watchesEmail(other) &&
    (job.includeFutureRepositories || other.includeFutureRepositories ||
      projects(job).some(id => projects(other).includes(id))) &&
    (!folder(job) || !folder(other) || folder(job) === folder(other)));
}

// A message can list multiple recipients, so distinct address filters can overlap.
export function emailConflict(job: SavedPrompt, jobs: SavedPrompt[]) {
  return emailCompetitors(job, jobs).some(other =>
    job.emailPriority === undefined || other.emailPriority === undefined || job.emailPriority === other.emailPriority);
}

export function matchesRecipient(job: SavedPrompt, recipients: string[]) {
  return !job.emailRecipient || recipients.some(address => address.toLowerCase() === job.emailRecipient?.toLowerCase());
}


export function emailPriorityGroup(job: SavedPrompt, jobs: SavedPrompt[]) {
  const group = [job];
  const visited = new Set([job.id]);
  for (const rule of group) {
    for (const other of emailCompetitors(rule, jobs)) {
      if (visited.has(other.id)) continue;
      visited.add(other.id);
      group.push(other);
    }
  }
  return group;
}
