export const WORKSPACES=[
 {id:'operations',label:'运行控制',en:'OPERATIONS CONTROL',views:['control','map','overview']},
 {id:'fleet',label:'机队与客舱',en:'FLEET & CABIN',views:['fleet','cabins'],shortcuts:['planner']},
 {id:'planner',label:'排班助手',en:'SCHEDULE ASSISTANT',views:['planner']},
 {id:'network',label:'航线与班表',en:'NETWORK & SCHEDULE',views:['routes','timetable']},
 {id:'analytics',label:'经营分析',en:'ANALYTICS',views:['analytics']},
];
export const VIEW_LABELS={control:'调度工作台',map:'航班地图',overview:'运行简报',fleet:'机队调度',cabins:'客舱与运力',planner:'排班助手',routes:'航线网络',timetable:'每周航班计划',analytics:'经营分析'};
export const workspaceFor=view=>WORKSPACES.find(w=>w.views.includes(view));
