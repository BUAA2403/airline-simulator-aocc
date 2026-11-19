import templates from './cabin-templates.json' with {type:'json'};
const aliases={A340:'A330',DASH8:'Dash8',ARJ21:'COMAC909',C919:'COMAC919',ERJ:'EmbraerERJ',EJET:'EmbraerE'};
export function noseTemplateFor(family){const key=aliases[family]||family;return {key:templates.noses[key]?key:'default',...(templates.noses[key]||templates.noses.default)};}
export const seatTemplates=templates.seats;
