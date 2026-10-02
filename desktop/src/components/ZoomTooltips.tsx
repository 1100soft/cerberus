import { useEffect } from 'react';

/** Browser chrome tooltips ignore the application's CSS zoom. */
export function useZoomTooltips(){
  useEffect(()=>{
    const popup=document.createElement('div');popup.className='zoom-tooltip';popup.setAttribute('role','tooltip');popup.hidden=true;document.body.append(popup);
    let owner:HTMLElement|null=null;
    const hide=()=>{if(owner){owner.setAttribute('title',owner.dataset.zoomTitle||'');delete owner.dataset.zoomTitle;owner=null;}popup.hidden=true;};
    const show=(target:EventTarget|null,event?:MouseEvent)=>{
      const element=target instanceof Element?target.closest<HTMLElement>('[title], [data-zoom-title]'):null;
      if(element===owner){if(event)position(event);return;}
      hide();if(!element)return;
      const title=element.getAttribute('title')||element.dataset.zoomTitle;if(!title)return;
      owner=element;element.dataset.zoomTitle=title;element.removeAttribute('title');popup.textContent=title;popup.hidden=false;
      if(event)position(event);else{const rect=element.getBoundingClientRect();position({clientX:rect.left,clientY:rect.bottom} as MouseEvent);}
    };
    const position=(event:MouseEvent)=>{
      const zoom=Number(getComputedStyle(document.body).zoom)||1;
      const width=popup.offsetWidth*zoom,height=popup.offsetHeight*zoom;
      popup.style.left=`${Math.max(8,Math.min(event.clientX+12,window.innerWidth-width-8))/zoom}px`;
      popup.style.top=`${Math.max(8,Math.min(event.clientY+16,window.innerHeight-height-8))/zoom}px`;
    };
    const move=(event:MouseEvent)=>show(event.target,event);
    const focus=(event:FocusEvent)=>show(event.target);
    document.addEventListener('mousemove',move,true);document.addEventListener('focusin',focus,true);
    document.addEventListener('pointerdown',hide,true);document.addEventListener('scroll',hide,true);
    return()=>{hide();popup.remove();document.removeEventListener('mousemove',move,true);document.removeEventListener('focusin',focus,true);document.removeEventListener('pointerdown',hide,true);document.removeEventListener('scroll',hide,true);};
  },[]);
  return null;
}
