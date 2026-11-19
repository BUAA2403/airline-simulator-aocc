import React from 'react';
import {noseTemplateFor,seatTemplates} from './cabin-template.mjs';
function primitives(items){return items.map(({tag,props,children},i)=>React.createElement(tag,{...Object.fromEntries(Object.entries(props).map(([k,v])=>[k==='class'?'className':k.replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v])),key:i},children?.length?primitives(children):undefined));}
export function CabinNose({family,x,y,width,height}){
 const template=noseTemplateFor(family);
 return <g className="plan-template-nose" transform={`translate(${x},${y+height}) rotate(-90) scale(${height/200},${width/template.height})`} data-template={template.key}>{primitives(template.geometry)}</g>;
}
export function SeatSymbol({cabin,id}){
 const t=seatTemplates[cabin];
 return <symbol id={id} viewBox={t.viewBox}>{primitives(t.geometry)}</symbol>;
}
