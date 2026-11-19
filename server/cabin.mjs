import {readFileSync} from 'node:fs';
const data=JSON.parse(readFileSync(new URL('./data/cabin-reference.json',import.meta.url),'utf8'));
const functions=JSON.parse(readFileSync(new URL('./data/cabin-bytecode.json',import.meta.url),'utf8'));
const types=JSON.parse(readFileSync(new URL('./data/aircraft-types.json',import.meta.url),'utf8'));
const env=[];
env[0]={aircraftData:Object.fromEntries(types.map(t=>[t.aircraft_model,t]))};env[1]=data;env[2]=data;
env[3]=['eco','premEco','biz','first'];env[5]=1e-9;env[7]=.05;env[8]=0;env[9]=0;env[10]=31;
env[11]=new Set(['regional','european']);env[12]='european';
env[25]={'Bombardier CRJ-550':50,'Bombardier CRJ-705':75};env[26]={'Boeing 737 MAX 8200':197};env[27]=new Set(['slim','super_slim']);env[28]=[28,30];
env[29]={'Airbus A320neo':{creditIn:34.5,seats:194},'ATR 72-600':{creditIn:27.5,seats:78},'Airbus A321-200':{creditIn:23.5,seats:230},'De Havilland Canada Dash 8 Q400':{creditIn:28,seats:90},'Boeing 737-900ER':{creditIn:1.5,seats:220}};
env[31]=new Set(['Airbus A350-900ULR','Airbus A350-1000ULR']);
const globals={Math,Object,Number,Error,parseInt,Set,HermesInternal:{concat(...args){return String(this)+args.join('');}}};
// Bounded interpreter for the 25 extracted PURE cabin functions only. No eval,
// network, filesystem, game APIs or other bytecode modules are exposed.
function run(fid,args,captured=env,depth=0){
 if(depth>30 || !functions[fid])throw new Error('Unsupported cabin function');
 const f=functions[fid],r=[],code=f.code,index=new Map(code.map((i,n)=>[i.p,n]));let pc=0,steps=0;
 const invoke=(fn,self,values)=>{if(typeof fn!=='function')throw new Error(`Invalid cabin call ${fid} at ${code[pc-1]?.p}`);return fn.apply(self,values);};
 while(pc<code.length){if(++steps>50000)throw new Error('Cabin calculation limit');const i=code[pc++],a=i.a,o=i.op,[d,b,c,e]=a;
 const jump=()=>{pc=index.get(i.p+d);if(pc===undefined)throw new Error('Invalid cabin branch');};
 if(o==='LoadParam')r[d]=args[b];
 else if(o==='GetParentEnvironment')r[d]=captured;
 else if(o==='LoadFromEnvironment')r[d]=r[b][c];
 else if(o==='StoreToEnvironment')r[d][b]=r[c];
 else if(o==='CreateTopLevelEnvironment')r[d]=[];
 else if(o==='Mov')r[d]=r[b];
 else if(o==='GetGlobalObject')r[d]=globals;
 else if(o==='LoadConstUndefined')r[d]=undefined;
 else if(o==='LoadConstNull')r[d]=null;
 else if(o==='LoadConstTrue')r[d]=true;
 else if(o==='LoadConstFalse')r[d]=false;
 else if(o==='LoadConstZero')r[d]=0;
 else if(o.startsWith('LoadConst'))r[d]=b==='__Infinity__'?Infinity:b==='__NegativeInfinity__'?-Infinity:b;
 else if(o==='NewObject')r[d]={};
 else if(o.startsWith('NewObjectWithBuffer')||o.startsWith('NewArrayWithBuffer'))r[d]=structuredClone(i.v);
 else if(o==='GetById'||o==='GetByIdShort'||o==='TryGetById')r[d]=r[b][e];
 else if(o==='GetByVal')r[d]=r[b][r[c]];
 else if(o==='GetByIndex')r[d]=r[b][c];
 else if(o==='PutOwnBySlotIdx')r[d][Object.keys(r[d])[c]]=r[b];
 else if(o==='PutByIdStrict'||o==='DefineOwnById')r[d][e]=r[b];
 else if(o==='PutByValStrict'||o==='DefineOwnByVal')r[d][r[b]]=r[c];
 else if(o==='Add'||o==='AddN')r[d]=r[b]+r[c];
 else if(o==='Sub'||o==='SubN')r[d]=r[b]-r[c];
 else if(o==='Mul'||o==='MulN')r[d]=r[b]*r[c];
 else if(o==='Div'||o==='DivN')r[d]=r[b]/r[c];
 else if(o==='Less')r[d]=r[b]<r[c];
 else if(o==='LessEq')r[d]=r[b]<=r[c];
 else if(o==='Greater')r[d]=r[b]>r[c];
 else if(o==='GreaterEq')r[d]=r[b]>=r[c];
 else if(o==='Eq')r[d]=r[b]==r[c];
 else if(o==='Neq')r[d]=r[b]!=r[c];
 else if(o==='StrictEq')r[d]=r[b]===r[c];
 else if(o==='CreateClosure'){const scope=r[b];r[d]=function(...v){return run(c,[this,...v],scope,depth+1);};}
 else if(o==='IteratorBegin')r[d]=r[b][Symbol.iterator]();
 else if(o==='IteratorNext'){const v=r[b].next();r[d]=v.value;if(v.done)r[b]=undefined;}
 else if(o==='IteratorClose'){}
 else if(o==='Call2'||o==='Call3'||o==='Call4')r[d]=invoke(r[b],r[c],a.slice(3).map(x=>r[x]));
 else if(o==='Call'){const base=f.frame-8;r[d]=invoke(r[b],r[base],Array.from({length:c-1},(_,n)=>r[base-1-n]));}
 else if(o==='CallBuiltin'&&b===46){const base=f.frame-8;r[d]=Object.assign(r[base-1],r[base-2]);}
 else if(o==='CreateThisForNew')r[d]={};
 else if(o==='Construct'){const base=f.frame-8;r[d]=Reflect.construct(r[b],Array.from({length:c-1},(_,n)=>r[base-1-n]));}
 else if(o==='SelectObject')r[d]=r[c]&&typeof r[c]==='object'?r[c]:r[b];
 else if(o==='Jmp'||o==='JmpLong')jump();
 else if(o==='JmpTrue'||o==='JmpTrueLong'){if(r[b])jump();}
 else if(o==='JmpFalse'){if(!r[b])jump();}
 else if(o.startsWith('J')){const kind=o.replace(/Long$/,'').replace(/N$/,'');const x=r[b],y=r[c];const yes=({JEqual:x==y,JNotEqual:x!=y,JStrictEqual:x===y,JStrictNotEqual:x!==y,JLess:x<y,JLessEqual:x<=y,JGreater:x>y,JGreaterEqual:x>=y,JNotGreater:!(x>y),JNotGreaterEqual:!(x>=y)})[kind];if(yes===undefined)throw new Error(`Unsupported ${o}`);if(yes)jump();}
 else if(o==='Ret')return r[d];
 else if(o==='Throw')throw r[d];
 else throw new Error(`Unsupported cabin opcode ${o}`);
 }
}
for(const [slot,id] of [[4,18428],[6,18430],[13,18433],[14,18434],[15,18435],[16,18436],[17,18437],[18,18438],[19,18439],[20,18440],[21,18441],[22,18442],[23,18443],[24,18449],[30,18450]])env[slot]=(...v)=>run(id,[undefined,...v]);
export function cabinConfiguration(a){
 const ratio=Object.fromEntries(env[3].map(k=>[k,Number(a[`${k}Ratio`])||0]));
 const result=run(18449,[undefined,a.aircraftModel,ratio,a.ecoProduct,a.ecoConfigType,a.ecoPitch,a.premEcoProduct,a.premEcoPitch,a.bizProduct,a.firstProduct,a.bizPitch,a.firstPitch]);
 const cabins=Object.fromEntries(env[3].map(k=>[k,result[k]]));
 const total=Object.values(cabins).reduce((s,c)=>s+c.numSeats,0);
 if(!Number.isInteger(total)||total<0||Object.values(cabins).some(c=>!Number.isInteger(c.numSeats)||c.numSeats<0))throw new Error('Invalid cabin result');
 return {cabins,capacity:total,capacitySource:'game-client-rules'};
}


