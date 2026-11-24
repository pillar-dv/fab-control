export type EventMeasure = 'start'|'finish'|'delivery'|'pickup'|'handoff';
export type SpanMeasure = 'process'|'present'|'chamber'|'port'|'stocker'|'blocked'|'empty'|'loaded'|'hoist'|'mergeWait'|'vehicle';
export interface MetricCycle {
  duration:number;
  tools:string[];
  ports:string[];
  slots:number;
  home:string;
  vehicles:number;
  events:{kind:EventMeasure;time:number;seconds?:number}[];
  spans:{kind:SpanMeasure;from:number;to:number;station?:string}[];
}
export interface MetricTimeline {
  elapsed:number;
  blocks:ReadonlyArray<{cycle:MetricCycle;count:number}>;
}

export const metricGroups = {
  production:'생산·재공', equipment:'설비', transport:'운송', quality:'품질', maintenance:'정비', resources:'자원·비용',
} as const;
export type MetricGroup = keyof typeof metricGroups;

export const metrics = {
  completed: {group:'production', name:'누적 완료 웨이퍼', unit:'장', help:'전체 공정을 마치고 스토커에 복귀한 추적 웨이퍼.'},
  wph: {group:'production', name:'시간당 생산량', unit:'장/h', help:'누적 완료 웨이퍼 ÷ 시뮬레이션 경과 시간(h).'},
  hour: {group:'production', name:'최근 1시간 완료', unit:'장', help:'현재 시점에서 최근 시뮬레이션 1시간 동안 완료한 웨이퍼.'},
  shift: {group:'production', name:'현재 교대 완료', unit:'장', help:'운전 시작을 기준으로 나눈 8시간 교대의 완료량.'},
  day: {group:'production', name:'현재 일자 완료', unit:'장', help:'운전 시작을 기준으로 나눈 24시간 일자의 완료량.'},
  starts: {group:'production', name:'누적 투입 웨이퍼', unit:'장', help:'각 회차 시작에 스토커로 투입한 추적 웨이퍼.'},
  target: {group:'production', name:'생산 목표 달성률', unit:'%', help:'현재 시간당 생산량 ÷ 입력한 시간당 목표.'},
  wip: {group:'production', name:'재공품(WIP)', unit:'장', help:'투입 이후 완료를 기다리는 웨이퍼. 가공·대기·운송을 포함합니다.'},
  cycleMean: {group:'production', name:'생산 소요 시간 평균', unit:'초', help:'투입부터 스토커 복귀까지 완료 웨이퍼의 평균.'},
  cycleP95: {group:'production', name:'생산 소요 시간 P95', unit:'초', help:'투입부터 스토커 복귀까지 완료 웨이퍼의 95백분위.'},
  onTime: {group:'production', name:'납기 준수율', unit:'%', help:'완료 웨이퍼와 납기가 지난 미완료 웨이퍼 중 목표 시간 안에 복귀한 비율.'},
  utilization: {group:'equipment', name:'설비 가공률', unit:'%', help:'공정에 배정된 장비의 실제 가공 시간 비율.'},
  processing: {group:'equipment', name:'설비 가공시간', unit:'초', help:'공정에 배정된 장비의 실제 가공 시간을 합산합니다.'},
  starved: {group:'equipment', name:'웨이퍼 공급 대기', unit:'초', help:'배정 장비의 포트 또는 노광 스테이지에 웨이퍼가 없는 시간을 합산합니다.'},
  blocked: {group:'equipment', name:'장비 반출 대기', unit:'초', help:'장비 내부 작업과 도킹 해제 후 OHT가 용기를 집기까지의 시간을 합산합니다.'},
  chamber: {group:'equipment', name:'챔버·스테이지 점유율', unit:'%', help:'배정 설비별로 모델링한 공정 위치 한 곳의 점유율. 챔버 전체 설치 대수는 모델에 포함되지 않습니다.'},
  ports: {group:'equipment', name:'로드포트 점유율', unit:'%', help:'생산 경로에 쓰이는 로드포트에서 FOUP 안착부터 인양 완료까지의 점유 비율.'},
  storage: {group:'equipment', name:'스토커 보관 슬롯 점유율', unit:'%', help:'모델의 스토커 보관 위치 두 곳이 점유된 시간 비율.'},
  deliveries: {group:'transport', name:'운송 완료', unit:'건', help:'FOUP가 인계 위치에 안착한 횟수.'},
  pickupMean: {group:'transport', name:'픽업 대기 평균', unit:'초', help:'FOUP가 출고 가능해진 시점부터 OHT가 집기까지의 평균.'},
  pickupP95: {group:'transport', name:'픽업 대기 P95', unit:'초', help:'FOUP가 출고 가능해진 시점부터 OHT가 집기까지의 95백분위.'},
  handoffMean: {group:'transport', name:'공정 종료부터 다음 시작 평균', unit:'초', help:'출발 설비의 마지막 공정 종료부터 다음 설비의 첫 공정 시작까지.'},
  handoffP95: {group:'transport', name:'공정 종료부터 다음 시작 P95', unit:'초', help:'출발 설비의 마지막 공정 종료부터 다음 설비의 첫 공정 시작까지의 95백분위.'},
  emptyRatio: {group:'transport', name:'빈 차 이동 비율', unit:'%', help:'빈 차와 적재 상태 주행시간 합계 중 빈 차 주행시간의 비율.'},
  empty: {group:'transport', name:'빈 차 이동', unit:'초', help:'가용 차량의 빈 차 주행시간 합계.'},
  loaded: {group:'transport', name:'적재 이동', unit:'초', help:'FOUP를 들어 올린 뒤 목적지까지 적재 상태로 주행한 시간 합계.'},
  hoist: {group:'transport', name:'OHT 승강 시간', unit:'초', help:'픽업과 인계 때 파지부의 하강·상승 시간 합계.'},
  mergeWait: {group:'transport', name:'레일 충돌 회피 대기', unit:'초', help:'다른 차량의 선행 예약과 겹쳐 출발을 늦춘 시간 합계.'},
  busy: {group:'transport', name:'OHT 사용률', unit:'%', help:'전체 가용 차량 시간 중 배차부터 지선 복귀까지 사용된 비율.'},
  good: {group:'quality', name:'양품 다이 수', unit:'개', help:'입력한 검사 결과에서 합산한 양품 다이 수.'},
  yield: {group:'quality', name:'다이 수율', unit:'%', help:'양품 다이 ÷ 검사 다이.'},
  rework: {group:'quality', name:'웨이퍼 재작업률', unit:'%', help:'재작업 웨이퍼 ÷ 기록 대상 웨이퍼.'},
  scrap: {group:'quality', name:'웨이퍼 폐기율', unit:'%', help:'폐기 웨이퍼 ÷ 기록 대상 웨이퍼.'},
  failures: {group:'maintenance', name:'고장 건수', unit:'건', help:'정비 기록에 입력한 비계획 고장 횟수.'},
  downtime: {group:'maintenance', name:'비계획 정지시간', unit:'h', help:'정비 기록의 고장 복구시간 총합.'},
  mtbf: {group:'maintenance', name:'평균 고장 간격(MTBF)', unit:'h', help:'기록한 정상 가동시간 ÷ 고장 횟수.'},
  mttr: {group:'maintenance', name:'평균 복구 시간(MTTR)', unit:'h', help:'기록한 고장 복구시간 ÷ 고장 횟수.'},
  energy: {group:'resources', name:'웨이퍼당 전력', unit:'kWh/장', help:'측정 구간의 전력량 ÷ 같은 구간의 웨이퍼 수.'},
  water: {group:'resources', name:'웨이퍼당 용수', unit:'L/장', help:'측정 구간의 용수량 ÷ 같은 구간의 웨이퍼 수.'},
  cost: {group:'resources', name:'양품 다이당 비용', unit:'원/개', help:'측정 구간의 총비용 ÷ 같은 구간의 양품 다이 수.'},
} as const satisfies Record<string,{group:MetricGroup;name:string;unit:string;help:string}>;
export type MetricId = keyof typeof metrics;
export type MetricValues = Record<MetricId,number|null>;

const numberField = (label:string,unit:string,whole=false)=>({label,unit,whole});
export const recordedMetrics = {
  quality: {
    tested:numberField('검사 다이','개',true), good:numberField('양품 다이','개',true),
    wafers:numberField('기록 대상 웨이퍼','장',true), reworked:numberField('재작업 웨이퍼','장',true), scrapped:numberField('폐기 웨이퍼','장',true),
  },
  maintenance: {
    failures:numberField('고장 건수','건',true), uptime:numberField('정상 가동시간','h'), downtime:numberField('고장 복구시간','h'),
  },
  resources: {
    wafers:numberField('측정 대상 웨이퍼','장',true), energy:numberField('사용 전력량','kWh'), water:numberField('사용 용수량','L'),
    cost:numberField('총비용','원'), good:numberField('같은 구간의 양품 다이','개',true),
  },
} as const;
export type RecordGroup = keyof typeof recordedMetrics;
export type Measurement = {time:number;group:RecordGroup;values:Record<string,number>};
export interface Targets {wph:number|null;dueSeconds:number|null}

export function validateMeasurement(group:RecordGroup, values:Record<string,number>):string|null {
  const fields=Object.entries(recordedMetrics[group]);
  if(fields.some(([key,field])=>!Number.isFinite(values[key])||values[key]<0||(field.whole&&!Number.isSafeInteger(values[key]))))
    return '각 항목에 0 이상의 유효한 값을 입력하세요. 수량은 정수로 입력합니다.';
  if(group==='quality'&&(values.good>values.tested||values.reworked>values.wafers||values.scrapped>values.wafers))
    return '양품은 검사 다이 수 이하, 재작업·폐기는 각각 기록 대상 웨이퍼 수 이하여야 합니다.';
  if(group==='maintenance'&&values.failures===0&&values.downtime>0)
    return '고장 복구시간을 집계하려면 한 건 이상의 고장을 입력하세요.';
  return null;
}

const hour=3600;
const divide=(value:number,total:number)=>total>0?value/total:null;
const percent=(value:number,total:number)=>divide(value*100,total);
// Completed repetitions share one schedule. Count events and clip spans without replaying every repetition.
const eventCount=(time:number,origin:number,period:number,offset:number,count:number)=>
  Math.max(0,Math.min(count,Math.floor((time-origin-offset+1e-9)/period)+1));

function spanTime(time:number,origin:number,period:number,span:{from:number;to:number},count:number){
  const elapsed=Math.max(0,Math.min(count*period,time-origin));
  const full=Math.floor(elapsed/period);
  return full*(span.to-span.from)+Math.max(0,Math.min(span.to-span.from,elapsed-full*period-span.from));
}

type Sample = {seconds:number;count:number};
function stats(samples:Sample[]){
  const count=samples.reduce((sum,sample)=>sum+sample.count,0);
  const mean=divide(samples.reduce((sum,sample)=>sum+sample.count*sample.seconds,0),count);
  let rank=Math.ceil(.95*count),p95:number|null=null;
  for(const sample of samples.sort((a,b)=>a.seconds-b.seconds)){
    rank-=sample.count;
    if(rank<=0){p95=sample.seconds;break;}
  }
  return {mean,p95};
}

export function measureMetrics(timeline:MetricTimeline,time=timeline.elapsed,targets:Targets={wph:null,dueSeconds:null},records:readonly Measurement[]=[],station=''):MetricValues {
  time=Math.max(0,Math.min(time,timeline.elapsed));
  const eventTotals={start:0,finish:0,delivery:0};
  const windows={hour:Math.max(0,time-hour),shift:Math.floor(time/(8*hour))*8*hour,day:Math.floor(time/(24*hour))*24*hour};
  const periodTotals={hour:0,shift:0,day:0};
  const durations:Record<SpanMeasure,number>={process:0,present:0,chamber:0,port:0,stocker:0,blocked:0,empty:0,loaded:0,hoist:0,mergeWait:0,vehicle:0};
  const samples:{finish:Sample[];pickup:Sample[];handoff:Sample[]}={finish:[],pickup:[],handoff:[]};
  let origin=0,toolTime=0,portTime=0,slotTime=0,vehicleTime=0,onTime=0,dueCount=0;
  for(const {cycle,count} of timeline.blocks){
    if(origin>time+1e-9)break;
    const period=cycle.duration;
    const observed=Math.max(0,Math.min(time-origin,period*count));
    toolTime+=observed*(station?Number(cycle.tools.includes(station)):cycle.tools.length);
    portTime+=observed*(station?Number(cycle.ports.includes(station)):cycle.ports.length);
    if(!station||station===cycle.home)slotTime+=observed*cycle.slots;
    vehicleTime+=observed*cycle.vehicles;
    for(const event of cycle.events){
      const n=eventCount(time,origin,period,event.time,count);
      if(event.kind==='finish'&&targets.dueSeconds!==null){
        dueCount+=eventCount(time,origin,period,Math.min(event.time,targets.dueSeconds),count);
      }
      if(n===0)continue;
      if(event.kind==='start'||event.kind==='finish'||event.kind==='delivery')eventTotals[event.kind]+=n;
      if(event.kind==='finish'){
        if(targets.dueSeconds!==null&&event.time<=targets.dueSeconds)onTime+=n;
        for(const key of ['hour','shift','day'] as const){
          const from=windows[key]-(key==='hour'?0:1e-7);
          periodTotals[key]+=n-eventCount(from,origin,period,event.time,count);
        }
      }
      const seconds=event.seconds??event.time;
      if(event.kind==='finish'||event.kind==='pickup'||event.kind==='handoff')samples[event.kind].push({seconds,count:n});
    }
    for(const span of cycle.spans)if(!station||!span.station||station===span.station)
      durations[span.kind]+=spanTime(time,origin,period,span,count);
    origin+=period*count;
  }
  const cycleStats=stats(samples.finish),pickups=stats(samples.pickup),handoffs=stats(samples.handoff);
  const wph=divide(eventTotals.finish*hour,time);
  const manual=new Map<RecordGroup,Record<string,number>>();
  for(const record of records){
    if(record.time>time)continue;
    const totals=manual.get(record.group)??{};
    for(const [field,value] of Object.entries(record.values))totals[field]=(totals[field]??0)+value;
    manual.set(record.group,totals);
  }
  const quality=manual.get('quality'),maintenance=manual.get('maintenance'),resources=manual.get('resources');
  return {
    completed:eventTotals.finish,wph,...periodTotals,starts:eventTotals.start,
    target:wph!==null&&targets.wph!==null?percent(wph,targets.wph):null,wip:eventTotals.start-eventTotals.finish,
    cycleMean:cycleStats.mean,cycleP95:cycleStats.p95,onTime:targets.dueSeconds===null?null:percent(onTime,dueCount),
    utilization:percent(durations.process,toolTime),processing:durations.process,
    starved:Math.max(0,toolTime-durations.present),blocked:durations.blocked,chamber:percent(durations.chamber,toolTime),
    ports:percent(durations.port,portTime),storage:percent(durations.stocker,slotTime),
    deliveries:eventTotals.delivery,pickupMean:pickups.mean,pickupP95:pickups.p95,handoffMean:handoffs.mean,handoffP95:handoffs.p95,
    emptyRatio:percent(durations.empty,durations.empty+durations.loaded),empty:durations.empty,loaded:durations.loaded,
    hoist:durations.hoist,mergeWait:durations.mergeWait,busy:percent(durations.vehicle,vehicleTime),
    good:quality?.good??null,yield:quality?percent(quality.good,quality.tested):null,
    rework:quality?percent(quality.reworked,quality.wafers):null,scrap:quality?percent(quality.scrapped,quality.wafers):null,
    failures:maintenance?.failures??null,downtime:maintenance?.downtime??null,
    mtbf:maintenance?divide(maintenance.uptime,maintenance.failures):null,mttr:maintenance?divide(maintenance.downtime,maintenance.failures):null,
    energy:resources?divide(resources.energy,resources.wafers):null,water:resources?divide(resources.water,resources.wafers):null,
    cost:resources?divide(resources.cost,resources.good):null,
  };
}
