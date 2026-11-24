import {runExperiment,type ExperimentInput,type ExperimentPolicy,type ExperimentResult} from './fab-experiment';
import type {ProductId} from './simulation';

export type TrafficKind='production'|'test'|'carrier'|'empty';
export const trafficNames:Record<TrafficKind,string>={production:'생산 로트',test:'시험 로트',carrier:'빈 FOUP',empty:'빈 차량'};
const mean=(values:number[])=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
const p95=(values:number[])=>values.length?values.sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]:null;

export function analyzeTraffic(record:ExperimentResult,kind:TrafficKind,product?:ProductId){
  const rows=new Map<string,{source:string;destination:string;count:number;sample:number[];pickup:number[];pending:number}>();
  function collect(source:string,destination:string,seconds:number|null,pickup:number|null=null){
    if(source===destination)return;
    const key=source+' → '+destination;
    const row=rows.get(key)??{source,destination,count:0,sample:[],pickup:[],pending:0};
    row.count++;
    if(seconds===null)row.pending++;
    else row.sample.push(seconds);
    if(pickup!==null)row.pickup.push(pickup);
    rows.set(key,row);
  }
  const horizon=record.input.horizon;
  if(kind==='empty'){
    for(const car of record.vehicles){
      let first:typeof car.motion[number]|undefined,last:typeof car.motion[number]|undefined;
      function flush(){
        if(first&&last&&first.start<=horizon)collect(first.from.id,last.to.id,last.end<=horizon?last.end-first.start:null);
        first=last=undefined;
      }
      for(const motion of car.motion){
        if(motion.phase!=='empty'&&motion.phase!=='stage'){flush();continue;}
        if(last&&(last.end+1e-7<motion.start||motion.phase!==last.phase||last.to.siding))flush();
        first??=motion;last=motion;
      }
      flush();
    }
  }else{
    for(const trip of record.transfers){
      const lot=record.lots[trip.lot-1];
      if((lot.empty?'carrier':lot.test?'test':'production')!==kind||product&&lot.product!==product)continue;
      collect(trip.source,trip.destination,trip.delivery<=horizon?trip.delivery-trip.requested:null,
        trip.pickup<=horizon?trip.pickup-trip.requested:null);
    }
    for(const move of record.relays){
      const lot=record.lots[move.lot-1];
      if((lot.empty?'carrier':lot.test?'test':'production')!==kind||product&&lot.product!==product)continue;
      const requested=record.requests.find(request=>request.lot===move.lot&&request.pickup===move.start&&request.source===move.from.id)?.time??move.start;
      collect(move.from.id,move.to.id,move.end<=horizon?move.end-requested:null,move.start-requested);
    }
    const destinations=new Map(record.stations.map(station=>[station.point.id,station.recipeStation??station.point.id]));
    for(const request of record.requests){
      if(request.delivered!==undefined||request.cancelled!==undefined||request.time>horizon)continue;
      const lot=record.lots[request.lot-1];
      if((lot.empty?'carrier':lot.test?'test':'production')!==kind||product&&lot.product!==product)continue;
      const next=lot.route[lot.step]?.station??'home';
      const destination=record.stations.find(station=>destinations.get(station.point.id)===next)?.point.id??next;
      collect(request.source,destination,null);
    }
  }
  return [...rows.values()].map(row=>({...row,average:mean(row.sample),p95:p95(row.sample),pickupP95:p95(row.pickup)}))
    .sort((a,b)=>b.count-a.count||b.pending-a.pending);
}

export function plannedTraffic(record:ExperimentResult,kind:Exclude<TrafficKind,'empty'>,product?:ProductId){
  const counts=new Map<string,{source:string;destination:string;count:number}>();
  for(const lot of record.lots){
    if((lot.empty?'carrier':lot.test?'test':'production')!==kind||lot.release>record.input.horizon||product&&lot.product!==product)continue;
    const sequence=['home',...lot.route.map(visit=>visit.station),'home'];
    for(let index=1;index<sequence.length;index++){
      const source=sequence[index-1],destination=sequence[index],key=source+' → '+destination;
      const entry=counts.get(key)??{source,destination,count:0};
      entry.count++;counts.set(key,entry);
    }
  }
  return [...counts.values()].sort((a,b)=>b.count-a.count);
}

type FleetSample={wph:number;handoff:number|null;incomplete:number;violations:number;minWph:number};

export async function compareFleet(input:ExperimentInput,policies:readonly [ExperimentPolicy,ExperimentPolicy],repetitions:number,
  signal?:AbortSignal){
  const target=input.targetWph??0;
  const rows:{fleet:number;results:FleetSample[]}[]=[];
  for(let fleet=1;fleet<=6;fleet++){
    const results=[];
    for(const policy of policies){
      const samples=[];
      for(let repeat=0;repeat<repetitions;repeat++){
        await new Promise(resolve=>setTimeout(resolve,0));
        signal?.throwIfAborted();
        samples.push(runExperiment({...input,fleet,seed:(input.seed??1)+repeat},policy).metrics);
      }
      results.push({wph:mean(samples.map(sample=>sample.wph))!,handoff:mean(samples.flatMap(sample=>sample.handoffP95??[])),
        incomplete:mean(samples.map(sample=>sample.incomplete))!,violations:Math.max(...samples.map(sample=>sample.waitViolations+sample.conflicts)),
        minWph:Math.min(...samples.map(sample=>sample.wph))});
    }
    rows.push({fleet,results});
  }
  return {rows,minimum:policies.map((_,i)=>target>0?rows.find(row=>row.results[i].minWph>=target&&row.results[i].violations===0)?.fleet??null:null),
    fastest:policies.map((_,i)=>rows.filter(row=>row.results[i].handoff!==null&&row.results[i].wph>0)
      .sort((a,b)=>a.results[i].handoff!-b.results[i].handoff!||a.results[i].incomplete-b.results[i].incomplete)[0]?.fleet??null)};
}
