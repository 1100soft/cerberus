export const checkpointCommitPrompt = `Create a checkpoint commit for the work in this repository. Follow the repository's agent instructions and complete every step below before committing:

1. Review the current task, working tree, Git status, and diff. Identify the files that belong to this work and inspect them for unfinished edits, errors, secrets, generated artifacts, and unrelated changes.
2. Finish or correct the implementation as needed. Update all documentation affected by the changes, including relevant README, usage, architecture, and handoff notes. Keep examples and descriptions consistent with the code.
3. Ensure code quality: format changed files, run the project's applicable lint and type checks, and review the diff for clarity, consistency, and accidental changes.
4. Run the relevant automated tests and build or validation commands for the changed behavior. Add or update meaningful tests where needed. Resolve failures and rerun the affected checks. If a check cannot run, explain why and do not claim it passed.
5. Review Git status and the final diff again. Stage only the files for this checkpoint, inspect the staged diff, and create a concise commit message describing the change.
6. Report the commit hash, commit message, checks run with their results, and any remaining limitations or unstaged changes.`;
