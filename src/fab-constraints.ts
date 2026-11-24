import type {ProductId} from './simulation';

export interface QueueRule {
  product:ProductId;
  fromStep:string;
  toStep:string;
  seconds:number;
  consequence:'hold'|'rework';
}
export interface QueueWindow {
  lot:number;
  from:number;
  to:number;
  entered:number;
  deadline:number;
  started?:number;
  resolved?:number;
  consequence?:'hold'|'rework';
}
export interface MaintenanceInput {station:string; start:number; length:number; meanFailure:number; repair:number}
export interface EquipmentDowntime {station:string; start:number; end:number; kind:'planned'|'failure'}

export function maintenanceWindows(input:MaintenanceInput,station:string,horizon:number,offset:number,random:(index:number)=>number){
  const windows:EquipmentDowntime[]=[];
  const start=Math.max(0,input.start+offset);
  if(input.length>0&&start<horizon)windows.push({station,start,end:start+input.length,kind:'planned'});
  if(input.meanFailure>0&&input.repair>0){
    let failure=0;
    for(let index=0;index<512;index++){
      failure+=Math.max(1,-input.meanFailure*Math.log(Math.max(.00001,1-random(index))));
      if(failure>=horizon)break;
      windows.push({station,start:failure,end:failure+input.repair,kind:'failure'});
      failure+=input.repair;
    }
  }
  return windows.sort((a,b)=>a.start-b.start);
}

export function mergeSpans(items:readonly {start:number;end:number}[]){
  const merged:{start:number;end:number}[]=[];
  for(const span of [...items].sort((a,b)=>a.start-b.start)){
    const last=merged.at(-1);
    if(last&&span.start<=last.end)last.end=Math.max(last.end,span.end);
    else merged.push({...span});
  }
  return merged;
}

export function workingClock(start:number,downtime:readonly {start:number;end:number}[]){
  return (time:number)=>{
    let wall=time;
    for(const pause of downtime){
      if(pause.end<=start||pause.start>wall)continue;
      wall+=pause.end-Math.max(pause.start,start);
    }
    return wall;
  };
}

export function maintenanceMetrics(downtime:readonly EquipmentDowntime[],work:readonly {station:string;start:number;end:number}[],
  station:string|undefined,time:number){
  if(!station||time<=0)return {availability:null,productive:null,standby:null,plannedDowntime:0,faultDowntime:0,mtbf:null,mttr:null};
  const duration=(span:{start:number;end:number})=>Math.max(0,Math.min(time,span.end)-span.start);
  const all=mergeSpans(downtime);
  const scheduled=downtime.filter(item=>item.kind==='planned');
  const failures=downtime.filter(item=>item.kind==='failure');
  const lost=all.reduce((total,span)=>total+duration(span),0);
  const plannedDowntime=mergeSpans(scheduled).reduce((total,span)=>total+duration(span),0);
  const faultDowntime=mergeSpans(failures).reduce((total,span)=>total+duration(span),0);
  const productive=mergeSpans(work.filter(item=>item.station===station)).reduce((total,span)=>{
    const pauses=all.reduce((sum,pause)=>sum+duration({start:Math.max(pause.start,span.start),end:Math.min(pause.end,span.end)}),0);
    return total+Math.max(0,duration(span)-pauses);
  },0);
  const observed=failures.filter(item=>item.start<=time).length;
  const repaired=failures.filter(item=>item.end<=time);
  return {availability:100*(time-lost)/time,productive,standby:Math.max(0,time-lost-productive),plannedDowntime,faultDowntime,
    mtbf:observed?(time-lost)/observed:null,mttr:repaired.length?repaired.reduce((sum,item)=>sum+item.end-item.start,0)/repaired.length:null};
}
