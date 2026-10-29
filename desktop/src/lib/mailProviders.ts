import catalog from './mailProviders.json';
import type {MailboxConfig} from './feedback';
type Connection=Pick<MailboxConfig,'imapHost'|'imapPort'|'imapSecurity'|'smtpHost'|'smtpPort'|'smtpSecurity'>;
export type MailProvider={webmail:string;id:string;label:string;editable:boolean;certificate:boolean;auth:string;passwordLabel:string;help:string;documentation:string;passwordDocumentation:string;identityDocumentation?:string;settings:Connection};
export const mailProviders:MailProvider[]=catalog;
export const mailProvider=(id?:string)=>mailProviders.find(provider=>provider.id===id)||mailProviders[0];
export function normalizeMailbox(config:MailboxConfig):MailboxConfig{
 // Legacy configs are identified only by exact connection settings; never replace
 // a user's nonstandard endpoints, ports, certificate or security choices on load.
 const provider=mailProviders.find(item=>item.id===config.provider)||mailProviders.find(item=>item.id!=='custom'&&(Object.keys(item.settings) as (keyof Connection)[]).every(key=>config[key]===item.settings[key]));
 return {...config,autoSpecialFolders:config.autoSpecialFolders??(/(^|[/.])drafts$/i.test(config.drafts)&&/(^|[/.])sent$/i.test(config.sent)),provider:provider?.id||'custom'};
}
export function selectMailProvider(config:MailboxConfig,id:string):MailboxConfig{
 const provider=mailProvider(id);
 return {...config,...provider.settings,provider:provider.id,certificatePath:'',senderSync:null,webmailUrl:''};
}
export const connectionOverrides=(config:MailboxConfig)=>{
 const provider=mailProvider(config.provider);
 return (Object.keys(provider.settings) as (keyof Connection)[]).some(key=>config[key]!==provider.settings[key]);
};
export const mailboxAccountChanged=(before:MailboxConfig|null,after:MailboxConfig)=>!!before&&(['username','imapHost','smtpHost'] as const).some(key=>before[key]!==after[key]);

export function webmailUrlProblem(value:string){
 if(!value.trim())return '';
 try{const url=new URL(value.trim());if(url.protocol==='https:'&&url.hostname&&!url.username&&!url.password&&!/[\x00-\x1f\x7f]/.test(value)&&value.length<=4096)return '';}catch{/* Invalid URLs stay in the editable form. */}
 return 'Enter an HTTPS webmail URL without embedded credentials.';
}
export function mailboxWebmail(config:MailboxConfig){
 const custom=config.webmailUrl?.trim();
 return custom?(webmailUrlProblem(config.webmailUrl||'')?'':custom):mailProvider(normalizeMailbox(config).provider).webmail;
}
