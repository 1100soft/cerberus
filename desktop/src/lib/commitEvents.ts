/** Reflog actions that create a local commit, rather than import existing history. */
export function createsLocalCommit(reflog:string){
  return /^(commit|merge|cherry-pick)(?:\b|\s*\()/i.test(reflog)
    && !/^merge\b.*:\s*fast-forward\b/i.test(reflog);
}
