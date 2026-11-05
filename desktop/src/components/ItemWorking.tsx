import {LoaderCircle} from 'lucide-react';
export function ItemWorking({names}:{names:string}){return names?<small className="item-agent-working" role="status" title={names}><LoaderCircle size={13} className="conversation-working"/>Working · {names}</small>:null;}
