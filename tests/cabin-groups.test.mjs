import test from 'node:test';import assert from 'node:assert/strict';
import {groupCabins} from '../web/cabin-groups.mjs';
const a={id:'a',type:'A320',capacity:150,cabins:{eco:{numSeats:150,numRows:25,config:'3-3',pitch:30,seatProduct:'standard'},first:{numSeats:0,seatProduct:'regional'}}};
test('identical operating cabins merge while inactive cabin settings do not split a layout',()=>{
 const b={...a,id:'b',cabins:{...a.cabins,first:{numSeats:0,seatProduct:'private_suite'}}},g=groupCabins([a,b]);assert.equal(g.length,1);assert.deepEqual(g[0].members.map(m=>m.id),['a','b']);assert.equal(g[0].capacity,150);
});
test('different seat products, pitches and aircraft models remain distinct configurations',()=>{
 const b={...a,id:'b',cabins:{eco:{...a.cabins.eco,pitch:31}}},c={...a,id:'c',cabins:{eco:{...a.cabins.eco,seatProduct:'slim'}}},d={...a,id:'d',type:'C919'};assert.equal(groupCabins([a,b,c,d]).length,4);
});
