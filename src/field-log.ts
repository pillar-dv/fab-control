import type {ExperimentResult} from './fab-experiment';
import {mergeSpans} from './fab-constraints';

const header=['time','event','asset_id','carrier_id','lot_id','wafer_id','task_id'];
export const fieldEventNames={move_request:'운송 요청',pickup:'픽업 완료',drop:'로드포트 안착',
  process_start:'가공 시작',process_end:'가공 종료',equipment_down:'정지',equipment_up:'복구'} as const;
type EventKind=keyof typeof fieldEventNames;
export interface FieldEvent {time:number; kind:EventKind; asset:string; carrier:string; lot:string; wafer:string; task:string}
export interface FieldLog {events:FieldEvent[]; duration:number; assets:string[]}

export const sampleFieldLog=`${header.join(',')}
0,process_start,TOOL-A,FOUP-01,LOT-01,,RUN-01
18,process_end,TOOL-A,FOUP-01,LOT-01,,RUN-01
18,move_request,TOOL-A,FOUP-01,LOT-01,,MOVE-01
27,pickup,TOOL-A,FOUP-01,LOT-01,,MOVE-01
46,drop,TOOL-B,FOUP-01,LOT-01,,MOVE-01
50,process_start,TOOL-B,FOUP-01,LOT-01,,RUN-02
76,process_end,TOOL-B,FOUP-01,LOT-01,,RUN-02
84,equipment_down,TOOL-B,,,,
103,equipment_up,TOOL-B,,,,
`;

function tokenize(source:string){
  const records:string[][]=[];
  let row:string[]=[],field='',state:'plain'|'quoted'|'closed'='plain';
  const endField=()=>{row.push(field);field='';state='plain';};
  const endRow=()=>{endField();if(row.some(cell=>cell.trim()))records.push(row);row=[];};
  for(let index=0;index<source.length;index++){
    const char=source[index];
    if(state==='quoted'){
      if(char==='"'&&source[index+1]==='"'){field+='"';index++;}
      else if(char==='"')state='closed';
      else field+=char;
    }else if(char===',')endField();
    else if(char==='\r'||char==='\n'){
      if(char==='\r'&&source[index+1]==='\n')index++;
      endRow();
    }else if(char==='"'&&!field&&state==='plain')state='quoted';
    else if(state==='closed'||char==='"')throw Error(`${records.length+1}행의 따옴표 형식을 확인하세요.`);
    else field+=char;
  }
  if(state==='quoted')throw Error('닫히지 않은 CSV 따옴표가 있습니다.');
  endRow();
  return records;
}

export function parseFieldLog(source:string):FieldLog {
  const [titles,...data]=tokenize(source.replace(/^\uFEFF/,''));
  const names=titles?.map(cell=>cell.trim())??[];
  if(new Set(names).size!==names.length||header.some(title=>!names.includes(title)))
    throw Error('필수 열은 '+header.join(', ')+'입니다.');
  if(!data.length||data.length>50000)throw Error('이벤트 1~50,000행을 불러올 수 있습니다.');
  const offsets=header.map(title=>names.indexOf(title));
  let first=Infinity,last=-Infinity,type:string|undefined;
  const events=data.map((row,index):FieldEvent=>{
    const [raw,event,asset,carrier,lot,wafer,task]=offsets.map(offset=>row[offset]?.trim()??'');
    const numeric=/^\d+(?:\.\d+)?$/.test(raw);
    const format=numeric?'seconds':'timestamp';
    const timestamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(raw);
    const time=numeric?Number(raw):timestamp?Date.parse(raw)/1000:NaN;
    if(row.length!==names.length||!asset||!Object.hasOwn(fieldEventNames,event)||!Number.isFinite(time)||type&&type!==format)
      throw Error(`${index+2}행의 시각, 이벤트 유형 또는 설비 ID를 확인하세요.`);
    if(event.startsWith('move')||event==='pickup'||event==='drop'){
      if(!task||!carrier)throw Error(`${index+2}행에 운송 작업 ID와 캐리어 ID가 필요합니다.`);
    }else if(event.startsWith('process')&&(!task||!lot))throw Error(`${index+2}행에 공정 작업 ID와 로트 ID가 필요합니다.`);
    type=format;first=Math.min(first,time);last=Math.max(last,time);
    return {time,kind:event as EventKind,asset,carrier,lot,wafer,task};
  }).sort((a,b)=>a.time-b.time);
  for(const event of events)event.time-=first;
  return {events,duration:last-first,assets:[...new Set(events.map(event=>event.asset))].sort()};
}

const p95=(values:number[])=>values.length?values.sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]:null;
export function summarizeField(log:FieldLog,end:number,asset=''){
  const moves=new Map<string,{request:FieldEvent;pickup?:number}>(),processes=new Map<string,FieldEvent>(),down=new Map<string,number>();
  const work=new Map<string,{start:number;end:number}[]>(),pauses=new Map<string,{start:number;end:number}[]>();
  const pickup:number[]=[],handoff:number[]=[];
  const seen=new Set<string>();
  let invalid=0;
  function add(target:typeof work,id:string,start:number,finish:number){
    const spans=target.get(id)??[];spans.push({start,end:finish});target.set(id,spans);
  }
  for(const event of log.events){
    if(event.time>end)break;
    seen.add(event.asset);
    const key=JSON.stringify([event.task,event.carrier,event.lot,event.wafer]);
    if(event.kind==='move_request'){
      if(moves.has(key))invalid++;
      else moves.set(key,{request:event});
    }else if(event.kind==='pickup'||event.kind==='drop'){
      const move=moves.get(key);
      if(!move||(event.kind==='pickup'?move.pickup!==undefined:move.pickup===undefined)){invalid++;continue;}
      if(event.kind==='pickup'){
        move.pickup=event.time;
        if(!asset||asset===move.request.asset)pickup.push(event.time-move.request.time);
      }else{
        if(!asset||asset===move.request.asset)handoff.push(event.time-move.request.time);
        moves.delete(key);
      }
    }else if(event.kind==='process_start'||event.kind==='process_end'){
      const scope=JSON.stringify([key,event.asset]);
      const first=processes.get(scope);
      if(event.kind==='process_start'){
        if(first)invalid++;
        else processes.set(scope,event);
      }else if(first){add(work,event.asset,first.time,event.time);processes.delete(scope);}
      else invalid++;
    }else if(event.kind==='equipment_down'){
      if(down.has(event.asset))invalid++;
      else down.set(event.asset,event.time);
    }else{
      const start=down.get(event.asset);
      if(start===undefined)invalid++;
      else {add(pauses,event.asset,start,event.time);down.delete(event.asset);}
    }
  }
  for(const event of processes.values())add(work,event.asset,event.time,end);
  for(const [id,start] of down)add(pauses,id,start,end);
  const productionAssetIds=new Set([...work.keys(),...pauses.keys()]);
  const population=asset?(seen.has(asset)?[asset]:[]):[...productionAssetIds];
  return {pickup:p95(pickup),handoff:p95(handoff),pickupCount:pickup.length,deliveryCount:handoff.length,
    utilization:utilization(population,work,pauses,end),equipmentCount:population.length,invalid,
    pending:[...moves.values()].filter(move=>!asset||move.request.asset===asset).length};
}

function utilization(assets:string[],work:ReadonlyMap<string,readonly {start:number;end:number}[]>,
  pauses:ReadonlyMap<string,readonly {start:number;end:number}[]>,end:number){
  if(end<=0||!assets.length)return null;
  let total=0;
  for(const asset of assets){
    const downtime=mergeSpans(pauses.get(asset)??[]);
    for(const span of mergeSpans(work.get(asset)??[])){
      const length=Math.max(0,Math.min(span.end,end)-span.start);
      const lost=downtime.reduce((sum,item)=>sum+Math.max(0,Math.min(item.end,span.end,end)-Math.max(item.start,span.start)),0);
      total+=Math.max(0,length-lost);
    }
  }
  return 100*total/(assets.length*end);
}

export function summarizeModel(record:ExperimentResult,end:number,asset=''){
  const tools=record.stations.filter(station=>station.type==='tool'&&(!asset||asset===station.point.id)).map(station=>station.point.id);
  const work=new Map(tools.map(id=>[id,record.work.filter(run=>run.station===id)]));
  const pauses=new Map(tools.map(id=>[id,record.downtime.filter(window=>window.station===id)]));
  const trips=record.transfers.filter(trip=>!asset||trip.source===asset);
  const pickups=trips.filter(trip=>trip.pickup<=end),deliveries=trips.filter(trip=>trip.delivery<=end);
  return {pickup:p95(pickups.map(trip=>trip.pickup-trip.requested)),handoff:p95(deliveries.map(trip=>trip.delivery-trip.requested)),
    pickupCount:pickups.length,deliveryCount:deliveries.length,equipmentCount:tools.length,utilization:utilization(tools,work,pauses,end)};
}
