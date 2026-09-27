import { Check, PlugZap, Unplug } from 'lucide-react';
import type { ReactNode } from 'react';
import { setIdentityInitials, useIdentityInitials } from '../lib/identityInitials';
function InitialsEditor({id,label}:{id:string;label:string}){
 const value=useIdentityInitials(id,label);
 return <label className="identity-initials-editor" title="Customize the initials on this account icon"><span>Initials</span><input aria-label={`Icon initials for ${label}`} maxLength={3} value={value} onChange={event=>setIdentityInitials(id,event.target.value)} /></label>;
}
export function IdentityCard({icon,label,detail,connected=true,busy=false,onConnect,onDisconnect,children,initialsId}:{icon:ReactNode;label:string;detail:string;connected?:boolean;busy?:boolean;onConnect:()=>void;onDisconnect:()=>void;children?:ReactNode;initialsId?:string}){
 return <div className="identity-card">{icon}<span className="identity-main"><span className="identity-title"><b>{label}</b>{initialsId && <InitialsEditor id={initialsId} label={label}/>}</span><small>{detail}</small></span><div className="identity-actions"><span className={connected?'connected':'disconnected'}>{connected?<><Check size={16}/>Connected</>:'Disconnected'}</span><button type="button" disabled={busy} onClick={connected?onDisconnect:onConnect}>{connected?<><Unplug size={15}/>Disconnect</>:<><PlugZap size={15}/>Reconnect</>}</button></div>{children}</div>;
}
