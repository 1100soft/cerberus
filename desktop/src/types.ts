export type Identity = {
  id: string;
  label: string;
  gitName: string;
  gitEmail: string;
  color?: string;
  providerUsername?: string;
  connected?: boolean;
};

export type GithubDeviceFlow = {
  deviceCode: string; userCode: string; verificationUri: string;
  expiresIn: number; interval: number; clientId?: string;
};

export type Repository = {
  id: string;
  displayName: string;
  localPath: string;
  localPresent?: boolean;
  github?: GithubRepository;
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
  accessibleIdentityIds?: string[];
};

export type GithubAuthStatus = {
  browserSignIn: boolean;
  githubCli: boolean;
};

export type ImportResult = { repository: Repository; warnings: string[] };

export type RepositoryUpdate = {
  githubCreate?: {private:boolean};
  displayName: string;
  localPath: string;
  canonicalRemote?: string | null;
  hostType: string;
  defaultBranch?: string | null;
  identityId?: string | null;
  tags: string[];
};

export type Commit = { hash: string; author: string; email: string; committedAt: string; summary: string };

export type CodexAccount = { account: { type: string; email?: string; planType?: string } | null };
export type CodexThread = { id: string; name?: string; preview: string; cwd: string; updatedAt: number; working?: boolean; gitInfo?: { branch?: string } };
export type CodexThreadPage = { data: CodexThread[]; nextCursor?: string | null };
export type FileEdit = {path:string; kind:string; diff?:string; source?:string};
export type AgentStep={id?:string;kind:string;title:string;text:string;status?:string};
export type CodexMessage = { id: string; role: string; text: string; edits?:FileEdit[]; steps?:AgentStep[] };

export type CodexMessagePage = { data: CodexMessage[]; nextCursor?: string | null };

export type GithubRepository = { id: number; name: string; fullName: string; owner: string; private: boolean; htmlUrl: string; updatedAt?: string; pushedAt?: string; defaultBranch?: string; identityId: string };
export type GithubCatalog = { repositories: GithubRepository[]; warnings: string[]; failedIdentityIds?: string[] };
