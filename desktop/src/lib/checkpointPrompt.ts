export const defaultCheckpointCommitPrompt = `Create a checkpoint commit for the work you have been performing in this task. Use your existing task context together with the repository state to prepare the repository for a coherent checkpoint.

Before committing:

1. Review the work you performed, the complete working tree, Git status, and diff. Account for every modified, deleted, and untracked file. Check for unfinished edits, errors, secrets, generated artifacts, and accidental changes. Investigate changes you do not recognize rather than silently excluding them.
2. Complete any remaining work necessary for the current task to form a coherent checkpoint. Do not expand the scope with unrelated improvements.
3. Update documentation affected by the changes where necessary. Keep documentation, examples, and descriptions consistent with the implementation.
4. Run the repository's applicable formatting, linting, type checking, tests, build, and other validation relevant to the changes. Address failures caused by the work. Do not claim a check passed if it could not be run.
5. Review the final Git status and diff. Resolve or explicitly account for anything that should not be committed, then stage all remaining intended changes. Inspect the staged diff and commit it with a concise message that accurately describes the checkpoint.
6. Do not push. Report the commit hash and message, validation performed and results, and anything deliberately left uncommitted with the reason.

Treat the repository state as authoritative if it differs from your recollection of the work.`;

const storageKey='gitcerberus.checkpointCommitPrompt.v1';
export function readCheckpointCommitPrompt(){try{return localStorage.getItem(storageKey)||defaultCheckpointCommitPrompt;}catch{return defaultCheckpointCommitPrompt;}}
export function saveCheckpointCommitPrompt(value:string){
  const next=value.trim();
  if(!next)throw new Error('Enter a checkpoint prompt.');
  if(next===defaultCheckpointCommitPrompt)localStorage.removeItem(storageKey);
  else localStorage.setItem(storageKey,next);
  if(readCheckpointCommitPrompt()!==next)throw new Error('The checkpoint prompt could not be saved on this device.');
  return next;
}
