import { ClaudeIcon, CursorIcon } from './Icons';
export function ExternalProviderIcon({provider}:{provider:'cursor'|'claude'}){
 return provider==='cursor'?<CursorIcon/>:<ClaudeIcon/>;
}
