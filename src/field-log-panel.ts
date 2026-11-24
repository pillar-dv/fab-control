import {fieldEventNames,parseFieldLog,sampleFieldLog,summarizeField,summarizeModel,type FieldLog} from './field-log';
import type {ExperimentResult} from './fab-experiment';
import {upperBound} from './timeline-index';

const amount=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1});
const format=(value:number|null)=>value===null?'—':amount.format(value);

export function createFieldLogPanel(host:HTMLElement,run:()=>ExperimentResult|undefined,seek:(time:number,station:string)=>void){
  host.innerHTML=`<div class="experiment-tools">
    <label>현장 로그 CSV<input data-field="file" type="file" accept=".csv,text/csv"></label>
    <button type="button" data-field="sample">예제 불러오기</button>
    <button type="button" data-field="template">CSV 양식 받기</button>
  </div><p class="experiment-detail">익명화한 UTF-8 CSV를 이 브라우저에서 읽습니다. 시간은 초 또는 시간대가 있는 ISO 시각으로 입력합니다. 작업 ID로 요청·픽업·안착과 공정 시작·종료를 연결합니다.</p>
  <p class="experiment-detail" data-field="status" role="status">비교할 로그를 선택하세요.</p>
  <div data-field="content" hidden>
    <div class="experiment-tools"><label>현장 설비<select data-field="asset"></select></label><label>대응 모형 설비<select data-field="model"></select></label>
      <label>재생 배속<select data-field="speed"><option value="1">1배</option><option value="12" selected>12배</option><option value="60">60배</option><option value="600">600배</option></select></label>
      <button type="button" data-field="play">로그 재생</button><button type="button" data-field="step">다음 이벤트</button>
    </div>
    <div class="experiment-timeline"><label>로그 경과 시간<input type="range" data-field="time" min="0" step="any"></label><output data-field="clock"></output></div>
    <p class="experiment-detail" data-field="latest"></p>
    <div class="experiment-totals"><table><caption data-field="summary"></caption><thead><tr><th scope="col">지표</th><th scope="col">현장 로그</th><th scope="col">모형</th><th scope="col">모형 − 현장</th></tr></thead><tbody data-field="marks"></tbody></table></div>
    <div class="experiment-totals"><table><caption>현재 시점까지 최근 이벤트</caption><thead><tr><th scope="col">초</th><th scope="col">이벤트</th><th scope="col">설비</th><th scope="col">캐리어·로트·웨이퍼</th></tr></thead><tbody data-field="events"></tbody></table></div>
  </div>`;
  const get=<T extends HTMLElement=HTMLElement>(id:string)=>host.querySelector<T>(`[data-field="${id}"]`)!;
  const field=get<HTMLSelectElement>('asset'),model=get<HTMLSelectElement>('model'),slider=get<HTMLInputElement>('time');
  const file=get<HTMLInputElement>('file');
  let log:FieldLog|undefined,time=0,frame=0,request=0,previous=0,lastReadout=0;
  function rows(id:string,values:(string|number)[][]){
    const body=get<HTMLTableSectionElement>(id);body.replaceChildren();
    for(const valuesForRow of values){
      const row=body.insertRow();
      for(const value of valuesForRow)row.insertCell().textContent=String(value);
    }
  }
  function show(){
    if(!log)return;
    slider.value=String(time);
    get('clock').textContent=`${format(time)} / ${format(log.duration)}초`;
    const end=upperBound(log.events,time,event=>event.time);
    const nearby=[];
    for(let i=end-1;i>=0&&nearby.length<10;i--){
      const event=log.events[i];
      if(!field.value||field.value===event.asset)nearby.push(event);
    }
    const latest=nearby[0];
    get('latest').textContent=latest?`${latest.asset} · ${fieldEventNames[latest.kind]} · ${latest.task||latest.carrier||'—'}`:'이 시점에 표시할 이벤트가 없습니다.';
    rows('events',nearby.map(event=>[format(event.time),fieldEventNames[event.kind],event.asset,[event.carrier,event.lot,event.wafer].filter(Boolean).join(' / ')]));
    if(model.value)seek(time,model.value);
  }
  function compare(){
    if(!log)return;
    const current=run(),end=Math.min(log.duration,current?.input.horizon??log.duration);
    const actual=summarizeField(log,end,field.value),simulated=current?summarizeModel(current,end,model.value):undefined;
    const values=[['픽업 대기 P95 (초)',actual.pickup,simulated?.pickup],['운송 요청부터 안착 P95 (초)',actual.handoff,simulated?.handoff],
      ['설비 가공률 (%)',actual.utilization,simulated?.utilization]] as const;
    rows('marks',values.map(([label,observed,expected])=>[label,format(observed),format(expected??null),
      format(observed!==null&&expected!=null?expected-observed:null)]));
    get('summary').textContent=`공통 관찰 ${format(end)}초 · 현장/모형 픽업 ${actual.pickupCount}/${simulated?.pickupCount??'—'}건 · 안착 ${actual.deliveryCount}/${simulated?.deliveryCount??'—'}건 · 대상 설비 ${actual.equipmentCount}/${simulated?.equipmentCount??'—'}대`;
    get('status').textContent=`로그 ${format(log.events.length)}건 · 짝 불일치 ${actual.invalid}건 · 관찰 종료 미완료 운송 ${actual.pending}건`;
    show();
  }
  function refresh(){
    const previous=model.value;
    const tools=run()?.stations.filter(station=>station.type==='tool')??[];
    model.replaceChildren(new Option('전체 설비',''),...tools.map(station=>new Option(station.label,station.point.id)));
    if(tools.some(station=>station.point.id===previous))model.value=previous;
    compare();
  }
  function pause(){cancelAnimationFrame(frame);frame=0;get('play').textContent='로그 재생';}
  function load(source:string){
    log=parseFieldLog(source);pause();time=0;
    field.replaceChildren(new Option('전체 설비',''),...log.assets.map(id=>new Option(id,id)));
    slider.max=String(log.duration);get('content').hidden=false;refresh();
  }
  function advance(now:number){
    if(!log)return;
    time=Math.min(log.duration,time+Math.min(100,now-previous)*Number(get<HTMLSelectElement>('speed').value)/1000);previous=now;
    if(now-lastReadout>=100||time===log.duration){show();lastReadout=now;}
    if(time===log.duration)pause();else frame=requestAnimationFrame(advance);
  }
  file.addEventListener('change',async()=>{
    const selected=file.files?.[0],ticket=++request;
    if(!selected)return;
    try{
      if(selected.size>8*1024*1024)throw Error('8 MB 이하의 CSV를 선택하세요.');
      const source=await selected.text();if(ticket===request)load(source);
    }catch(error){if(ticket===request)get('status').textContent=error instanceof Error?error.message:'CSV를 읽을 수 없습니다.';}
  });
  get('sample').addEventListener('click',()=>{request++;file.value='';load(sampleFieldLog);});
  get('template').addEventListener('click',()=>{
    const url=URL.createObjectURL(new Blob(['\uFEFF',sampleFieldLog],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='fab-event-example.csv';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  get('play').addEventListener('click',()=>{
    if(frame){pause();return;}
    if(!log?.duration)return;
    if(time>=log.duration)time=0;
    previous=lastReadout=performance.now();get('play').textContent='로그 일시정지';frame=requestAnimationFrame(advance);
  });
  get('step').addEventListener('click',()=>{
    if(!log)return;
    pause();time=log.events[upperBound(log.events,time,event=>event.time)]?.time??time;show();
  });
  slider.addEventListener('input',()=>{pause();time=Number(slider.value);show();});
  for(const select of [field,model])select.addEventListener('change',compare);
  return {refresh,pause,dispose(){request++;pause();}};
}
