import { FolderSearch } from "lucide-react";
import { api } from "../lib/api";
import type { Identity } from "../types";

export const hosts = ["github", "gitlab", "bitbucket", "local", "custom"] as const;

export function detectHost(remote: string) {
  const value = remote.toLowerCase();
  if (!value) return "local";
  if (value.includes("github.com")) return "github";
  if (value.includes("gitlab.com")) return "gitlab";
  if (value.includes("bitbucket.org")) return "bitbucket";
  return "custom";
}

export type RepositoryFormValue = {
  displayName: string;
  localPath: string;
  canonicalRemote: string;
  hostType: string;
  defaultBranch: string;
  identityId: string;
  tags: string;
};

type Props = {
  value: RepositoryFormValue;
  identities: Identity[];
  onChange: (value: RepositoryFormValue) => void;
  browseTitle?: string;
};

export function RepositoryFields({ value, identities, onChange, browseTitle }: Props) {
  async function browse() {
    const path = await api.selectRepositoryDirectory();
    if (path) onChange({ ...value, localPath: path });
  }

  return <div className="config-grid">
    <label>Display name<input value={value.displayName} onChange={(e) => onChange({ ...value, displayName: e.target.value })} required /></label>
    <label>Host type<select value={value.hostType} onChange={(e) => onChange({ ...value, hostType: e.target.value })}>{hosts.map((host) => <option key={host} value={host}>{host}</option>)}</select></label>
    <label className="full">Local path
      <span className="path-field">
        <input value={value.localPath} onChange={(e) => onChange({ ...value, localPath: e.target.value })} required />
        <button type="button" onClick={browse} title={browseTitle ?? "Choose folder"}><FolderSearch size={16} /></button>
      </span>
    </label>
    <label className="full">Remote URL
      <input value={value.canonicalRemote} onChange={(e) => onChange({ ...value, canonicalRemote: e.target.value, hostType: detectHost(e.target.value) })} placeholder="https://github.com/owner/repo.git" />
    </label>
    <label>Default branch<input value={value.defaultBranch} onChange={(e) => onChange({ ...value, defaultBranch: e.target.value })} placeholder="main" /></label>
    <label>Identity<select value={value.identityId} onChange={(e) => onChange({ ...value, identityId: e.target.value })}>
      <option value="">Unassigned</option>
      {identities.map((identity) => <option key={identity.id} value={identity.id}>{identity.label}</option>)}
    </select></label>
    <label className="full">Tags<input value={value.tags} onChange={(e) => onChange({ ...value, tags: e.target.value })} placeholder="backend, production" /></label>
  </div>;
}

export function formToUpdate(value: RepositoryFormValue) {
  return {
    displayName: value.displayName.trim(),
    localPath: value.localPath.trim(),
    canonicalRemote: value.canonicalRemote.trim() || null,
    hostType: value.hostType,
    defaultBranch: value.defaultBranch.trim() || null,
    identityId: value.identityId || null,
    tags: value.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
  };
}
