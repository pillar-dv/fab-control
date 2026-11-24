import {equipment} from './equipment';
import {kindFor} from './line-layout';
import {PRODUCTS,stepDwell,type ProcessStep,type ProductId} from './simulation';
import {closedBlock,secondaryBlock,createRail,hubs,reservationConflicts,type RailMotion,type RailPlan,type RailPoint,type RailTopology,type Reservation} from './experiment-rail';
import {experimentDemand,noise,recipeFor,recipeStation as stationFor,topologyFor} from './experiment-scenarios';
import {sharedChamberCycle} from './experiment-chambers';
import {maintenanceMetrics,maintenanceWindows,mergeSpans,workingClock,type EquipmentDowntime,type MaintenanceInput,type QueueRule,type QueueWindow} from './fab-constraints';
import type {FabBay} from './campus-layout';
import {buildCampusFab,sectionName,type CampusFabFloor,type CampusRailEdit,type FabAreaAssignment,type FabSections} from './campus-fab-layout';

export type BufferPolicy = 'wait'|'direct'|'near'|'central'|'mixed';
export type ChamberOrder = 'feed'|'unload';
export type Outage = 'none'|'vehicle'|'rail'|'secondary'|'port'|'lift';
export interface ExperimentPolicy {
  staging:boolean; bypass:boolean; buffer:BufferPolicy; dedicated:boolean; chambers:number; order:ChamberOrder;
  topology?:RailTopology; routing?:'distance'|'eta'; pooling?:'separate'|'shared'; arms?:1|2;
  reposition?:'home'|'demand'|'forecast'; predictiveDispatch?:boolean;
  directPercent?:number; bufferAssignment?:'near'|'balanced'; partnerWindow?:number; assignment?:'load'|'eta';
  queueControl?:boolean; maintenanceOffset?:number;
}
export interface ExperimentInput {
  primary:ProductId; secondary:ProductId|''; lots:number; wafers:number; fleet:number; releaseEvery:number;
  horizon:number; outage:Outage; outageAt:number; outageLength:number;
  mixPercent?:number; seed?:number; jitter?:number; releasePattern?:'regular'|'peak'; testEvery?:number;
  forecastError?:number; dueTime?:number; maxQueue?:number; targetWph?:number; repeatStation?:string; repeatCount?:number;
  liftSeconds?:number; liftRule?:'fifo'|'nearest'; liftCount?:number; parallelTools?:boolean;
  emptyTrips?:number; qualification?:'equipment'|'recipe'; recipeOrder?:Partial<Record<ProductId,number[]>>;
  queueRule?:QueueRule; maintenance?:MaintenanceInput;
}
export interface FabRelease {product:ProductId; time:number; section?:FabSections; test?:boolean; empty?:boolean}
export const baselinePolicy:ExperimentPolicy={staging:false,bypass:false,buffer:'wait',dedicated:false,chambers:1,order:'feed'};
export const defaultInput:ExperimentInput={
  primary:'dram',secondary:'nand',lots:8,wafers:4,fleet:3,releaseEvery:12,horizon:600,outage:'none',outageAt:90,outageLength:55,
};
export const bufferNames:Record<BufferPolicy,string>={
  wait:'출발 장비 대기',direct:'로드포트 선예약 직송',near:'장비 인근 버퍼',central:'중앙 스토커 경유',mixed:'직송 비율 실험',
};
export const outageNames:Record<Outage,string>={
  none:'정상 운전',vehicle:'OHT-01 운행 중지',rail:'북동측 본선 폐쇄',secondary:'보조선 지정 구간 폐쇄',
  port:'공유 우선 장비 포트 차단',lift:'첫 번째 인계 장치 중지',
};
export interface ChamberActivity {
  kind:'load'|'process'|'unload'; wafer:number; chamber:number; start:number; end:number; step:string;
}
export function chamberCycle(steps:ProcessStep[],count:number,chambers:number,order:ChamberOrder,start:number) {
  let time=start;
  const activities:ChamberActivity[]=[];
  for(const step of steps){
    const slots:(null|{wafer:number;ready:number})[]=Array(chambers).fill(null);
    let nextWafer=1,unloaded=0;
    while(unloaded<count){
      const full=slots.findIndex(slot=>slot!==null&&slot.ready<=time);
      const free=nextWafer<=count?slots.indexOf(null):-1;
      if(full>=0&&(order==='unload'||free===-1)){
        activities.push({kind:'unload',wafer:slots[full]!.wafer,chamber:full+1,start:time,end:time+1.2,step:step.label});
        slots[full]=null;
        time+=1.2;
        unloaded++;
      }else if(free>=0){
        const wafer=nextWafer++;
        activities.push({kind:'load',wafer,chamber:free+1,start:time,end:time+1.2,step:step.label});
        time+=1.2;
        const ready=time+stepDwell[step.action];
        slots[free]={wafer,ready};
        activities.push({kind:'process',wafer,chamber:free+1,start:time,end:ready,step:step.label});
      }else{
        time=Math.min(...slots.flatMap(slot=>slot?[slot.ready]:[]));
      }
    }
  }
  return {end:time,activities};
}

interface ToolVisit {station:string; steps:ProcessStep[]}
export interface ExperimentStation {
  point:RailPoint; access?:RailPoint; hub:number; label:string; type:'tool'|'home'|'buffer'|'relay'; capacity:number;
  section?:FabSections; bay?:FabBay; product?:ProductId; copy?:number; recipeStation?:string;
}
interface Place extends ExperimentStation {slots:{lot:number|null; available:number}[]}
interface Destination {target:Place; slot:number; buffer:boolean; priority:number}
interface Lot {
  id:number; product:ProductId; section?:FabSections; route:ToolVisit[]; step:number; release:number; ready:number;
  phase:'new'|'queued'|'moving'|'processing'|'done'|'relay'|'at-tool';
  place:Place; slot:number; buffered:boolean; forecast:number; completed?:number;
  test:boolean; empty:boolean; processReady?:number;
  queue?:QueueWindow; reworked?:boolean; held?:boolean;
  locations:{time:number;point:RailPoint;slot:number|null}[];
}
export interface ExperimentTransfer {
  lot:number; source:string; destination:string; requested:number; dispatch:number; pickup:number; delivery:number;
  vehicle:number; bypass:boolean; arrival:number; blocks:string[]; planned:string; destinationSlot:number;
}
interface ExperimentWork {lot:number; station:string; start:number; end:number; activities:ChamberActivity[]; wait?:number}
interface ExperimentRequest {lot:number; time:number; source:string; fromTool:boolean; dispatched?:number; pickup?:number; delivered?:number; cancelled?:number;
  mergeWait:{start:number;end:number}[]}
export interface RelayMove {lot:number; relay:number; from:RailPoint; to:RailPoint; start:number; end:number}
export interface ExperimentVehicle {
  id:number; initial:RailPoint; section?:FabSections; motion:(RailMotion&{lot?:number})[];
}
interface OperatingVehicle extends ExperimentVehicle {
  bay:RailPoint; hub:number; homeHub:number; parkingIndex:number; free:number; predicted:string; lane:number;
}
export interface ExperimentMetrics {
  wafers:number; wph:number; lots:number; transfers:number; pickupP95:number|null; handoffP95:number|null;
  incomplete:number; remainingLots:number; recovery:number|null; bypasses:number; staged:number; bufferMoves:number;
  blockedSeconds:number; emptySeconds:number; loadedSeconds:number; robotSeconds:number; residence:number|null;
  pickupMean:number|null; handoffMean:number|null; processWaitP95:number|null; dueRate:number|null; waitViolations:number;
  remainingWait:number; mergeWait:number; hoistSeconds:number; idleToolSeconds:number; chamberUse:number|null;
  portUse:number|null; bufferUse:number|null; vehicleUse:number|null; testLots:number; relayMoves:number; relaySeconds:number;
  directRate:number|null; railMeters:number; bufferCapacity:number; planChanges:number; recoveryPorts:number|null;
  stallSeconds:number; conflicts:number;
  criticalViolations:number; holdCount:number; reworkCount:number;
  availability:number|null; productive:number|null; standby:number|null; plannedDowntime:number; faultDowntime:number; mtbf:number|null; mttr:number|null;
}
export interface ExperimentResult {
  input:ExperimentInput; policy:ExperimentPolicy; stations:ExperimentStation[]; edges:ReturnType<typeof createRail>['edges'];
  vehicles:ExperimentVehicle[]; lots:Lot[]; work:ExperimentWork[]; transfers:ExperimentTransfer[];
  bookings:Reservation[]; requests:ExperimentRequest[]; relays:RelayMove[]; topology:RailTopology; conflictTimes:number[];
  queueWindows:QueueWindow[]; downtime:EquipmentDowntime[]; maintenanceStation?:string;
  unreachablePorts:string[];
  outagePort:string; outageBlock?:string; reachablePorts:number|null; stalledAt?:number; metrics:ExperimentMetrics; campusFloor?:CampusFabFloor;
}

function percentile(values:number[],p:number) {
  return values.length?values.sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]:null;
}

export function runExperiment(input:ExperimentInput,policy:ExperimentPolicy,releases?:readonly FabRelease[],
  areas?:readonly FabAreaAssignment[],railEdit?:CampusRailEdit):ExperimentResult {
  const topology=areas?'loop':topologyFor(policy);
  const rail=createRail(areas?'campus':'experiment',topology);
  const useBypass=areas?policy.bypass:topology==='bypass';
  const split=topology==='relay'||topology==='vertical';
  const reposition=policy.reposition??(policy.staging?'forecast':'home');
  const demand:readonly FabRelease[]=releases??experimentDemand(input);
  const products=areas?[...new Set(areas.map(area=>area.product))]:[...new Set(demand.filter(lot=>!lot.empty).map(lot=>lot.product))];
  if(!products.length)products.push(input.primary);
  const recipes=new Map(products.map(product=>[product,recipeFor(product,input)]));
  const productTools=products.map(product=>new Set(recipes.get(product)!.map(stationFor)));
  const common=[...productTools[0]].filter(id=>productTools.slice(1).some(kinds=>kinds.has(id)));
  const toolIds=[...new Set(productTools.flatMap((tools,index)=>[...tools].map(id=>toolId(id,products[index]))))];
  function toolId(id:string,product:ProductId) {
    const signature=(type:ProductId)=>[...new Set(recipes.get(type)!.filter(step=>stationFor(step)===id).map(step=>step.action))].sort().join('/');
    const incompatible=input.qualification==='recipe'&&products.some(other=>other!==product&&
      productTools[products.indexOf(other)].has(id)&&signature(other)!==signature(product));
    return common.includes(id)&&(policy.dedicated||incompatible)?id+'/'+product:id;
  }
  const places=new Map<string,Place>();
  const toolPlaces=new Map<string,Place[]>();
  const assignedJobs=new Map<string,number>();
  const outer=[[-1,-1],[0,-1],[1,-1],[1,1],[0,1],[-1,1]];
  const positions=[0,0,0,0,0,0];
  function register(station:ExperimentStation){
    const place:Place={...station,slots:Array.from({length:station.capacity},()=>({lot:null,available:0}))};
    places.set(place.point.id,place);
    return place;
  }
  const laneAt=(hub:number)=>rail.secondary.length&&hub>=2&&hub<=4?1:0;
  const anchorAt=(hub:number,lane:number)=>lane===1?rail.secondary[hub]:hubs[hub];
  function place(id:string,label:string,type:Place['type'],hub:number,capacity:number,lane=laneAt(hub)) {
    const anchor=anchorAt(hub,lane),[dx,dz]=outer[hub],index=positions[hub]++;
    const x=hubs[hub].x+dx*(3+index*.58)+(index-1)*1.17;
    const z=hubs[hub].z+dz*(2.15+index*1.27);
    const point={id,x,z,lane,elevation:anchor.elevation,siding:true};
    rail.link(anchor,point,false,true,'siding');
    return register({point,hub,label,type,capacity});
  }
  const lotCount=demand.length;
  const campus=areas&&buildCampusFab(rail,areas.map(area=>({
    ...area,tools:[...productTools[products.indexOf(area.product)]].map(id=>toolId(id,area.product)),
  })),input.fleet,railEdit);
  const home=campus?register({...campus.home,label:'입·출고 스토커',type:'home',capacity:lotCount}):
    place('home','입·출고 스토커','home',5,lotCount);
  const central=campus?register({...campus.central,label:'중앙 스토커',type:'buffer',capacity:3}):
    place('stocker','중앙 스토커','buffer',4,3);
  const near=new Map<number,Place>(campus?campus.near.map(buffer=>[buffer.hub,register({
    ...buffer,label:sectionName(buffer.section)+' · 라인 스토커',type:'buffer',
  })]):hubs.map((_,i)=>[i,place('buffer-'+i,'인근 버퍼 '+(i+1),'buffer',i,1)]));
  const relayLinks=split?Array.from({length:topology==='vertical'?input.liftCount??1:1},(_,id)=>{
    const hub=id===0?1:4;
    const name=topology==='vertical'?'리프터 '+(id+1):'인계 스토커';
    const ports=[0,1].map(lane=>{
      const anchor=anchorAt(hub,lane),point={id:`relay-${id}-${lane}`,x:lane*.85-3.2,z:anchor.z+(hub===1?1.15:-1.15),
        elevation:anchor.elevation,lane,siding:true};
      rail.link(anchor,point,false,true,'siding');
      return register({point,label:`${name} ${lane+1}측 포트`,type:'relay',hub,capacity:2});
    });
    return {id,ports,last:undefined as RelayMove|undefined};
  }):[];
  const relayByPort=new Map(relayLinks.flatMap(link=>link.ports.map(port=>[port.point.id,link] as const)));
  const baseKind=(id:string)=>kindFor(id.split('/')[0]);
  const primary=products[0];
  const order=[...new Set(recipes.get(primary)!.map(stationFor))];
  function labelFor(id:string){
    const [base,product]=id.split('/') as [string,ProductId|undefined];
    const name=equipment[baseKind(id)].name;
    return product?name+' · '+PRODUCTS[product].name:name+(base!==baseKind(id)?' 2호기':'');
  }
  if(campus){
    for(const {logical,...tool} of campus.positioned){
      const station=register({...tool,recipeStation:logical,
        label:labelFor(logical)+' '+tool.copy+'호기 · '+sectionName(tool.section),type:'tool',capacity:1});
      const choices=toolPlaces.get(logical)??[];
      choices.push(station);
      toolPlaces.set(logical,choices);
    }
  }else for(const [i,id] of toolIds.entries()){
    const index=order.indexOf(id.split('/')[0]);
    const station=place(id,labelFor(id),'tool',(index<0?i:index)%6,policy.pooling==='shared'?2:1);
    const copies=[station];
    if(input.parallelTools&&common.includes(id.split('/')[0])){
      copies.push(place(id+'/parallel',labelFor(id)+' 2호기','tool',(station.hub+1)%6,station.capacity));
    }
    toolPlaces.set(id,copies);
  }
  const [closureBase]=(common.includes('track')?['track']:common.length?common:order);
  const closure=toolPlaces.get(toolId(closureBase,primary))![0];
  const maintenanceStation=input.maintenance&&[...toolPlaces.entries()]
    .find(([id])=>id.split('/')[0]===input.maintenance!.station)?.[1][0].point.id;
  const downtime=input.maintenance&&maintenanceStation?maintenanceWindows(input.maintenance,maintenanceStation,input.horizon,
    policy.maintenanceOffset??0,index=>noise(input.seed??1,661+index)):[];
  const unavailable=mergeSpans(downtime);
  const outageEnd=input.outageAt+input.outageLength;
  const affectedBlock=input.outage==='rail'?closedBlock:input.outage==='secondary'&&rail.secondary.length?secondaryBlock:undefined;
  if(affectedBlock)rail.commit([{resource:affectedBlock,start:input.outageAt,end:outageEnd}]);
  if(input.outage==='port')rail.commit([{resource:'dock:'+closure.point.id,start:input.outageAt,end:outageEnd}]);
  if(input.outage==='lift'&&split)rail.commit([{resource:'relay:0',start:input.outageAt,end:outageEnd}]);
  if(input.outage==='vehicle')rail.commit([{resource:'vehicle:1',start:input.outageAt,end:outageEnd}]);

  function parkingOn(lane:number){
    return hubs.map((_,index)=>Array.from({length:input.fleet},(_,car)=>{
      const hub=anchorAt(index,lane);
      const point={id:`bay-${lane}-${index}-${car}`,x:hub.x+(car-(input.fleet-1)/2)*.56,z:hub.z-outer[index][1]*(1.25+car%2*.48),
        lane,elevation:hub.elevation,siding:true};
      rail.link(hub,point,false,true,'siding');
      return point;
    }));
  }
  const bays=campus?campus.parking.map(item=>item.spots):parkingOn(0);
  const otherBays=split?parkingOn(1):undefined;
  const laneOf=(point:RailPoint)=>point.lane??0;
  const parkingFor=(lane:number,hub:number,car:number)=>(lane&&otherBays?otherBays:bays)[hub][car];
  const launchZones=campus?.parking??[{hub:home.hub,spots:bays[home.hub],section:undefined}];
  const vehicles:OperatingVehicle[]=launchZones.flatMap(({hub,spots,section})=>
    spots.map((point,index)=>{
      const lane=split?index%2:0;
      const bay=lane?parkingFor(lane,hub,index):point;
      return {id:(section?hub*input.fleet:0)+index+1,bay,initial:bay,hub,homeHub:hub,parkingIndex:index,
        section,lane,free:0,predicted:'',motion:[]};
    }));
  const lots:Lot[]=Array.from({length:lotCount},(_,i)=>{
    const {product,time:release,section,test=false,empty=false}=demand[i],route:ToolVisit[]=[];
    if(empty)route.push({station:'stocker',steps:[]});
    for(const step of empty?[]:recipes.get(product)!){
      const id=toolId(stationFor(step),product),visit=route.at(-1);
      if(visit?.station===id)visit.steps.push(step);
      else route.push({station:id,steps:[step]});
    }
    const repeat=route.find(visit=>visit.station.split('/')[0]===input.repeatStation);
    if(repeat&&input.repeatCount)for(let n=0;n<input.repeatCount;n++)route.push({...repeat});
    if(areas&&!areas.some(area=>area.section===section&&area.product===product))
      throw new Error('생산 구역과 로트 품목 불일치 '+product);
    return {id:i+1,product,section,route,step:0,release,ready:release,phase:'new',place:home,slot:i,
      forecast:0,test,empty,buffered:false,locations:[{time:release,point:home.point,slot:i}]};
  });
  const events:{time:number;action:()=>void}[]=[];
  const work:ExperimentWork[]=[],transfers:ExperimentTransfer[]=[],requests:ExperimentRequest[]=[],relays:RelayMove[]=[];
  const queueWindows:QueueWindow[]=[];
  const rule=input.queueRule;
  const queueRanges=new Map(lots.flatMap(lot=>{
    if(!rule||lot.product!==rule.product||lot.empty)return [];
    const from=lot.route.findIndex(visit=>visit.steps.some(step=>step.id===rule.fromStep));
    const to=lot.route.findIndex(visit=>visit.steps.some(step=>step.id===rule.toStep));
    return from>=0&&to>from?[[lot.id,{from,to}] as const]:[];
  }));
  const bookings:Reservation[]=[];
  let now=0, wake=Infinity,stalledAt:number|undefined;
  const currentRequest=new Map<number,ExperimentRequest>();
  const waitingTools=new Map<string,{lots:Lot[];until:number;available:number}>();
  function enqueue(time:number,action:()=>void){events.push({time,action});}
  function request(lot:Lot){
    lot.phase='queued';
    lot.ready=now;
    const record={lot:lot.id,time:now,source:lot.place.point.id,fromTool:lot.place.type==='tool',mergeWait:[]};
    currentRequest.set(lot.id,record);
    requests.push(record);
  }
  function divert(lot:Lot,time:number){
    const window=lot.queue;
    if(!policy.queueControl||!window||window.started!==undefined||window.resolved!==undefined||time<=window.deadline+1e-7)return false;
    window.resolved=now;
    window.consequence=rule?.consequence==='rework'&&!lot.reworked?'rework':'hold';
    lot.reworked||=window.consequence==='rework';
    lot.held=window.consequence==='hold';
    lot.step=lot.held?lot.route.length:window.from;
    lot.queue=undefined;
    lot.buffered=false;
    const previous=currentRequest.get(lot.id);
    if(previous&&previous.delivered===undefined)previous.cancelled=now;
    request(lot);
    return true;
  }
  function finishVisit(lot:Lot,visit:number){
    lot.processReady=now;
    const span=queueRanges.get(lot.id);
    if(span?.from===visit){
      lot.queue={lot:lot.id,...span,entered:now,deadline:now+rule!.seconds};
      queueWindows.push(lot.queue);
      enqueue(lot.queue.deadline+.0001,()=>{});
    }
    if(!divert(lot,now))request(lot);
  }
  const forecastKey=(lot:Lot)=>lot.id+'/'+lot.step;
  function estimateFinish(lot:Lot,target:Place){
    if(policy.assignment!=='eta'||target.type!=='tool')return (arrival:number)=>arrival;
    const steps=lot.route[lot.step].steps;
    const queue=waitingTools.get(target.point.id);
    const available=queue?.available??0;
    const partner=queue?.lots[0];
    const match=partner?.route[partner.step].steps;
    if(match&&match.length===steps.length&&match.every((step,i)=>step.action===steps[i].action)){
      const duration=sharedChamberCycle([{lot:partner.id,steps:match},{lot:lot.id,steps}],input.wafers,policy.chambers,
        policy.arms??1,policy.order,0)[1].end;
      return (arrival:number)=>Math.max(arrival,available)+duration;
    }
    const setup=target.capacity>1?policy.partnerWindow??12:0;
    const duration=policy.arms===2?sharedChamberCycle([{lot:lot.id,steps}],input.wafers,policy.chambers,2,policy.order,setup)[0].end:
      chamberCycle(steps,input.wafers,policy.chambers,policy.order,setup).end;
    return (arrival:number)=>Math.max(arrival,available)+duration;
  }
  function arriveAtTool(lot:Lot,station:Place){
    const id=station.point.id;
    if(station.capacity===1){processLots([lot],id);return;}
    let queue=waitingTools.get(id);
    if(!queue){queue={lots:[],until:now,available:now};waitingTools.set(id,queue);}
    if(queue.lots.length===0)queue.until=now+(policy.partnerWindow??12);
    queue.lots.push(lot);
    lot.phase='at-tool';
    enqueue(queue.until,()=>{});
  }
  function startToolBatches(){
    const signature=(lot:Lot)=>lot.route[lot.step].steps.map(step=>step.action).join('/');
    for(const [station,queue] of waitingTools){
      if(policy.queueControl)queue.lots.sort((a,b)=>expires(a)-expires(b)||a.ready-b.ready);
      const first=queue.lots[0];
      if(!first)continue;
      if(queue.available>now+1e-7){wake=Math.min(wake,queue.available);continue;}
      const waitUntil=Math.min(queue.until,expires(first));
      if(queue.lots.length===1&&waitUntil>now+1e-7){wake=Math.min(wake,waitUntil);continue;}
      queue.lots.shift();
      const partner=queue.lots[0];
      const jobs=partner&&signature(first)===signature(partner)?[first,queue.lots.shift()!]:[first];
      queue.available=processLots(jobs,station);
      if(queue.lots.length)wake=Math.min(wake,queue.available);
    }
  }
  function processLots(jobs:Lot[],station:string):number {
    const scheduled=jobs.map(lot=>({lot:lot.id,steps:lot.route[lot.step].steps}));
    let runs=jobs.length>1||policy.arms===2?sharedChamberCycle(scheduled,input.wafers,policy.chambers,policy.arms??1,policy.order,now):
      [{...chamberCycle(scheduled[0].steps,input.wafers,policy.chambers,policy.order,now),lot:jobs[0].id,start:now}];
    if(station===maintenanceStation&&unavailable.length){
      const wall=workingClock(now,unavailable);
      runs=runs.map(run=>({...run,start:wall(run.start),end:wall(run.end),
        activities:run.activities.map(task=>({...task,start:wall(task.start),end:wall(task.end)}))}));
    }
    const admitted=jobs.filter((lot,index)=>lot.queue?.to!==lot.step||!divert(lot,runs[index].start));
    if(admitted.length!==jobs.length)return admitted.length?processLots(admitted,station):now;
    for(const [i,run] of runs.entries()){
      const lot=jobs[i];
      const visit=lot.step++;
      if(lot.queue?.to===visit){lot.queue.started=run.start;lot.queue=undefined;}
      work.push({...run,station,wait:lot.processReady===undefined?undefined:run.start-lot.processReady});
      lot.forecast=run.end;
      lot.phase='processing';
      enqueue(run.end,()=>finishVisit(lot,visit));
    }
    return Math.max(...runs.map(run=>run.end));
  }
  for(const lot of lots)enqueue(lot.release,()=>{
    home.slots[lot.slot].lot=lot.id;
    request(lot);
  });

  function findSlot(place:Place,lot:Lot,early:boolean) {
    if(place===home)return lot.id-1;
    return place.slots.findIndex(slot=>slot.lot===null&&(early||slot.available<=now));
  }
  function destinations(lot:Lot):Destination[] {
    const visit=lot.route[lot.step];
    const candidates=visit?lot.empty?[central]:toolPlaces.get(visit.station)!:[home];
    const targets=campus&&visit?candidates.filter(target=>target.section===lot.section&&target.product===lot.product):candidates;
    const limit=queueRanges.get(lot.id);
    if(policy.queueControl&&limit?.from===lot.step&&!lot.queue&&now-lot.ready<rule!.seconds){
      const downstream=toolPlaces.get(lot.route[limit.to].station)??[];
      const deadline=now+visit.steps.reduce((sum,step)=>sum+stepDwell[step.action]+2.4,0)+rule!.seconds;
      const release=Math.min(...downstream.flatMap(target=>target.slots.map(slot=>slot.lot===null?slot.available:
        lots[slot.lot-1].phase==='processing'?lots[slot.lot-1].forecast+5:Infinity)));
      if(release>deadline){wake=Math.min(wake,lot.ready+rule!.seconds);return [];}
    }
    const mixed=policy.buffer==='mixed'&&lot.place.type==='tool'&&visit!==undefined;
    const direct=mixed?noise(input.seed??1,lot.id*131+lot.step)*100<(policy.directPercent??75):policy.buffer==='direct';
    function reachable(target:Place,slot:number,buffer:boolean,priority:number):Destination[] {
      if(!split||laneOf(lot.place.point)===laneOf(target.point))return [{target,slot,buffer,priority}];
      return relayLinks.flatMap(link=>{
        const relay=link.ports[laneOf(lot.place.point)];
        const outage=input.outage==='lift'&&link.id===0&&input.outageAt<=now&&now<outageEnd;
        const delay=Math.max(0,(link.last?.end??now)-now,outage?outageEnd-now:0);
        return relay.slots[0].lot===null&&relay.slots[0].available<=now?
          [{target:relay,slot:0,buffer:false,priority:priority+(relayLinks.length>1?delay:0)}]:[];
      });
    }
    const returning=lot.place.type==='tool'&&targets.includes(lot.place);
    const ready=targets.filter(target=>!returning||target!==lot.place).flatMap(target=>{
      const slot=findSlot(target,lot,direct);
      return slot>=0?reachable(target,slot,false,policy.assignment==='eta'?0:assignedJobs.get(target.point.id)??0):[];
    });
    if(mixed&&!direct&&!lot.buffered){
      const fallback=bufferChoices();
      if(fallback.length)return fallback;
    }
    if(ready.length||lot.buffered||lot.place.type==='home')return ready;
    return bufferChoices(returning);

    function bufferChoices(returning=false){
      const nearby=targets.flatMap(target=>near.get(target.hub)??[]);
      const alternatives=policy.bufferAssignment==='balanced'?[...near.values(),central]:nearby;
      const buffers=policy.buffer==='near'||mixed||returning?alternatives:policy.buffer==='central'?[central]:[];
      return [...new Set(buffers)].flatMap(target=>{
        const slot=findSlot(target,lot,false);
        const fill=target.slots.filter(entry=>entry.lot!==null||entry.available>now).length/target.capacity;
        const distance=Math.min(...targets.map(tool=>Math.hypot(tool.point.x-target.point.x,tool.point.z-target.point.z)));
        const priority=policy.bufferAssignment==='balanced'?20*fill+distance:0;
        return slot>=0&&(!split||laneOf(target.point)===laneOf(lot.place.point))?reachable(target,slot,true,priority):[];
      });
    }
  }
  function applyPlan(vehicle:OperatingVehicle,plan:RailPlan,hub:number,lot?:number) {
    const reservations=plan.reservations;
    rail.commit(reservations);
    bookings.push(...reservations);
    vehicle.motion.push(...plan.motion.map(m=>({...m,lot})));
    vehicle.bay=parkingFor(vehicle.lane,hub,vehicle.parkingIndex);
    vehicle.hub=hub;
    vehicle.free=plan.end;
  }
  function routes(from:RailPoint,to:RailPoint){
    const paths=rail.routes(from,to,useBypass);
    if(policy.routing!=='distance'||paths.length<2)return paths;
    const duration=(path:typeof paths[number])=>path.reduce((sum,edge)=>sum+edge.seconds,0);
    return [paths.reduce((best,path)=>duration(path)<duration(best)?path:best)];
  }
  function dispatch(lot:Lot) {
    const source=lot.place;
    const pending=currentRequest.get(lot.id)!;
    let delayed:RailPlan|undefined;
    let best:{vehicle:OperatingVehicle;plan:RailPlan;arrival:number;bypass:boolean;choice:Destination;blocks:string[];end:number}|undefined;
    const planned=lot.route[lot.step]?(lot.empty?central:toolPlaces.get(lot.route[lot.step].station)![0]).point.id:home.point.id;
    for(const choice of destinations(lot)){
      const {target,slot,priority}=choice;
      if(best&&priority>best.choice.priority)continue;
      const finish=estimateFinish(lot,target);
      const alternatives=routes(source.point,target.point);
      for(const vehicle of vehicles){
        if(vehicle.section!==lot.section||split&&vehicle.lane!==laneOf(source.point))continue;
        if(vehicle.free>now+1e-7){
          wake=Math.min(wake,vehicle.free);
          if(!policy.predictiveDispatch||vehicle.free-now>35)continue;
        }
        const hub=reposition!=='home'&&target.hub>=0?target.hub:vehicle.homeHub;
        const parking=parkingFor(vehicle.lane,hub,vehicle.parkingIndex);
        const returning=routes(target.point,parking);
        const start=Math.max(now,vehicle.free);
        const predictionBonus=policy.predictiveDispatch&&vehicle.predicted===forecastKey(lot)?-1:0;
        for(const empty of routes(vehicle.bay,source.point)){
          for(const loaded of alternatives){
            const earliest=start+empty.reduce((sum,edge)=>sum+edge.seconds,0)+loaded.reduce((sum,edge)=>sum+edge.seconds,0)+5;
            if(best?.choice.priority===priority&&finish(earliest)+predictionBonus>best.end+1e-7)continue;
            for(const back of returning){
              const plan=rail.plan(start,[{edges:empty,phase:'empty'},{edges:loaded,phase:'loaded'},{edges:back,phase:'empty'}],
                source.point,target.point,target.slots[slot].available,vehicle.id);
              if(plan.depart>now+1e-7){
                wake=Math.min(wake,plan.depart);
                if(!delayed||plan.depart<delayed.depart)delayed=plan;
                if(!policy.predictiveDispatch)continue;
              }
              const end=finish(plan.delivery)+predictionBonus;
              if(!best||priority<best.choice.priority||priority===best.choice.priority&&(end<best.end-1e-7||
                (Math.abs(end-best.end)<1e-7&&plan.end<best.plan.end))){
                const path=[...empty,...loaded];
                best={vehicle,plan,arrival:hub,bypass:path.some(edge=>edge.bypass||edge.kind==='secondary'),choice,
                  blocks:[...path,...back].map(edge=>edge.block),end};
              }
            }
          }
        }
      }
    }
    if(!best||best.plan.depart>now+1e-7){
      if(delayed?.mergeWait)pending.mergeWait.push({start:now,end:now+delayed.mergeWait});
      return;
    }
    const {vehicle,plan,arrival,bypass}=best;
    const {target,slot,buffer}=best.choice;
    if((campus||policy.assignment)&&target.type==='tool')assignedJobs.set(target.point.id,(assignedJobs.get(target.point.id)??0)+1);
    applyPlan(vehicle,plan,arrival,lot.id);
    const sourceSlot=source.slots[lot.slot];
    sourceSlot.lot=null;
    sourceSlot.available=plan.pickup;
    // A waiting policy sees the slot when the lift clears it. A direct policy can book its release.
    enqueue(plan.pickup,()=>{});
    target.slots[slot].lot=lot.id;
    lot.phase='moving';
    pending.dispatched=now;
    pending.pickup=plan.pickup;
    pending.delivered=plan.delivery;
    transfers.push({lot:lot.id,source:source.point.id,destination:target.point.id,requested:lot.ready,
      dispatch:now,pickup:plan.pickup,delivery:plan.delivery,arrival:plan.end,vehicle:vehicle.id,bypass,
      blocks:best.blocks,planned,destinationSlot:slot});
    lot.locations.push({time:plan.pickup,point:source.point,slot:null},{time:plan.delivery,point:target.point,slot});
    enqueue(plan.delivery,()=>{
      lot.place=target;
      lot.slot=slot;
      if(target.type==='relay'){request(lot);lot.phase='relay';return;}
      if(buffer){lot.buffered=true;request(lot);return;}
      lot.buffered=false;
      if(target===home){
        lot.phase='done';
        lot.completed=now;
        return;
      }
      if(lot.empty){lot.step++;request(lot);return;}
      if(!divert(lot,now))arriveAtTool(lot,target);
    });
  }
  function transferBetweenLoops(){
    const waiting=lots.filter(lot=>lot.phase==='relay').sort((a,b)=>{
      if(input.liftRule==='nearest'){
        const atPort=(lot:Lot)=>Number(relayByPort.get(lot.place.point.id)?.last?.to.id===lot.place.point.id);
        return atPort(b)-atPort(a)||a.ready-b.ready;
      }
      return a.ready-b.ready;
    });
    for(const lot of waiting){
      const source=lot.place,link=relayByPort.get(source.point.id)!;
      const target=link.ports[1-laneOf(source.point)];
      if(target.slots[1].lot!==null||target.slots[1].available>now)continue;
      const setup=topology==='vertical'&&link.last&&link.last.to.id!==source.point.id?3:0;
      const plan=rail.schedule(['relay:'+link.id,'dock:'+source.point.id,'dock:'+target.point.id],now,
        (topology==='vertical'?input.liftSeconds??12:6)+setup);
      if(plan.start>now+1e-7){wake=Math.min(wake,plan.start);continue;}
      rail.commit(plan.reservations);bookings.push(...plan.reservations);
      link.last={lot:lot.id,relay:link.id,from:source.point,to:target.point,start:now,end:plan.end};
      relays.push(link.last);
      const pending=currentRequest.get(lot.id)!;
      pending.dispatched=now;
      pending.pickup=now;pending.delivered=plan.end;
      lot.phase='moving';
      source.slots[lot.slot]={lot:null,available:plan.end};
      target.slots[1].lot=lot.id;
      lot.locations.push({time:now,point:source.point,slot:null},{time:plan.end,point:target.point,slot:1});
      enqueue(plan.end,()=>{lot.place=target;lot.slot=1;request(lot);});
    }
  }
  function stageIdle(){
    const predicted=reposition==='forecast'||policy.predictiveDispatch;
    const forecasts=lots.filter(lot=>predicted?lot.phase==='processing':lot.phase==='queued')
      .map(lot=>({lot,due:predicted?forecastAt(lot):now+35}))
      .filter(({due})=>due>now&&due-now<=35).sort((a,b)=>a.due-b.due);
    for(const {lot,due} of forecasts){
      const key=forecastKey(lot);
      if(vehicles.some(vehicle=>vehicle.predicted===key))continue;
      const hub=lot.place.hub;
      if(hub<0)continue;
      const free=vehicles.filter(vehicle=>vehicle.section===lot.section&&(!split||vehicle.lane===laneOf(lot.place.point))&&vehicle.free<=now+1e-7);
      const nearest=free.find(vehicle=>vehicle.hub===hub);
      if(nearest){nearest.predicted=key;continue;}
      let best:{vehicle:OperatingVehicle;plan:RailPlan}|undefined;
      for(const vehicle of free){
        for(const edges of routes(vehicle.bay,parkingFor(vehicle.lane,hub,vehicle.parkingIndex))){
          const plan=rail.plan(now,[{edges,phase:'stage'}],undefined,undefined,0,vehicle.id);
          if(plan.depart>now+1e-7){if(plan.depart<due)wake=Math.min(wake,plan.depart);continue;}
          if(plan.end<due&&(!best||plan.end<best.plan.end))best={vehicle,plan};
        }
      }
      if(best){
        applyPlan(best.vehicle,best.plan,hub);
        best.vehicle.predicted=key;
        wake=Math.min(wake,best.plan.end);
      }
    }
  }
  function forecastAt(lot:Lot){
    return lot.forecast+(noise(input.seed??1,lot.id*193+lot.step)-.5)*2*(input.forecastError??0);
  }
  const expires=(lot:Lot)=>policy.queueControl?lot.queue?.deadline??Infinity:Infinity;
  while(now<=input.horizon){
    events.sort((a,b)=>a.time-b.time);
    while(events.length&&events[0].time<=now+1e-7)events.shift()!.action();
    wake=Infinity;
    startToolBatches();
    if(split)transferBetweenLoops();
    for(const lot of lots.filter(lot=>lot.phase==='queued').sort((a,b)=>expires(a)-expires(b)||a.ready-b.ready||a.id-b.id)){
      divert(lot,now);dispatch(lot);
    }
    if(reposition!=='home'||policy.predictiveDispatch)stageIdle();
    for(const lot of lots){
      if((reposition==='forecast'||policy.predictiveDispatch)&&lot.phase==='processing'&&forecastAt(lot)-now>35)wake=Math.min(wake,forecastAt(lot)-35);
    }
    const next=Math.min(wake,...events.map(event=>event.time));
    if(!Number.isFinite(next)||next<=now+1e-7){
      if(lots.some(lot=>lot.phase==='queued'||lot.phase==='relay'||lot.phase==='at-tool'))stalledAt=now;
      break;
    }
    now=next;
  }
  const reachablePorts=affectedBlock?[...places.values()].filter(station=>{
    if(station.type!=='tool')return false;
    const accessible=(from:RailPoint,to:RailPoint)=>rail.routes(from,to,useBypass).some(path=>path.every(edge=>edge.block!==affectedBlock));
    const roundTrip=(a:RailPoint,b:RailPoint)=>accessible(a,b)&&accessible(b,a);
    return split&&laneOf(station.point)?relayLinks.some(({ports})=>roundTrip(home.point,ports[0].point)&&roundTrip(ports[1].point,station.point)):
      roundTrip(home.point,station.point);
  }).length:null;
  const unreachablePorts=campus?[...places.values()].filter(station=>station.type==='tool'&&
    (!rail.routes(home.point,station.point,useBypass).length||!rail.routes(station.point,home.point,useBypass).length))
    .map(station=>station.point.id):[];
  const result={
    input,policy,stations:[...places.values()],edges:rail.edges,vehicles,lots,work,transfers,bookings,requests,relays,topology,
    reachablePorts,stalledAt,outageBlock:affectedBlock,outagePort:closure.point.id,campusFloor:campus?.floor,
    conflictTimes:reservationConflicts(bookings),queueWindows,downtime,maintenanceStation,unreachablePorts,
  };
  return {...result,metrics:metricsAt(result,input.horizon)};
}

export function metricsAt(result:Omit<ExperimentResult,'metrics'>,time:number):ExperimentMetrics {
  const {input,lots,transfers,work,vehicles,requests}=result;
  const complete=lots.filter(lot=>lot.completed!==undefined&&lot.completed<=time);
  const completed=complete.filter(lot=>!lot.test&&!lot.empty&&!lot.held);
  const delivered=transfers.filter(trip=>trip.delivery<=time);
  const picked=transfers.filter(trip=>trip.pickup<=time);
  const breakdownEnd=input.outageAt+input.outageLength;
  const restoredAt=input.outage==='lift'?result.relays.filter(move=>move.relay===0).map(move=>move.end):result.outageBlock?result.bookings.filter(booking=>
    booking.resource===result.outageBlock&&booking.start>=breakdownEnd-1e-7).map(booking=>booking.end):
    delivered.filter(trip=>input.outage==='vehicle'?trip.vehicle===1:input.outage==='port'&&
      (trip.source===result.outagePort||trip.destination===result.outagePort)).map(trip=>trip.delivery);
  const restored=restoredAt.reduce((first,end)=>end>=breakdownEnd&&end<=time?Math.min(first,end):first,Infinity);
  const duration=(segment:{start:number;end:number})=>Math.max(0,Math.min(time,segment.end)-segment.start);
  const movement=vehicles.flatMap(vehicle=>vehicle.motion);
  const mean=(values:number[])=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
  const pct=(part:number,whole:number)=>whole>0?100*part/whole:null;
  const pickup=picked.map(trip=>trip.pickup-trip.requested);
  const handoff=delivered.map(trip=>trip.delivery-trip.requested);
  const process=work.filter(run=>run.start<=time&&run.wait!==undefined).map(run=>run.wait!);
  const startedByLot=new Map<number,ExperimentWork[]>();
  for(const run of work){
    const started=startedByLot.get(run.lot)??[];
    started.push(run);startedByLot.set(run.lot,started);
  }
  const incomplete=requests.filter(request=>request.time<=time&&(request.cancelled??Infinity)>time&&(request.delivered??Infinity)>time);
  const tools=result.stations.filter(station=>station.type==='tool');
  const storage=result.stations.filter(station=>station.type==='buffer'||station.type==='relay');
  const capacities=new Map(result.stations.map(station=>[station.point.id,station]));
  const residency=lots.flatMap(lot=>lot.locations.flatMap((place,i)=>place.slot===null?[]:[{place,
    start:place.time,end:lot.locations[i+1]?.time??time}]));
  const occupied=(group:'buffer'|'tool')=>residency.reduce((sum,span)=>{
    const kind=capacities.get(span.place.point.id)?.type;
    return sum+(kind===group||group==='buffer'&&kind==='relay'?duration(span):0);
  },0);
  const toolSpan=occupied('tool'),storageSpan=occupied('buffer');
  const chamberSpan=work.reduce((sum,run)=>{
    const starts=new Map<number,number>();
    for(const task of run.activities){
      if(task.kind==='load')starts.set(task.chamber,task.start);
      if(task.kind==='unload')sum+=duration({start:starts.get(task.chamber)!,end:task.end});
    }
    return sum;
  },0);
  const intervals=movement.reduce((sum,segment)=>sum+duration(segment),0);
  const hoist=movement.filter(segment=>segment.phase==='pickup'||segment.phase==='drop').reduce((sum,segment)=>sum+duration(segment),0);
  const fromTool=delivered.filter(trip=>capacities.get(trip.source)?.type==='tool'&&trip.planned!=='home');
  const bufferCapacity=storage.reduce((count,station)=>count+station.capacity,0);
  const railMeters=[...new Map(result.edges.filter(edge=>edge.kind!=='siding')
    .map(edge=>[edge.block,Math.hypot(edge.to.x-edge.from.x,edge.to.z-edge.from.z)])).values()].reduce((sum,value)=>sum+value,0);
  function mergeWait(request:ExperimentRequest){
    let sum=0,end=0;
    for(const interval of request.mergeWait){
      sum+=duration({start:Math.max(end,interval.start),end:Math.min(request.dispatched??time,interval.end)});
      end=Math.max(end,interval.end);
    }
    return sum;
  }
  return {
    wafers:completed.length*input.wafers,wph:time>0?completed.length*input.wafers*3600/time:0,lots:completed.length,
    transfers:delivered.length,pickupP95:percentile(pickup,.95),handoffP95:percentile(handoff,.95),
    incomplete:incomplete.length,
    remainingLots:lots.filter(lot=>lot.release<=time&&(lot.completed===undefined||lot.completed>time)).length,
    recovery:Number.isFinite(restored)?restored-breakdownEnd:null,bypasses:delivered.filter(trip=>trip.bypass).length,
    staged:movement.filter(segment=>segment.phase==='stage'&&segment.end<=time&&segment.to.id.startsWith('bay-')).length,
    bufferMoves:delivered.filter(trip=>trip.destination==='stocker'||trip.destination.startsWith('buffer-')).length,
    blockedSeconds:requests.filter(request=>request.fromTool)
      .reduce((total,request)=>total+duration({start:request.time,end:request.pickup??request.cancelled??time}),0),
    emptySeconds:movement.filter(segment=>segment.phase==='empty'||segment.phase==='stage').reduce((total,segment)=>total+duration(segment),0),
    loadedSeconds:movement.filter(segment=>segment.phase==='loaded').reduce((total,segment)=>total+duration(segment),0),
    robotSeconds:work.flatMap(run=>run.activities).filter(activity=>activity.kind!=='process').reduce((total,activity)=>total+duration(activity),0),
    residence:completed.length?completed.reduce((total,lot)=>total+lot.completed!-lot.release,0)/completed.length:null,
    pickupMean:mean(pickup),handoffMean:mean(handoff),processWaitP95:percentile(process,.95),
    dueRate:input.dueTime?pct(completed.filter(lot=>lot.completed!-lot.release<=input.dueTime!).length,
      lots.filter(lot=>!lot.test&&!lot.empty&&(lot.release+input.dueTime!<=time||(lot.completed??Infinity)<=time)).length):null,
    waitViolations:input.maxQueue?lots.reduce((total,lot)=>{
      const started=startedByLot.get(lot.id)??[];
      return total+started.filter((run,index)=>index+1<lot.route.length&&
        Math.min(time,started[index+1]?.start??time)-run.end>input.maxQueue!).length;
    },0):0,
    remainingWait:incomplete.reduce((sum,request)=>sum+time-request.time,0),mergeWait:requests.reduce((sum,request)=>sum+mergeWait(request),0),
    hoistSeconds:hoist,idleToolSeconds:time*tools.reduce((sum,tool)=>sum+tool.capacity,0)-toolSpan,
    chamberUse:pct(chamberSpan,time*tools.length*result.policy.chambers),portUse:pct(toolSpan,time*tools.reduce((sum,tool)=>sum+tool.capacity,0)),
    bufferUse:pct(storageSpan,time*bufferCapacity),vehicleUse:pct(intervals,time*vehicles.length),testLots:complete.filter(lot=>lot.test).length,
    relayMoves:result.relays.filter(move=>move.end<=time).length,relaySeconds:result.relays.reduce((sum,move)=>sum+duration(move),0),
    directRate:pct(fromTool.filter(trip=>capacities.get(trip.destination)?.type==='tool').length,fromTool.length),railMeters,bufferCapacity,
    planChanges:delivered.filter(trip=>capacities.get(trip.destination)?.type==='tool'&&trip.destination!==trip.planned).length,
    recoveryPorts:result.reachablePorts,stallSeconds:Math.max(0,time-(result.stalledAt??time)),
    conflicts:result.conflictTimes.filter(start=>start<=time).length,
    criticalViolations:result.queueWindows.filter(window=>window.deadline<time&&(window.resolved??Infinity)>window.deadline&&
      (window.started??Infinity)>window.deadline+1e-7).length,
    holdCount:result.queueWindows.filter(window=>window.consequence==='hold'&&window.resolved!<=time).length,
    reworkCount:result.queueWindows.filter(window=>window.consequence==='rework'&&window.resolved!<=time).length,
    ...maintenanceMetrics(result.downtime,work,result.maintenanceStation,time),
  };
}
