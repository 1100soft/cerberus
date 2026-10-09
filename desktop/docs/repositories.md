# Repository creation and GitHub accounts

Use **Add repository → Create new repository**, enter a display name and local
folder, and choose **github** as the host. **Create remote repository on GitHub**
is enabled by default. Select the GitHub account and visibility (private by
default). Without a remote URL, the destination uses that account's username and
the display name, replacing unsupported characters with hyphens. Enter an
organization repository URL to create under an organization instead.

Cerberus initializes the local repository, creates an empty GitHub repository,
and configures `origin` and the selected identity. It does not commit or push
files. Turn off remote creation to link an existing remote instead. Creation
requires a connected account with repository-creation permissions and, for an
organization, permission under that organization's policies.

If remote creation fails after local initialization, the local repository and
files remain available, and the app displays a warning. Open its configuration
to retry. If the request's outcome was uncertain, check GitHub first; if the
remote exists, turn off remote creation and enter its URL to link it. Existing
remote repositories are never overwritten or automatically adopted.

GitHub accounts remain available in the assignment list even when a repository
is new or absent from the cached GitHub catalog. Assignment checks access with
GitHub directly; appearing in the list does not grant repository access.
