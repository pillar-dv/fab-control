import reference from '../fab-model-reference.json';
import {equipment,processTool,processToolKinds} from './equipment';
import type {Action, ProcessStep, ProductId} from './simulation';

const baseKinds=['stocker','deposition','track','scanner','etch_strip'] as const;
export const machineKinds=[...baseKinds,...processToolKinds];
export type MachineKind=typeof machineKinds[number];
export interface Machine {id:string;kind:MachineKind;x:number;z:number;facing:0|180}
export type RailSide='north'|'east'|'south'|'west';
export const sides:Record<RailSide,string>={north:'북측',east:'동측',south:'남측',west:'서측'};
export interface LineLayout {machines:Machine[];steps:ProcessStep[];home:string;rails:Record<RailSide,boolean>;oht:boolean;fleetSize?:number}
export interface Issue {target:string;message:string}
const zones=reference.project_assumptions.reserved_zones;
export const supported:Record<Action,MachineKind>={deposit:'deposition',coat:'track',expose:'scanner',develop:'track',etch:'etch_strip',strip:'etch_strip',
  clean:'clean',ald:'ald',deep_etch:'deep_etch',implant:'implant',anneal:'anneal',metal:'pvd',plate:'plate',cmp:'cmp',inspect:'inspect',
  probe:'probe',bond:'bond',thin:'thin',optics:'track'};
export const actionNames:Record<Action,string>={deposit:'절연막 증착',coat:'감광막 도포',expose:'노광',develop:'현상',etch:'절연막 식각',strip:'감광막 제거',
  clean:'웨이퍼 세정',ald:'원자층 증착',deep_etch:'채널 홀 깊은 식각',implant:'이온 주입',anneal:'활성화 열처리',metal:'금속 증착',plate:'구리 충전',
  cmp:'CMP 평탄화',inspect:'광학 검사',probe:'웨이퍼 전기 검사',bond:'정렬·접합',thin:'후면 박형화',optics:'광학층 형성'};
const codes:Record<typeof baseKinds[number],string>={stocker:'STK',deposition:'CVD',track:'TRK',scanner:'LTH',etch_strip:'ETCH'};
export const accepts=(kind:MachineKind,action:Action)=>kind===supported[action]||(action==='strip'&&kind==='resist_strip');
export const kindFor=(id:string)=>id.replace(/-\d+$/,'') as MachineKind;
export const startsWithFilm=(product:ProductId)=>['mcu','cis','gpu'].includes(product);
export const maxFleet=6;
export const parkedCount=(line:LineLayout)=>line.oht?(line.fleetSize??1):0;
export function parkingBays(count:number){return [3.35,10,16,22,28,32].slice(0,count).map(x=>({x,z:9,enterX:Math.max(2.65,x-1.25),exitX:x+.65,mergeZ:7.5}));}
export function machineCode(m:Machine){return (processTool(m.kind)?.code??codes[m.kind as keyof typeof codes])+'-'+(m.id.split('-')[1]??'1').padStart(2,'0');}
export function machineName(m:Machine){return machineCode(m)+' · '+equipment[m.kind].name;}
export function footprint(kind:MachineKind):number[]{const tool=processTool(kind);return tool?[tool.width,5]:zones.find(z=>z.id===kind)!.reserved_width_depth_m;}
export function defaultLine(steps:ProcessStep[]):LineLayout{
  const machines=baseKinds.map(kind=>{
    const zone=zones.find(z=>z.id===kind)!,[w,d]=footprint(kind),[x,z]=zone.nw_corner_xz_m;
    return {id:kind,kind,x:x+w/2,z:z+d/2,facing:kind==='etch_strip'?180:0} as Machine;
  });
  const line:LineLayout={machines,steps:steps.map(s=>({...s})),home:'stocker',oht:true,fleetSize:3,rails:{north:true,east:true,south:true,west:true}};
  if(!steps.some(step=>processTool(kindFor(step.station))))return line;
  const ids=[...new Set(['stocker',...steps.map(s=>s.station)])];
  const groups=ids.filter(id=>id!=='scanner').map(id=>id==='track'&&ids.includes('scanner')?[id,'scanner']:[id]);
  const gap=.4,edges=[1.6,34.4];
  const widths=groups.map(group=>group.reduce((sum,id)=>sum+footprint(kindFor(id))[0],gap));
  const total=widths.reduce((a,b)=>a+b,0),capacity=edges[1]-edges[0]+gap;
  let arrangement=0,freeBay=-Infinity;
  for(let mask=1;mask<2**groups.length;mask+=2){
    const north=widths.reduce((sum,width,i)=>sum+((mask>>i)&1)*width,0),south=total-north;
    const spare=capacity-Math.min(north,south);
    if(north<=capacity&&south<=capacity&&spare>freeBay){arrangement=mask;freeBay=spare;}
  }
  if(!arrangement)throw new Error('공정 장비를 생산층의 두 열에 배치할 수 없습니다.');
  line.machines=[];
  for(const [i,group] of groups.entries()){
    const north=(arrangement>>i)&1;
    const row=north?0:1,facing=north?0:180,dir=north?1:-1,z=north?4.5:13.5;
    for(const id of group){
      const kind=kindFor(id),w=footprint(kind)[0];
      line.machines.push({id,kind,x:edges[row]+dir*w/2,z,facing});
      edges[row]+=dir*w;
    }
    edges[row]+=dir*gap;
  }
  line.fleetSize=4;
  return line;
}
export function nextId(line:LineLayout,kind:MachineKind){
  let i=2;while(line.machines.some(m=>m.id===kind+'-'+i))i++;
  return kind+'-'+i;
}
export function dockOf(m:Machine){
  const sign=m.facing===0?1:-1;
  const offset=m.kind==='stocker'?-.5:m.kind==='deposition'||m.kind==='track'?.5:0;
  return {x:m.x+sign*offset,y:.9,z:m.z+sign*(footprint(m.kind)[1]/2+.5)};
}
export function connectedTrack(scanner:Machine,line:LineLayout){
  const sign=scanner.facing===0?1:-1;
  return line.machines.find(m=>m.kind==='track'&&m.facing===scanner.facing&&Math.abs(m.z-scanner.z)<.001&&
    Math.abs(scanner.x-m.x-sign*(footprint('track')[0]+footprint('scanner')[0])/2)<.001);
}
export function overlaps(a:Machine,b:Machine){
  const [aw,ad]=footprint(a.kind),[bw,bd]=footprint(b.kind);
  return Math.abs(a.x-b.x)<(aw+bw)/2-.001&&Math.abs(a.z-b.z)<(ad+bd)/2-.001;
}
export function newMachine(line:LineLayout,kind:MachineKind){
  const id=nextId(line,kind),[w]=footprint(kind);
  if(kind==='scanner')for(const track of line.machines.filter(m=>m.kind==='track')){
    const m={id,kind,x:track.x+(track.facing===0?1:-1)*(w+footprint('track')[0])/2,z:track.z,facing:track.facing};
    if(m.x-w/2>=0&&m.x+w/2<=36&&!line.machines.some(other=>overlaps(m,other)))return m;
  }
  for(const facing of [180,0] as const)for(let x=w/2;x<=36-w/2;x+=.5){
    const m={id,kind,x,z:facing===180?13.5:4.5,facing};
    if(!line.machines.some(other=>overlaps(m,other))&&dockOf(m).x>=2.65&&dockOf(m).x<=33.35)return m;
  }
  return {id,kind,x:18,z:13.5,facing:180 as const};
}
export function issuesFor(line:LineLayout,product:ProductId):Issue[]{
  const issues:Issue[]=[];
  const issue=(target:string,message:string)=>issues.push({target,message});
  const fleet=parkedCount(line);
  if(!Number.isInteger(fleet)||fleet<1||fleet>maxFleet)issue('oht',`천장 운송차를 1~${maxFleet}대 배치하세요.`);
  for(const key of Object.keys(sides) as RailSide[])if(!line.rails[key])issue(key,sides[key]+' 레일이 끊겨 순환 주행할 수 없습니다.');
  if(!line.machines.some(m=>m.kind==='stocker'&&m.id===line.home))issue('home','출발·복귀에 사용할 스토커를 지정하세요.');
  line.machines.forEach((m,i)=>{
    const [w,d]=footprint(m.kind),p=dockOf(m);
    if(!Number.isFinite(m.x+m.z)||m.x-w/2<0||m.x+w/2>36||m.z-d/2<0||m.z+d/2>18)issue(m.id,'장비가 36 × 18 m 생산층을 벗어납니다.');
    for(const other of line.machines.slice(i+1))if(overlaps(m,other)){
      issue(m.id,machineCode(other)+'와 배치가 겹칩니다.');issue(other.id,machineCode(m)+'와 배치가 겹칩니다.');
    }
    if(m.kind==='scanner'){
      if(!connectedTrack(m,line))issue(m.id,'트랙과 노광기의 브리지 접점이 떨어져 있습니다.');
    }else if(p.z!==(m.facing===0?7.5:10.5)||p.x<2.65||p.x>33.35)
      issue(m.id,'포트가 직선 레일 아래에 오도록 북열 Z 4.5 m(0°) 또는 남열 Z 13.5 m(180°)에 맞추세요.');
  });
  if(!line.steps.length)issue('steps','가동할 공정을 한 단계 이상 추가하세요.');
  let film=startsWithFilm(product),metal=false,bonded=false,resist:'none'|'coat'|'expose'|'develop'='none';
  line.steps.forEach((s,i)=>{
    const target='step-'+s.id,m=line.machines.find(m=>m.id===s.station);
    if(!m||!accepts(m.kind,s.action))issue(target,(i+1)+'단계에 '+equipment[supported[s.action]].name+' 장비를 배정하세요.');
    const invalid=s.action==='coat'?resist!=='none':s.action==='expose'?resist!=='coat':s.action==='develop'?resist!=='expose':
      s.action==='etch'||s.action==='deep_etch'?resist!=='develop'||!film:s.action==='strip'?resist==='none':
      s.action==='plate'?!metal:s.action==='thin'?!bonded:s.action==='implant'?resist==='coat'||resist==='expose':
      ['deposit','ald','bond','metal','cmp','clean','anneal'].includes(s.action)&&resist!=='none';
    if(invalid)issue(target,(i+1)+'단계 '+actionNames[s.action]+'의 입력 단면이 앞 공정 결과와 맞지 않습니다.');
    if(s.action==='deposit'||s.action==='ald')film=true;
    if(s.action==='metal')metal=true;
    if(s.action==='bond')bonded=true;
    if(s.action==='coat'||s.action==='expose'||s.action==='develop')resist=s.action;
    if(s.action==='strip')resist='none';
  });
  return issues;
}
