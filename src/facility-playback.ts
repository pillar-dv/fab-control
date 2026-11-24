import type {CampusResult} from './campus';
import type {CampusZone} from './campus-layout';

export interface PlaybackWindow {start:number; end:number}
export type MachineKind='barrier'|'yard'|'dock'|'scan'|'rack'|'probe'|'dicer'|'bonder'|'tester'|'reel'|'tray'|'chiller'|'cargo'|'smt'|'analysis';
export interface FacilityMachine {id:string; label:string; kind:MachineKind; modelId?:string}
export interface FacilityClip extends PlaybackWindow {unit:string; label:string; reference?:string; direction?:'in'|'out'}
export interface FacilityPlayback {machines:FacilityMachine[]; clips:FacilityClip[]; windows:PlaybackWindow[]}

const machine=(id:string,label:string,kind:MachineKind,modelId?:string):FacilityMachine=>({id,label,kind,modelId});

export function mergePlaybackWindows(windows:readonly PlaybackWindow[]):PlaybackWindow[]{
  const merged:PlaybackWindow[]=[];
  for(const window of windows.filter(item=>item.end>item.start).sort((a,b)=>a.start-b.start)){
    const previous=merged.at(-1);
    if(previous&&window.start<=previous.end)previous.end=Math.max(previous.end,window.end);
    else merged.push({start:window.start,end:window.end});
  }
  return merged;
}

export function startPlayback(time:number,windows:readonly PlaybackWindow[]){
  const next=windows.find(item=>item.end>time)??windows[0];
  return next?time>=next.start&&time<next.end?time:next.start:time;
}

export function advancePlayback(time:number,seconds:number,windows:readonly PlaybackWindow[]){
  if(!windows.length)return time;
  const current=startPlayback(time,windows);
  let remaining=seconds%windows.reduce((sum,item)=>sum+item.end-item.start,0);
  let index=windows.findIndex(item=>item.start<=current&&item.end>current);
  remaining+=current-windows[index].start;
  while(remaining>=windows[index].end-windows[index].start){
    remaining-=windows[index].end-windows[index].start;
    index=(index+1)%windows.length;
  }
  return windows[index].start+remaining;
}

export function facilityPlayback(run:CampusResult,zone:CampusZone):FacilityPlayback{
  const lanes=(prefix:string,count:number,kind:MachineKind,modelId?:string)=>Array.from({length:count},(_,i)=>{
    const label=count===1?prefix:prefix+'-'+(i+1);
    return machine(label,label,kind,modelId);
  });
  const machines=({
    gate:[machine('차량 등록','차량 등록 차단기','barrier')],
    yard:[machine('queue','대기 차량 주차면','yard')],
    receiving:[...lanes('하역 도크',run.input.docks,'dock'),machine('입고 검사','입고 라벨 검사','scan')],
    materials:[machine('rack','자재 자동창고','rack')],
    quarantine:[machine('rack','격리 보관 랙','rack')],
    sort:[machine('웨이퍼 프로버','웨이퍼 프로버','probe','accretech-fp3000w'),machine('다이 절단기','다이 절단기','dicer','disco-dfd6363')],
    assembly:[machine('2.5D 조립','2.5D 다이 배치','bonder','besi-datacon-8800-chameo-ultra-plus-ac'),machine('플립칩 조립','플립칩 다이 배치','bonder')],
    utilities:[machine('cooling','냉수·응축수 계통','chiller')],
    test:lanes('ATE',run.input.testLanes,'tester','advantest-v93000-exa-scale'),
    packing:[machine('tray','트레이 포장','tray'),machine('reel','테이프·릴 포장','reel'),machine('scan','출하 상자 라벨 검사','scan')],
    finished:[machine('rack','완제품 자동창고','rack')],
    returns:[machine('analysis','반품 식별·고장 분석대','analysis')],
    supplier:[machine('cargo','자재 출발 도크','cargo')],
    distribution:[machine('cargo','인수·출고 이송대','cargo')],
    board:[machine('board','기판 모듈 조립대','smt')],
    customer:[machine('cargo','고객 인수·반품 이송대','cargo')],
  } satisfies Partial<Record<CampusZone,FacilityMachine[]>> as Partial<Record<CampusZone,FacilityMachine[]>>)[zone]??[];
  const clips:FacilityClip[]=[];
  const add=(span:PlaybackWindow,unit:string,label:string,reference?:string,direction?:FacilityClip['direction'])=>{
    if(span.end>span.start)clips.push({start:span.start,end:span.end,unit,label,reference,direction});
  };
  for(const item of run.work.filter(item=>item.zone===zone)){
    if(zone==='packing'){
      const boundary=item.start+(item.end-item.start)*.72;
      const reel=run.orders.some(order=>order.id===item.order&&order.product==='npu');
      add({start:item.start,end:boundary},reel?'reel':'tray',reel?'테이프·릴 포장':'트레이 포장',item.job);
      add({start:boundary,end:item.end},'scan','출하 라벨 확인',item.job);
    }else add(item,item.lane,item.job,item.order);
  }
  if(zone==='yard'){
    for(const move of run.moves.filter(item=>item.from===zone&&item.to===zone))add(move,'queue','하역 도크 대기',move.ref);
  }
  if(zone==='materials'||zone==='quarantine'||zone==='finished'||zone==='supplier'||zone==='distribution'||zone==='customer'){
    const warehouse=zone==='materials'||zone==='quarantine'||zone==='finished';
    for(const move of run.moves){
      if(move.to===zone)add({start:Math.max(move.start,move.end-5),end:move.end},warehouse?'rack':'cargo',warehouse?'입고 적치':'인수',move.ref,'in');
      if(move.from===zone)add({start:move.start,end:Math.min(move.end,move.start+5)},warehouse?'rack':'cargo',warehouse?'출고 인출':'출발',move.ref,'out');
    }
  }
  if(zone==='utilities'){
    const work=Object.values(run.fabRuns).flatMap(site=>site.work);
    for(const window of mergePlaybackWindows(work))add(window,'cooling','팹 공정 가동에 연동한 냉각 루프');
  }
  if(zone==='board'){
    for(const box of run.boxes.filter(item=>item.route==='board')){
      const incoming=run.moves.find(move=>move.to==='board'&&move.ref===box.id);
      const outgoing=run.moves.find(move=>move.from==='board'&&move.ref===box.id);
      if(incoming&&outgoing)add({start:incoming.end,end:outgoing.start},'board','보드용 패키지 장착',box.id);
    }
  }
  if(zone==='returns'){
    for(const item of run.returns)add({start:item.received,end:item.inspected},'analysis','반품 인수·고장 분석',item.box);
  }
  clips.sort((a,b)=>a.start-b.start);
  return {machines,clips,windows:mergePlaybackWindows(clips)};
}
