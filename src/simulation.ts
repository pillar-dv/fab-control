import reference from '../fab-model-reference.json';
import {actionNames,connectedTrack,defaultLine,dockOf,issuesFor,machineName,parkedCount,parkingBays,startsWithFilm,supported,type LineLayout} from './line-layout';
import {processTool} from './equipment';
import type {MetricCycle,MetricTimeline,SpanMeasure} from './fab-metrics';

export type ProductId = 'baseline' | 'cpu' | 'dram' | 'mcu' | 'nand' | 'cis' | 'power' | 'analog' | 'gpu' | 'npu';
export type PortId = string;
export type StationId = string;
export type Action = 'deposit' | 'coat' | 'expose' | 'develop' | 'etch' | 'strip' | 'clean' | 'ald' | 'deep_etch' | 'implant' | 'anneal' |
  'metal' | 'plate' | 'cmp' | 'inspect' | 'probe' | 'bond' | 'thin' | 'optics';
export interface ProcessStep { id: string; label: string; station: StationId; action: Action; layers?:number }
export interface Product {
  id: ProductId; name: string; english: string; description: string;
  steps: ProcessStep[]; source: string; sourceLabel: string;
}
export interface Point { x: number; y: number; z: number }
export interface Material { layers: number; resist: 'none' | 'coated' | 'exposed' | 'developed'; etched: boolean; opening: number; protected: number;
  surface:'dielectric'|'metal'|'optical'; thinned:boolean }
export type EtchCondition = 'standard' | 'short';
const standardEtchSeconds = 4;
type EtchSettings = Map<string, EtchCondition>;
const etchKey = (lot:number,index:number) => lot + '/' + index;
export type WaferOwner = 'slot' | 'atmosphere_robot' | 'load_lock' | 'vacuum_robot' | 'chamber' | 'track_robot' | 'scanner_stage';
export interface WaferFrame { id: string; slot: number; position: Point; owner: WaferOwner; material: Material }
export interface CarrierFrame {
  id: string; station: PortId | null; phase: string; position: Point; doorOpen: number; rotationY: number;
  wafer: WaferFrame; activeStepIndex: number | null; completedSteps: number; completedTransfers: number; done: boolean;
}
export interface VehicleFrame {
  id:string; position: Point; hoistY: number; phase: string; carrierId: string | null; rotationY: number; busy:boolean;
}
export type EventKind = 'dispatch' | 'pickup' | 'delivery' | 'handoff' | 'process' | 'complete';
export interface FabEvent { time: number; carrierId: string; kind: EventKind; station: StationId; label: string }
export interface EquipmentFrame { status: 'idle' | 'reserved' | 'occupied' | 'processing'; carrierId: string | null }
export interface SceneFrame {
  productId: ProductId; time: number; duration: number; finished: boolean;
  cycle:number; events: FabEvent[]; carriers: CarrierFrame[]; vehicle: VehicleFrame; vehicles:VehicleFrame[];
  equipment: Record<StationId, EquipmentFrame>; stepsCompleted: number; transfersCompleted: number;
}
export type SimulationSnapshot = SceneFrame;

const baseline = reference.project_assumptions.wafer_steps.map(s => s.step as Action);
function steps(actions: Action[], prefix = ''): ProcessStep[] {
  return actions.map((action, i) => ({ id: prefix + action + '-' + i, label: prefix + actionNames[action], station: supported[action], action }));
}
const step=(action:Action,label=actionNames[action],station:StationId=supported[action],layers?:number):ProcessStep=>({id:action+'-'+label,label,station,action,layers});
export const PRODUCTS: Record<ProductId, Product> = {
  baseline: {id:'baseline',name:'절연막 패터닝',english:'Base Pattern',description:'기준 실습 · 절연막 한 층에 줄무늬를 형성합니다.',
    steps: steps(baseline), source:'https://www.asml.com/en/technology/all-about-microchips/how-microchips-are-made',sourceLabel:'ASML · 패턴 형성'},
  cpu: {id:'cpu',name:'CPU',english:'Logic Processor',description:'구리 배선층 모듈. 층간 절연막에 배선 홈을 만든 뒤 장벽·시드층을 증착하고 구리를 채워 평탄화합니다.',
    steps:[...steps(baseline).map(s=>s.action==='etch'?{...s,label:'배선 홈 식각'}:s),step('metal','배선 장벽·시드막 증착'),step('plate','배선 홈 구리 충전'),step('cmp','구리 과잉막 평탄화'),step('probe','배선 연속성 검사')],
    source:'https://ir.appliedmaterials.com/static-files/109fae11-37aa-4eb4-993a-f82f880dfc3b',sourceLabel:'Applied Materials · 구리 배선'},
  dram: {id:'dram',name:'DRAM',english:'Dynamic Memory',description:'셀 커패시터 모듈. 저장 노드의 패턴을 형성한 뒤 원자층 증착으로 유전체를 입히고 전극을 형성합니다.',
    steps:[...steps(baseline,'저장 노드 '),step('ald','커패시터 유전체 원자층 증착'),step('metal','상부 전극 금속 형성'),step('inspect','표면 결함 검사'),step('probe')],
    source:'https://www.micron.com/content/dam/micron/educatorhub/intro-to-memory/micron-intro-to-memory-presentation.pdf',sourceLabel:'Micron · DRAM 셀'},
  mcu: {id:'mcu',name:'차량용 MCU',english:'Automotive MCU',description:'내장 플래시 주변 회로 모듈. 절연막이 있는 웨이퍼에서 주변 회로를 패터닝하고 주입·활성화·금속화·전기 검사로 이어갑니다.',
    steps:[...steps(['coat','expose','develop','etch'],'주변 회로 '),step('implant','주변 회로 접합 주입'),step('strip'),step('anneal'),step('metal','배선 금속 형성'),step('probe')],
    source:'https://www.st.com/en/microcontrollers-microprocessors/spc58-e-line-mcus.html',sourceLabel:'ST · SPC58 E 내장 플래시'},
  nand: {id:'nand',name:'3D NAND',english:'Vertical NAND',description:'적층막을 쌓고 전용 깊은 식각기로 수직 채널 홀을 뚫습니다. 저장막과 전극을 형성하는 모듈을 발췌했습니다.',
    steps:[step('deposit','교대 적층막 증착','deposition',8),...steps(['coat','expose','develop']),step('deep_etch'),step('strip','채널 패턴 감광막 제거','resist_strip'),step('ald','채널 내부 저장막 형성'),step('metal','접점 금속 형성'),step('inspect')],
    source:'https://www.kioxia.com/en-jp/rd/technology/bics-flash.html',sourceLabel:'Kioxia · BiCS FLASH'},
  cis: {id:'cis',name:'적층 이미지 센서',english:'Stacked BSI Sensor',description:'준비된 픽셀 웨이퍼와 회로 웨이퍼를 정렬·접합하고 후면을 얇게 가공한 뒤 컬러 필터·마이크로렌즈와 검사 구역을 거칩니다.',
    steps:[step('clean','접합 전 표면 세정'),step('bond','픽셀·로직 웨이퍼 정렬·접합'),step('thin'),...steps(['coat','expose','develop'],'후면 광학창 '),step('strip','광학창 패턴 감광막 제거','resist_strip'),step('optics','컬러 필터·마이크로렌즈 형성'),step('inspect','센서 광학 검사'),step('probe')],
    source:'https://www.sony-semicon.com/en/technology/is/back-illuminated.html',sourceLabel:'Sony · 후면조사 구조'},
  power: {id:'power',name:'실리콘 전력 MOSFET',english:'Power MOSFET',description:'에피층이 준비된 300 mm 실리콘 웨이퍼에서 셀 가공, 주입·활성화, 앞면과 후면 전극, 전기 검사를 관찰합니다.',
    steps:[...steps(baseline.slice(0,-1),'전력 셀 '),step('implant','전력 셀 도핑 주입'),step('strip'),step('anneal'),step('metal','앞면 전극 금속화'),step('metal','후면 전극 금속화','pvd-2'),step('probe','전력소자 전기 검사')],
    source:'https://toshiba.semicon-storage.com/eu/semiconductor/design-development/innovationcentre/articles/TCM0770_Excellence_in_Power_video_interview.html',sourceLabel:'Toshiba · 실리콘 전력소자'},
  analog: {id:'analog',name:'아날로그·전력 IC',english:'BCD Mixed Signal',description:'아날로그·디지털·전력 소자가 함께 들어가는 BCD 라인의 발췌입니다. 마스크 개구부로 웰을 주입하고 감광막을 제거한 뒤 열처리합니다.',
    steps:[step('clean'),step('deposit','웰 패턴용 스크린 산화막 형성'),...steps(['coat','expose','develop'],'웰 '),step('implant','웰 영역 이온 주입'),step('strip','주입 마스크 제거','resist_strip'),step('anneal'),step('metal'),step('probe','아날로그·전력 특성 검사')],
    source:'https://www.hkexnews.hk/listedco/listconews/sehk/2025/0408/2025040800831.pdf',sourceLabel:'Hua Hong · BCD 공정 포트폴리오'},
  gpu: {id:'gpu',name:'GPU',english:'Data Center GPU',description:'절연막이 준비된 실리콘 인터포저에서 데이터센터 GPU용 구리 재배선층을 형성합니다. 이 층은 첨단 패키지에서 연산 다이와 고대역폭 메모리(HBM)를 연결합니다. GPU·HBM 조립은 후공정에 해당합니다.',
    steps:[...steps(['coat','expose','develop','etch','strip'],'인터포저 '),step('metal','인터포저 장벽·시드막 증착'),step('plate','인터포저 구리 배선 충전'),step('cmp','인터포저 배선 평탄화'),step('clean','평탄화 후 잔류물 세정'),step('inspect','인터포저 배선 결함 검사'),step('probe','인터포저 배선 연속성 검사')],
    source:'https://3dfabric.tsmc.com/english/dedicatedFoundry/technology/cowos.htm',sourceLabel:'TSMC · CoWoS와 인터포저'},
  npu: {id:'npu',name:'NPU',english:'Edge AI NPU',description:'엣지 AI 가속기가 내장된 SoC에서 플립칩 조립에 앞서 웨이퍼 접점을 준비하는 모듈입니다. 표면 보호막의 접점 개구를 형성하고 접점 금속과 웨이퍼를 검사합니다.',
    steps:[step('deposit','SoC 최상층 보호 절연막 형성'),...steps(['coat','expose','develop'],'접점 개구 '),
      step('etch','보호막 접점 개구 식각'),step('strip'),step('clean','노출된 접점 표면 세정'),
      step('metal','플립칩용 범프 하부 금속 형성'),step('inspect','접점 개구와 금속막 광학 검사'),step('probe','엣지 SoC 웨이퍼 전기 검사')],
    source:'https://www.nxp.com/docs/en/data-sheet/IMX93CEC.pdf',sourceLabel:'NXP · i.MX 93 엣지 SoC와 패키지'},
};

const point = (x: number, y: number, z: number): Point => ({x,y,z});
const mix = (a: number,b: number,t: number) => a + (b-a)*t;
const blend = (a: Point,b: Point,t: number): Point => point(mix(a.x,b.x,t),mix(a.y,b.y,t),mix(a.z,b.z,t));
const ease = (t: number) => t*t*(3-2*t);
const limit = (v: number,min: number,max: number) => Math.min(max,Math.max(min,v));
const rail = reference.project_assumptions.rail;
const podHeight = reference.published_model_specs.carrier.height_m;
const travelY = rail.elevation_y_m - 0.82;
const carrierIds = ['FOUP-01','FOUP-02'];
const originalSlots = [13,8];
function routeGeometry(line:LineLayout){
  const machines=Object.fromEntries(line.machines.map(m=>[m.id,m]));
  const docks=Object.fromEntries(line.machines.map(m=>[m.id,dockOf(m)]));
  const home=line.home,sign=(id:string)=>machines[id].facing===0?1:-1;
  const rack=(lot:number)=>point(docks[home].x+sign(home)*(lot===0?-.75:.75),.9,docks[home].z-sign(home)*1.3);
  const portFor=(s:ProcessStep)=>s.action==='expose'?connectedTrack(machines[s.station],line)!.id:s.station;
  return {machines,docks,sign,home,rack,portFor,bays:parkingBays(parkedCount(line)),railTime:(station:string)=>railCoordinate(docks[station].x,docks[station].z)};
}
type RouteGeometry=ReturnType<typeof routeGeometry>;

// Distances run clockwise from the northwest tangent; curved sections use their own speed.
const [xmin,xmax] = rail.loop_extents_x_m;
const [zmin,zmax] = rail.loop_extents_z_m;
const radius=0.65;
type RailSection={length:number;speed:number;pose:(u:number)=>{x:number;z:number;angle:number}};
function line(x:number,z:number,dx:number,dz:number,angle:number):RailSection {
  return {length: Math.hypot(dx,dz),speed:rail.straight_speed_m_s,pose:u=>({x:x+dx*u,z:z+dz*u,angle})};
}
function arc(cx:number,cz:number,start:number):RailSection {
  return {length: Math.PI*radius/2,speed:rail.curve_speed_m_s,pose:u=>{
    const a=start+u*Math.PI/2; return {x:cx+radius*Math.cos(a),z:cz+radius*Math.sin(a),angle:a+Math.PI/2};
  }};
}
const long=xmax-xmin-2*radius, short=zmax-zmin-2*radius;
const sections=[
  line(xmin+radius,zmin,long,0,0),arc(xmax-radius,zmin+radius,-Math.PI/2),
  line(xmax,zmin+radius,0,short,Math.PI/2),arc(xmax-radius,zmax-radius,0),
  line(xmax-radius,zmax,-long,0,Math.PI),arc(xmin+radius,zmax-radius,Math.PI/2),
  line(xmin,zmax-radius,0,-short,Math.PI*1.5),arc(xmin+radius,zmin+radius,Math.PI)
];
const circuitTime=sections.reduce((sum,s)=>sum+s.length/s.speed,0);
const southStart=sections.slice(0,4).reduce((sum,s)=>sum+s.length/s.speed,0);
const railCoordinate=(x:number,z:number)=>z===zmin?(x-xmin-radius)/rail.straight_speed_m_s:southStart+(xmax-radius-x)/rail.straight_speed_m_s;
const railTravel=(a:number,b:number)=>((b-a)%circuitTime+circuitTime)%circuitTime;
function poseAt(t:number){
  let rem=(t%circuitTime+circuitTime)%circuitTime;
  for(const s of sections){const dt=s.length/s.speed;if(rem<=dt)return s.pose(rem/dt);rem-=dt;}
  return sections[0].pose(0);
}

interface Segment {
  from:number;to:number;start:Point;end:Point;owner:WaferOwner;label:string;
  station:StationId;active:number|null;doorStart:number;doorEnd:number;completes?:number;
}
interface RailKnot {time:number;at:number}
interface Trip {
  vehicle:number;source:PortId;dest:PortId;start:number;merged:number;atSource:number;grip:number;lifted:number;
  atDest:number;released:number;end:number;divert:number;parked:number;motion:RailKnot[];
}
interface Move extends Trip {lot:number;ready:number;requested:number;queueFrom:number;work:Segment[]}
interface Schedule {moves:Move[];events:FabEvent[];duration:number;geo:RouteGeometry}
const slotPoint=(lot:number,base:Point):Point => point(base.x,base.y+0.04+(originalSlots[lot]-1)*reference.published_model_specs.carrier.slot_pitch_m,base.z);
function workPlan(lot:number,at:PortId,start:number,indices:number[],product:Product,events:FabEvent[],settings:EtchSettings,geo:RouteGeometry):Segment[] {
  const list:Segment[]=[];const dock=geo.docks[at],kind=geo.machines[at].kind,sign=geo.sign(at);
  const slot=slotPoint(lot,dock),anchor=(depth:number,offset=0)=>point(dock.x+offset*sign,slot.y,dock.z-sign*depth);
  const lock=anchor(1.65),vacuum=anchor(2.45),align=anchor(0.95),center=anchor(3.55);
  const firstCoat=anchor(2.25,-0.75);
  const family=processTool(kind)?.family;
  const usesVacuum=kind==='etch_strip'||kind==='deposition'||family==='vacuum';
  const handler=kind==='track'?'track_robot':'atmosphere_robot';
  let time=start,position=slot,door=0;
  const add=(dt:number,to:Point,owner:WaferOwner,label:string,station:StationId,active:number|null,doorEnd=door,completes?:number)=>{
    list.push({from:time,to:time+dt,start:position,end:to,owner,label,station,active,doorStart:door,doorEnd,completes});
    position=to;time+=dt;door=doorEnd;
  };
  add(1,slot,'slot','로드포트 도킹',at,null);
  add(1.25,slot,'slot','FOUP 도어 열림',at,null,1);
  add(1.25,align,handler,'슬롯에서 웨이퍼 인출',at,null);
  if(usesVacuum){
    add(1.25,lock,'atmosphere_robot','로드록 인계',at,null);
    add(1.5,lock,'load_lock','로드록 감압',at,null);
    add(1,vacuum,'vacuum_robot','진공 로봇 인계',at,null);
  }
  let previousAction:Action|undefined;
  for(const index of indices){
    const step=product.steps[index];const isScan=step.action==='expose';
    let chamber=center;
    const machine=geo.machines[step.station];
    if(kind==='track')chamber=isScan?point(machine.x-.1*sign,slot.y,machine.z-.2*sign):step.action==='coat'?firstCoat:anchor(2.25,0.85);
    if(kind==='etch_strip')chamber=step.action==='strip'?anchor(2.45,-1.65):anchor(3.55,[1.45,0,-1.45][(lot+index)%3]);
    if(family==='wet'||family==='polish')chamber=anchor(3.65,lot%2===0?.81:-.81);
    if(kind==='etch_strip'&&previousAction)add(.8,vacuum,'vacuum_robot',previousAction==='strip'?'제거실에서 웨이퍼 회수':'식각실에서 웨이퍼 회수',at,null);
    add(isScan?2:1.1,chamber,usesVacuum?'vacuum_robot':handler,'공정 모듈로 이송',step.station,null);
    const etchDuration=settings.get(etchKey(lot,index))==='short'?standardEtchSeconds/2:standardEtchSeconds;
    const dwell=step.action==='etch'?etchDuration:stepDwell[step.action];
    add(dwell,chamber,isScan?'scanner_stage':'chamber',step.label,step.station,index,door,index);
    events.push({time,carrierId:carrierIds[lot],kind:'process',station:step.station,label:step.label+' 완료'});
    previousAction=step.action;
  }
  if(usesVacuum){
    add(1,vacuum,'vacuum_robot','공정 챔버에서 반출',at,null);
    add(1,lock,'vacuum_robot','로드록으로 복귀',at,null);
    add(1.5,lock,'load_lock','로드록 대기압 복귀',at,null);
  }
  add(1.1,align,handler,'전면 로봇으로 회수',at,null);
  add(1.1,slot,handler,'원래 슬롯으로 복귀',at,null);
  add(1.25,slot,'slot','FOUP 도어 닫힘',at,null,0);
  add(0.6,slot,'slot','도킹 해제',at,null);
  for(const s of list)if(['로드록 인계','원래 슬롯으로 복귀','슬롯에서 웨이퍼 인출','진공 로봇 인계'].includes(s.label))
    events.push({time:s.to,carrierId:carrierIds[lot],kind:'handoff',station:at,label:s.label});
  return list;
}

export const stepDwell:Readonly<Record<Action,number>>={deposit:5,coat:3,expose:3,develop:3,etch:4,strip:3,clean:4,ald:6,deep_etch:8,
  implant:5,anneal:6,metal:5,plate:7,cmp:6,inspect:3,probe:4,bond:6,thin:6,optics:4};

function trip(vehicle:number,start:number,source:PortId,dest:PortId,geo:RouteGeometry):Trip {
  const bay=geo.bays[vehicle],merging=railCoordinate(bay.exitX,bay.mergeZ),diverting=railCoordinate(bay.enterX,bay.mergeZ);
  const atPickup=merging+railTravel(merging,geo.railTime(source));
  const atDelivery=atPickup+railTravel(atPickup,geo.railTime(dest));
  const atExit=atDelivery+railTravel(atDelivery,diverting);
  const merged=start+1.5,atSource=merged+(atPickup-merging)+(source===geo.home?2:0);
  const grip=atSource+1.8,lifted=grip+1.8,atDest=lifted+(atDelivery-atPickup),released=atDest+1.8,end=released+1.8;
  const divert=end+(atExit-atDelivery),parked=divert+1.5;
  return {vehicle,source,dest,start,merged,atSource,grip,lifted,atDest,released,end,divert,parked,motion:[
    {time:start,at:merging},{time:merged,at:merging},{time:atSource-(source===geo.home?2:0),at:atPickup},
    {time:lifted,at:atPickup},{time:atDest,at:atDelivery},{time:end,at:atDelivery},{time:divert,at:atExit},{time:parked,at:atExit},
  ]};
}

function railAt(motion:RailKnot[],time:number){
  for(let i=1;i<motion.length;i++){
    const next=motion[i],current=motion[i-1];
    if(time<=next.time&&next.time>current.time)return mix(current.at,next.at,(time-current.time)/(next.time-current.time));
  }
  return motion.at(-1)!.at;
}

// Progress is measured in seconds of free travel, including curves. Over each
// interval between motion knots the gap changes linearly, so check its full range.
function conflicts(a:Trip,b:Trip){
  const start=Math.max(a.start,b.start),end=Math.min(a.parked,b.parked);
  if(start>end)return false;
  const clearance=1.45;
  const times=[start,...[...a.motion,...b.motion].map(k=>k.time).filter(t=>start<t&&t<end).sort((a,b)=>a-b),end];
  let previous=railAt(a.motion,start)-railAt(b.motion,start);
  for(const t of times.slice(1)){
    const gap=railAt(a.motion,t)-railAt(b.motion,t);
    const low=Math.min(previous,gap)-clearance,high=Math.max(previous,gap)+clearance;
    if(Math.ceil(low/circuitTime)<=Math.floor(high/circuitTime))return true;
    previous=gap;
  }
  return false;
}

// Reserve destination ports and hoist time at the stocker separately from rail traffic.
// The deterministic reservations also let the UI seek directly to any process step.
function schedule(product:Product,settings:EtchSettings,geo:RouteGeometry,serial=false):Schedule {
  const {portFor,home,machines,bays}=geo;
  const route:{port:PortId;indices:number[]}[]=[];
  product.steps.forEach((step,i)=>{
    const port=portFor(step),last=route[route.length-1];
    if(last?.port===port)last.indices.push(i);
    else route.push({port,indices:[i]});
  });
  route.push({port:home,indices:[]});
  const lots=carrierIds.map((_,i)=>({lot:i,hop:0,at:home,ready:0}));
  const moves:Move[]=[],events:FabEvent[]=[];
  const available=bays.map(()=>0),freePorts=new Map<PortId,number>();
  let stockerReady=0;
  while(lots.some(l=>l.hop<route.length)){
    const jobs=lots.filter(l=>{
      if(l.hop>=route.length||(serial&&l.lot===1&&lots[0].hop<route.length))return false;
      const dest=route[l.hop].port;
      return dest===home||!lots.some(other=>other!==l&&other.at===dest);
    });
    if(!jobs.length)return schedule(product,settings,geo,true);
    let best:{lot:typeof lots[number];travel:Trip;queueFrom:number}|undefined;
    for(const lot of jobs){
      const source=lot.at,dest=route[lot.hop].port;
      const earliest=Math.max(lot.ready,freePorts.get(dest)??0,source===home||dest===home?stockerReady:0);
      for(const [vehicle,ready] of available.entries()){
        const queueFrom=Math.max(ready,earliest);
        let start=queueFrom,travel=trip(vehicle,start,source,dest,geo);
        while((!best||travel.released<best.travel.released)&&moves.some(placed=>conflicts(travel,placed))){
          start+=.5;travel=trip(vehicle,start,source,dest,geo);
        }
        if(!best||travel.released<best.travel.released)best={lot,travel,queueFrom};
      }
    }
    const {lot,travel,queueFrom}=best!,{source,dest,start,grip,lifted,released,end,vehicle,parked}=travel;
    const {indices}=route[lot.hop];
    const work=dest===home?[]:workPlan(lot.lot,dest,end,indices,product,events,settings,geo);
    const ready=work.length?work[work.length-1].to:end+2;
    if(dest===home)stockerReady=ready;
    if(source===home)stockerReady=lifted;
    else freePorts.set(source,lifted);
    moves.push({...travel,lot:lot.lot,ready,requested:lot.ready,queueFrom,work});
    const id=carrierIds[lot.lot];
    events.push(
      {time:start,kind:'dispatch',carrierId:id,station:dest,label:vehicleId(vehicle)+' 배차 · '+machineName(machines[dest])+' 포트 예약'},
      {time:grip,kind:'pickup',carrierId:id,station:source,label:machineName(machines[source])+' 출고 · '+vehicleId(vehicle)+' 인수'},
      {time:released,kind:'delivery',carrierId:id,station:dest,label:machineName(machines[dest])+' 도착 · 용기 안착'}
    );
    if(dest===home)events.push({time:ready,kind:'complete',carrierId:id,station:dest,label:'스토커 복귀 · 로트 완료'});
    lot.hop++;lot.at=dest;lot.ready=ready;available[vehicle]=parked;
  }
  return {moves,events:events.sort((a,b)=>a.time-b.time),duration:Math.max(...lots.map(l=>l.ready),...available),geo};
}

const telemetryCache=new WeakMap<Schedule,MetricCycle>();
function metricCycle(plan:Schedule):MetricCycle {
  const cached=telemetryCache.get(plan);
  if(cached)return cached;
  const {duration,geo,moves}=plan,tools=new Set<StationId>(),ports=new Set<PortId>();
  const cycle:MetricCycle={duration,tools:[],ports:[],home:geo.home,slots:carrierIds.length,vehicles:geo.bays.length,events:[],spans:[]};
  const span=(kind:SpanMeasure,from:number,to:number,station?:string)=>{
    if(to>from)cycle.spans.push({kind,from,to,station});
  };
  for(const lot of carrierIds.keys()){
    const itinerary=moves.filter(move=>move.lot===lot);
    cycle.events.push({kind:'start',time:0},{kind:'finish',time:itinerary.at(-1)!.ready});
    span('stocker',0,itinerary[0].atSource-2,geo.home);
    span('stocker',itinerary.at(-1)!.ready,duration,geo.home);
    for(const [index,move] of itinerary.entries()){
      const next=itinerary[index+1],previous=itinerary[index-1];
      const processes=move.work.filter(s=>s.completes!==undefined);
      cycle.events.push({kind:'delivery',time:move.released},{kind:'pickup',time:move.grip,seconds:move.grip-move.requested});
      if(previous&&processes.length){
        const depart=previous.work.filter(s=>s.completes!==undefined).at(-1)?.to;
        if(depart!==undefined)cycle.events.push({kind:'handoff',time:processes[0].from,seconds:processes[0].from-depart});
      }
      if(next){
        ports.add(move.dest);
        span('port',move.released,next.lifted,move.dest);
        span('present',move.released,next.grip,move.dest);
        span('blocked',move.ready,next.grip,move.dest);
      }
      for(const process of processes){
        tools.add(process.station);
        span('process',process.from,process.to,process.station);
        span('chamber',process.from,process.to,process.station);
        if(process.station!==move.dest)span('present',process.from,process.to,process.station);
      }
      span('empty',move.start,move.atSource-(move.source===geo.home?2:0));
      span('empty',move.end,move.parked);
      span('loaded',move.lifted,move.atDest);
      span('hoist',move.atSource,move.lifted);
      span('hoist',move.atDest,move.end);
      span('mergeWait',move.queueFrom,move.start);
      span('vehicle',move.start,move.parked);
    }
  }
  cycle.tools=[...tools];cycle.ports=[...ports];
  telemetryCache.set(plan,cycle);
  return cycle;
}

const vehicleId=(index:number)=>'OHT-'+String(index+1).padStart(2,'0');
function vehicleAt(plan:Schedule,t:number,index:number):VehicleFrame {
  const {docks,bays}=plan.geo,bay=bays[index];
  const next=plan.moves.find(m=>m.vehicle===index&&m.start<=t&&t<m.parked);
  let pose={x:bay.x,z:bay.z,angle:0},hoistY=travelY+podHeight,phase='지선 대기',carrierId:string|null=null;
  if(next){
    const m=next;
    pose=poseAt(railAt(m.motion,t));
    if(t<m.merged){
      const u=(t-m.start)/(m.merged-m.start);
      pose={x:mix(bay.x,bay.exitX,u),z:mix(bay.z,bay.mergeZ,u),angle:-Math.sin(Math.PI*u)*.8};
      phase='본선 합류';
    }else if(t>=m.divert){
      const u=(t-m.divert)/(m.parked-m.divert);
      pose={x:mix(bay.enterX,bay.x,u),z:mix(bay.mergeZ,bay.z,u),angle:Math.sin(Math.PI*u)*.8};
      phase='대기 지선 진입';
    }else if(t>=m.end){
      phase='빈 차량 복귀';
    }else
    if(t<m.atSource){
      phase=m.source===plan.geo.home&&t>=m.atSource-2?'스토커 출고 대기':'빈 차량 이동';
    }else if(t<m.lifted){
      if(t<m.grip){
        hoistY=mix(travelY+podHeight,docks[m.source].y+podHeight,ease((t-m.atSource)/(m.grip-m.atSource)));phase='파지부 하강';
      }else{
        carrierId=carrierIds[m.lot];hoistY=mix(docks[m.source].y+podHeight,travelY+podHeight,ease((t-m.grip)/(m.lifted-m.grip)));phase='용기 인양';
      }
    }else if(t<m.atDest){
      phase='적재 주행';carrierId=carrierIds[m.lot];
    }else{
      if(t<m.released){
        hoistY=mix(travelY+podHeight,docks[m.dest].y+podHeight,ease((t-m.atDest)/(m.released-m.atDest)));phase='용기 하강';carrierId=carrierIds[m.lot];
      }else{
        hoistY=mix(docks[m.dest].y+podHeight,travelY+podHeight,ease((t-m.released)/(m.end-m.released)));phase='파지부 회수';
      }
    }
  }
  return {id:vehicleId(index),position:point(pose.x,rail.elevation_y_m,pose.z),rotationY:-pose.angle,hoistY,carrierId,phase,busy:!!next};
}

function materialAt(product:Product, moves:Move[], time:number):Material {
  const initial=startsWithFilm(product.id)?1:0;
  const material:Material={layers:initial,resist:'none',etched:false,opening:initial,protected:initial,surface:'dielectric',thinned:false};
  for(const move of moves) for(const segment of move.work){
    if(segment.completes===undefined || time<segment.from)continue;
    const step=product.steps[segment.completes];
    if(step.action==='etch'||step.action==='deep_etch') {
      const exposure=Math.min(time,segment.to)-segment.from;
      material.opening=limit(1-exposure/(step.action==='etch'?standardEtchSeconds:stepDwell.deep_etch),0,1);
      material.etched=exposure>0;
      continue;
    }
    if(time<segment.to)continue;
    switch(step.action){
      case 'deposit':case 'ald':material.layers+=step.layers??1;material.opening=1;material.protected=1;material.etched=false;material.surface='dielectric';break;
      case 'metal':material.layers++;material.surface='metal';break;
      case 'plate':case 'cmp':material.opening=1;material.protected=1;material.surface='metal';break;
      case 'bond':material.layers++;break;
      case 'thin':material.thinned=true;break;
      case 'optics':material.layers++;material.surface='optical';material.opening=1;material.protected=1;break;
      case 'coat':material.resist='coated';break;
      case 'expose':material.resist='exposed';break;
      case 'develop':material.resist='developed';break;
      case 'strip':material.resist='none';break;
    }
  }
  return material;
}

function carrierAt(lot:number,t:number,plan:Schedule,product:Product,vehicles:VehicleFrame[],cycle:number):CarrierFrame {
  const {docks,home,rack,machines}=plan.geo;
  const id=carrierIds[lot],moves=plan.moves.filter(m=>m.lot===lot);
  const move=moves.filter(m=>m.start<=t).pop();
  const completedTransfers=moves.filter(m=>m.released<=t).length;
  const completedSteps=plan.events.filter(e=>e.carrierId===id&&e.kind==='process'&&e.time<=t).length;
  let station:PortId|null=home,position=rack(lot),rotationY=machines[home].facing*Math.PI/180,doorOpen=0,waferPos=slotPoint(lot,position);
  let owner:WaferOwner='slot',activeStepIndex:number|null=null,phase='스토커 대기',done=false;
  if(move){
    const m=move;
    if(t<m.grip){
      station=m.source;rotationY=machines[station].facing*Math.PI/180;position=docks[station];
      if(station===home)position=blend(rack(lot),position,ease(limit((t-m.atSource+2)/2,0,1)));
      phase=t<m.atSource?'출고 준비':'OHT 파지 대기';
    }else if(t<m.released){
      const vehicle=vehicles[m.vehicle];
      station=null;position=point(vehicle.position.x,vehicle.hoistY-podHeight,vehicle.position.z);
      phase=vehicle.phase;rotationY=vehicle.rotationY;
    }else{
      station=m.dest;position=docks[station];rotationY=machines[station].facing*Math.PI/180;phase='반출 대기';
      if(station===home){
        const u=ease(limit((t-m.end)/(m.ready-m.end),0,1));
        position=blend(docks[home],rack(lot),u);done=t>=m.ready;phase=done?'로트 완료':'스토커 입고';
      }else{
        const s=m.work.find(s=>s.from<=t&&t<s.to);
        if(s){
          const u=ease((t-s.from)/(s.to-s.from));
          owner=s.owner;waferPos=blend(s.start,s.end,u);doorOpen=mix(s.doorStart,s.doorEnd,u);
          activeStepIndex=s.active;phase=s.label;
        }else if(t<m.end)phase='인계 완료';
      }
    }
    if(owner==='slot')waferPos=slotPoint(lot,position);
  }
  return {id,station,position,rotationY,doorOpen,phase,activeStepIndex,completedSteps,completedTransfers,done,
    wafer:{id:'W-'+String(cycle*carrierIds.length+lot+1).padStart(3,'0'),slot:originalSlots[lot],owner,position:waferPos,material:materialAt(product,moves,t)}};
}

export class FabSimulation {
  private product:Product;
  private plan:Schedule;
  private elapsed=0;
  private cycles=0;
  private completedSeconds=0;
  private history:{plan:Schedule;count:number}[]=[];
  private settings:EtchSettings=new Map();
  constructor(id:ProductId='baseline',line=defaultLine(PRODUCTS[id].steps)){
    const issues=issuesFor(line,id);
    if(issues.length)throw new Error(issues[0].message);
    this.product={...PRODUCTS[id],steps:structuredClone(line.steps)};
    this.plan=schedule(this.product,this.settings,routeGeometry(structuredClone(line)));
  }
  reset(id?:ProductId) {
    this.settings.clear();
    if(id){this.product=PRODUCTS[id];this.plan=schedule(this.product,this.settings,routeGeometry(defaultLine(this.product.steps)));}
    else this.plan=schedule(this.product,this.settings,this.plan.geo);
    this.elapsed=0;this.cycles=0;this.completedSeconds=0;this.history=[];
  }
  stepInterval(lot:number,index:number) {
    for(const move of this.plan.moves) {
      if(move.lot!==lot)continue;
      const segment=move.work.find(s=>s.completes===index);
      if(segment)return {start:segment.from,end:segment.to};
    }
    throw new RangeError('웨이퍼의 공정 단계를 찾을 수 없습니다.');
  }
  startEtch(lot:number,index:number,condition:EtchCondition) {
    if(!carrierIds[lot] || this.product.steps[index]?.action!=='etch')throw new RangeError('식각 단계가 필요합니다.');
    this.settings.set(etchKey(lot,index),condition);
    this.plan=schedule(this.product,this.settings,this.plan.geo);
    const interval=this.stepInterval(lot,index);
    this.seek(interval.start);
    return interval;
  }
  advance(seconds:number) {if(Number.isFinite(seconds)&&seconds>0)this.seek(this.elapsed+seconds);}
  advanceContinuous(seconds:number) {
    if(!Number.isFinite(seconds)||seconds<=0)return;
    const total=this.elapsed+seconds,duration=this.plan.duration;
    const completed=Math.floor(total/duration);
    if(completed){
      this.cycles+=completed;
      this.completedSeconds+=completed*duration;
      const previous=this.history.at(-1);
      if(previous?.plan===this.plan)previous.count+=completed;
      else this.history.push({plan:this.plan,count:completed});
    }
    this.elapsed=total%duration;
  }
  get time() {return this.elapsed;}
  get totalTime() {return this.completedSeconds+this.elapsed;}
  get metricsTimeline():MetricTimeline {
    const blocks=this.history.map(({plan,count})=>({cycle:metricCycle(plan),count}));
    blocks.push({cycle:metricCycle(this.plan),count:1});
    return {elapsed:this.totalTime,blocks};
  }
  get finished() {return this.elapsed>=this.plan.duration;}
  seek(seconds:number) {if(Number.isFinite(seconds))this.elapsed=limit(seconds,0,this.plan.duration);}
  nextEventTime(after=this.elapsed):number {return this.plan.events.find(e=>e.time>after+1e-8)?.time??this.plan.duration;}
  get snapshot():SceneFrame {
    const time=this.elapsed,vehicles=this.plan.geo.bays.map((_,i)=>vehicleAt(this.plan,time,i)),events=this.plan.events.filter(e=>e.time<=time);
    const vehicle=vehicles[0],carriers=carrierIds.map((_,i)=>carrierAt(i,time,this.plan,this.product,vehicles,this.cycles));
    const {home,machines}=this.plan.geo;
    const equipment=Object.fromEntries(Object.keys(machines).map(id=>[id,{status:'idle',carrierId:null}])) as Record<StationId,EquipmentFrame>;
    for(const c of carriers){
      if(!c.station||c.station===home)continue;
      equipment[c.station]={status:c.wafer.owner==='slot'?'occupied':'processing',carrierId:c.id};
      if(c.wafer.owner==='scanner_stage'&&c.activeStepIndex!==null)equipment[this.product.steps[c.activeStepIndex].station]={status:'processing',carrierId:c.id};
    }
    for(const pending of this.plan.moves.filter(m=>m.start<=time&&time<m.released))
      equipment[pending.dest]={status:'reserved',carrierId:carrierIds[pending.lot]};
    const storing=this.plan.moves.find(m=>m.dest===home&&m.released<=time&&time<m.ready);
    const issuing=this.plan.moves.find(m=>m.source===home&&m.atSource-2<=time&&time<m.grip);
    if(storing||issuing)equipment[home]={status:'occupied',carrierId:carrierIds[(storing??issuing)!.lot]};
    return {productId:this.product.id,time,duration:this.plan.duration,cycle:this.cycles+1,finished:time>=this.plan.duration,events,carriers,vehicle,vehicles,equipment,
      stepsCompleted:carriers.reduce((n,c)=>n+c.completedSteps,0),transfersCompleted:carriers.reduce((n,c)=>n+c.completedTransfers,0)};
  }
}
