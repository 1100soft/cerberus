import type {SavedPrompt,Trigger} from './savedPrompts';

export const validEmailRecipient = (value: string) => !value || /^[^\s<>,@]+@[^\s<>,@]+$/.test(value);
export const watchesEmail = (job: SavedPrompt) =>
  (job.conditionSets ?? [job.conditions ?? [job.trigger]]).some(set => set.includes('feedback'));
const folder = (job: SavedPrompt) =>
  job.feedbackPath?.filter(part => part !== '\0mailbox').join('/') || job.feedbackFolder || '';
const projects = (job: SavedPrompt) => job.repositoryIds?.length ? job.repositoryIds : [job.repositoryId];

const sets = (job: SavedPrompt) => job.conditionSets ?? [job.conditions ?? [job.trigger]];
const timing = new Set(['idleTime', 'afterIdle']);
const arrival = (set: Trigger[]) => set.filter(trigger => !timing.has(trigger));

export function triggerCompetitors(job: SavedPrompt, jobs: SavedPrompt[]) {
  return jobs.filter(other => other.id !== job.id &&
    (job.includeFutureRepositories || other.includeFutureRepositories ||
      projects(job).some(id => projects(other).includes(id))) &&
    sets(job).some(left => sets(other).some(right => {
      if (left.includes('manual') || right.includes('manual')) return false;
      const shared = arrival(left).filter(trigger => right.includes(trigger));
      if (!shared.length && !(left.every(trigger => timing.has(trigger)) && right.every(trigger => timing.has(trigger)))) return false;
      if (shared.includes('handoff') && job.handoffName?.toLowerCase() !== other.handoffName?.toLowerCase()) return false;
      if (shared.includes('feedback') && folder(job) && folder(other) && folder(job) !== folder(other)) return false;
      const github = ['commit', 'push', 'pullRequest', 'ciPass', 'ciFail'];
      if (shared.some(trigger => github.includes(trigger)) && !job.commitAllExcept && !other.commitAllExcept) {
        const a = (job.commitBranch || '*').split(',').map(value => value.trim());
        const b = (other.commitBranch || '*').split(',').map(value => value.trim());
        if (a.every(value => !value.includes('*')) && b.every(value => !value.includes('*')) && !a.some(value => b.includes(value))) return false;
      }
      return true;
    })));
}

export function triggerConflict(job: SavedPrompt, jobs: SavedPrompt[]) {
  return triggerCompetitors(job, jobs).some(other =>
    job.emailPriority === undefined || other.emailPriority === undefined);
}

export function compactPriorities(values: number[]) {
  const levels = [...new Set(values)].sort((a, b) => a - b);
  return values.map(value => levels.indexOf(value) + 1);
}

export function matchesRecipient(job: SavedPrompt, recipients: string[]) {
  return !job.emailRecipient || recipients.some(address => address.toLowerCase() === job.emailRecipient?.toLowerCase());
}


export function triggerPriorityGroup(job: SavedPrompt, jobs: SavedPrompt[]) {
  const group = [job];
  const visited = new Set([job.id]);
  for (const rule of group) {
    for (const other of triggerCompetitors(rule, jobs)) {
      if (visited.has(other.id)) continue;
      visited.add(other.id);
      group.push(other);
    }
  }
  return group;
}
