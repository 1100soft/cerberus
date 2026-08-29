export type Identity = {
  id: string;
  label: string;
  gitName: string;
  gitEmail: string;
  color?: string;
  providerUsername?: string;
};

export type GithubDeviceFlow = {
  deviceCode: string; userCode: string; verificationUri: string;
  expiresIn: number; interval: number; clientId?: string;
};

export type Repository = {
  id: string;
  displayName: string;
  localPath: string;
  canonicalRemote?: string;
  hostType: string;
  defaultBranch?: string;
  branch?: string;
  detached: boolean;
  stagedCount: number;
  modifiedCount: number;
  untrackedCount: number;
  ahead: number;
  behind: number;
  lastCommitSummary?: string;
  lastCommitAt?: string;
  identity?: Identity;
  identityMismatch: boolean;
  tags: string[];
  manualOrder: number;
};

export type GithubAuthStatus = {
  browserSignIn: boolean;
  githubCli: boolean;
};

export type ImportResult = { repository: Repository; warnings: string[] };

export type RepositoryUpdate = {
  displayName: string;
  localPath: string;
  canonicalRemote?: string | null;
  hostType: string;
  defaultBranch?: string | null;
  identityId?: string | null;
  tags: string[];
};
