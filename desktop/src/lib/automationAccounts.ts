import type { Repository, Identity } from '../types';
import type { AgentProfile } from './agentChats';
import type { Provider } from './conversationCache';
import { assignedChatgpt, repositoryAccountKey, type AccountSettings } from './chatgptAccounts';
import { assignedExternalIdentity, type ExternalIdentity, type Settings } from './externalIdentities';

export type AutomationAccount={profile:AgentProfile;route:'profile'|'identity'};
export function automationAccount(repository:Repository,provider:Provider,profiles:AgentProfile[],chatgptSettings:AccountSettings,external:{identities:ExternalIdentity[];settings:Settings},identities:Identity[]):AutomationAccount|undefined{
  const key=repositoryAccountKey(repository);
  if(provider==='codex'){
    const id=assignedChatgpt(chatgptSettings,key);
    const profile=profiles.find(item=>item.provider==='codex'&&!item.disconnected&&item.id===id);
    return profile?{profile,route:'profile'}:undefined;
  }
  if(provider==='copilot'){
    const id=repository.identity?.id;
    if(!id)return undefined;
    const identity=identities.find(item=>item.id===id)||repository.identity;
    return {profile:{id,label:identity?.label||id,provider},route:'identity'};
  }
  const id=assignedExternalIdentity(external.settings,provider,key);
  const identity=external.identities.find(item=>item.id===id&&item.provider===provider&&item.connected);
  if(identity)return {profile:{id:identity.id,label:identity.label,provider},route:'identity'};
  if(provider==='cursor'){
    const candidates=profiles.filter(item=>item.provider==='cursor'&&!item.disconnected);
    if(candidates.length===1)return {profile:candidates[0],route:'profile'};
  }
}
