import {PRODUCTS,type ProductId} from './simulation';
import {baselinePolicy,bufferNames,defaultInput,metricsAt,outageNames,
  type BufferPolicy,type ChamberOrder,type ExperimentInput,type ExperimentMetrics,type ExperimentPolicy,type ExperimentResult,type Outage} from './fab-experiment';
import {createExperimentScene} from './experiment-scene';
import {analyzeTraffic,plannedTraffic,trafficNames,type TrafficKind} from './experiment-analysis';
import type {ExperimentJob,ExperimentReply} from './experiment-worker';
import {railNames,recipeStation,recipeFor} from './experiment-scenarios';
import {equipment} from './equipment';
import {kindFor} from './line-layout';
import type {RailTopology} from './experiment-rail';
import {runWorker} from './simulation-worker';

const alternative:ExperimentPolicy={...baselinePolicy,staging:true,bypass:true,buffer:'direct',chambers:2,order:'unload'};
const metrics:[keyof ExperimentMetrics,string,string][]=[
  ['wph','시간당 완료 웨이퍼','장/h'],['pickupP95','픽업 대기 P95','초'],['handoffP95','운송 요청부터 안착 P95','초'],
  ['incomplete','미완료 운송 요청','건'],['remainingLots','진행 중 로트·빈 FOUP','개'],['lots','완료 생산 로트','개'],
  ['transfers','완료 OHT 운송','건'],['recovery','복구 후 첫 이용','초'],['residence','평균 생산 로트 체류','초'],
  ['blockedSeconds','출발 장비 배출 대기 누계','초'],['emptySeconds','빈 차 이동 누계','초'],
  ['loadedSeconds','적재 이동 누계','초'],['robotSeconds','장비 내 로봇 가동 누계','초'],['bypasses','우회·보조선 사용 운송','건'],
  ['staged','선제 재배치 완료','건'],['bufferMoves','버퍼·스토커 입고','건'],
  ['pickupMean','평균 픽업 대기','초'],['handoffMean','운송 요청부터 안착 평균','초'],['processWaitP95','공정 종료부터 다음 시작 P95','초'],
  ['dueRate','생산 로트 납기 준수율','%'],['waitViolations','공정 간 최대 대기 초과','건'],['remainingWait','미완료 요청 잔여 대기','초'],
  ['mergeWait','합류 예약 대기 누계','초'],['hoistSeconds','OHT 승강 누계','초'],['idleToolSeconds','설비 빈 포트 누계','초'],
  ['chamberUse','챔버 점유율','%'],['portUse','로드포트 점유율','%'],['bufferUse','버퍼 점유율','%'],['vehicleUse','OHT 가동률','%'],
  ['testLots','완료 시험 로트','개'],['relayMoves','루프 간 인계 완료','건'],['relaySeconds','루프 간 인계 장치 가동','초'],
  ['directRate','공정 간 직송 실적','%'],['railMeters','본선·보조선 길이','m'],['bufferCapacity','버퍼·인계 포트 용량','칸'],
  ['planChanges','계획 대비 장비 재배정','건'],['recoveryPorts','폐쇄 중 왕복 가능한 장비','대'],
  ['stallSeconds','운송·공정 진행 중단','초'],['conflicts','자원 점유 충돌','건'],
  ['criticalViolations','레시피 대기시간 위반','건'],['holdCount','대기시간 초과 보류','건'],['reworkCount','대기시간 초과 재작업','건'],
  ['availability','정비 대상 설비 가용률','%'],['productive','정비 대상 설비 가공','초'],['standby','정비 대상 설비 대기','초'],
  ['plannedDowntime','예방정비 시간','초'],['faultDowntime','고장 정지 시간','초'],['mtbf','관찰 평균 고장 간격','초'],['mttr','완료 고장 평균 복구','초'],
];
const number=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1});
const clock=(time:number)=>Math.floor(time/60)+':'+String(Math.floor(time%60)).padStart(2,'0');
const options=(values:Record<string,string>)=>Object.entries(values).map(([id,label])=>`<option value="${id}">${label}</option>`).join('');
const productOptions=options(Object.fromEntries(Object.values(PRODUCTS).map(product=>[product.id,product.name])));
const fields=(name:string,label:string,min:number,max:number,value:number,step=1)=>
  `<label>${label}<input name="${name}" type="number" required min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
const select=(name:string,label:string,values:Record<string,string>)=>`<label>${label}<select name="${name}" aria-label="${label}">${options(values)}</select></label>`;
const rails={0:railNames.loop,1:railNames.bypass,dual:railNames.dual,relay:railNames.relay,vertical:railNames.vertical};
const parseRail=(value:string):RailTopology=>value==='0'?'loop':value==='1'?'bypass':value as RailTopology;
const figure=(value:number|null)=>value===null?'—':number.format(value);

function workerJob(job:ExperimentJob,signal:AbortSignal):Promise<ExperimentReply> {
  return runWorker(()=>new Worker(new URL('./experiment-worker.ts',import.meta.url),{type:'module'}),job,signal);
}

export function createExperimentPanel(host:HTMLElement,fleet:()=>number){
  const dialog=document.createElement('dialog');
  dialog.className='fab-experiment';
  dialog.setAttribute('aria-labelledby','experiment-title');
  dialog.innerHTML=`
    <header class="experiment-header"><div><h2 id="experiment-title">다각화 실험</h2><p>동일한 투입 조건에서 OHT 운송과 설비 운용 정책을 비교합니다.</p></div><button type="button" data-exp="close">닫기</button></header>
    <form data-exp="form" class="experiment-config">
      <fieldset><legend>두 운전에 공통 적용</legend><div class="experiment-fields">
        <label>주 품목<select name="primary">${productOptions}</select></label>
        <label>교대 투입 품목<select name="secondary"><option value="">단일 품목</option>${productOptions}</select></label>
        ${fields('fleet','OHT 대수',1,6,3)}${fields('lots','투입 로트 수',1,20,8)}
        ${fields('wafers','로트당 웨이퍼',1,12,4)}${fields('releaseEvery','투입 간격 (초)',1,180,12)}
        ${fields('horizon','관찰 시간 (초)',60,2400,600,1)}
        <label>장애<select name="outage" aria-label="장애">${options(outageNames)}</select></label>
        ${fields('outageAt','장애 시작 (초)',0,2399,90)}${fields('outageLength','장애 지속 (초)',1,600,55)}
      </div></fieldset>
      <fieldset><legend>대안 정책</legend><div class="experiment-fields">
        ${select('staging','빈 차량 재배치',{0:'출고 대기 지선 복귀',demand:'현재 픽업 수요 기준',1:'완료 예측 기준'})}
        <label>경로<select name="bypass" aria-label="경로">${options(rails)}</select></label>
        <label>포트 대기 정책<select name="buffer">${options(bufferNames)}</select></label>
        <label>혼류 설비<select name="dedicated"><option value="0">호환 설비 공유</option><option value="1">품목별 전용 설비</option></select></label>
        ${fields('chambers','장비당 모형 챔버',1,3,2)}
        <label>장비 로봇 순서<select name="order"><option value="feed">빈 챔버 투입 우선</option><option value="unload">완료 웨이퍼 회수 우선</option></select></label>
      </div><p>기준은 기본 예약 운행, 출발 장비 대기, 호환 설비 공유, 단일 챔버입니다.</p></fieldset>
      <details class="experiment-extra"><summary>투입 일정과 기준 운전</summary><div class="experiment-fields">
        ${select('baselineRail','기준 선로',rails)}${fields('mixPercent','주 품목 투입 비중 (%)',0,100,50)}
        ${select('releasePattern','투입 집중',{regular:'일정 간격',peak:'초반 집중'})}
        ${fields('seed','난수 시작값',0,999999,1)}${fields('jitter','투입 시각 변동 (±초)',0,120,0)}
        ${fields('testEvery','시험 로트 간격 (0은 없음)',0,20,0)}
        ${fields('emptyTrips','빈 FOUP 운반 작업',0,12,0)}
        ${select('repeatStation','재방문 설비',{'':'선택 안 함'})}
        ${fields('repeatCount','재방문 횟수',0,3,0)}
        ${fields('dueTime','로트 납기 (초, 0은 없음)',0,2400,0)}${fields('maxQueue','최대 공정 간 대기 (초, 0은 없음)',0,2400,0)}
        ${fields('targetWph','차량 산정 목표 (장/h, 0은 없음)',0,2000,0)}
        ${fields('liftSeconds','층간 리프터 인계 (초)',3,120,12)}${select('liftRule','층간 인계 순서',{fifo:'요청 순서',nearest:'리프터가 있는 층 우선'})}
        ${fields('liftCount','층간 리프터 대수',1,2,1)}
      </div></details>
      <details class="experiment-extra experiment-wide"><summary>품목별 레시피 순서와 호환 조건</summary>
        <div class="experiment-tools"><label>편집할 품목<select data-exp="recipeProduct"></select></label>
          ${select('qualification','설비 공유 허용 조건',{equipment:'같은 설비군',recipe:'같은 설비군과 가공 동작'})}
          <button type="button" data-exp="recipeReset">품목 기본 순서 복원</button></div>
        <div class="experiment-inspect"><label>공정 순서<select data-exp="recipeSteps" size="5"></select></label>
          <button type="button" data-exp="recipeUp">위로</button><button type="button" data-exp="recipeDown">아래로</button></div>
      </details>
      <details class="experiment-extra"><summary>레시피 최대 대기시간 제어</summary><div class="experiment-fields">
        ${select('queueProduct','대기시간 적용 품목',{'':'사용 안 함'})}
        ${select('queueFrom','제한 시작 공정',{})}${select('queueTo','제한 종료 공정',{})}
        ${fields('queueSeconds','최대 대기시간 (초)',1,1800,30)}
        ${select('queueConsequence','대기 한도 초과 처리',{hold:'격리 보류',rework:'한 번 재작업 후 보류'})}
        ${select('queueControl','대안 대기시간 제어',{0:'관찰만',1:'우선 배차·투입 보류·재처리'})}
      </div></details>
      <details class="experiment-extra"><summary>설비 정비와 고장 실험</summary><div class="experiment-fields">
        ${select('maintenanceStation','정비 대상 장비',{'':'사용 안 함'})}
        ${fields('maintenanceStart','기준 예방정비 시작 (초)',0,2400,200)}${fields('maintenanceLength','예방정비 시간 (초)',0,600,40)}
        ${fields('maintenanceOffset','대안 정비 시각 차이 (초)',-1200,1200,0)}
        ${fields('meanFailure','모형 평균 고장 간격 (초, 0은 없음)',0,2400,0)}${fields('repair','고장 복구 시간 (초)',1,600,25)}
      </div><p>고장 중 가공 시간이 멈춥니다. 동일 난수로 고장을 발생시키며, 예방정비와 고장 정지가 겹칠 때 가용률에는 한 번만 반영됩니다.</p></details>
      <details class="experiment-extra"><summary>배차·버퍼·장비 상세 정책</summary><div class="experiment-fields">
        ${select('routing','대안 경로 선택',{eta:'예약 반영 도착시간',distance:'정적 최단거리'})}
        ${select('predictiveDispatch','예측 배차',{0:'확정 요청 우선',1:'예측했던 요청 우선 배차'})}
        ${fields('forecastError','완료 예측 오차 (±초)',0,120,0)}
        ${fields('directPercent','직송 목표 비율 (%)',0,100,75)}
        ${select('bufferAssignment','근거리 버퍼 배정',{near:'설비 구역 기준',balanced:'거리·점유율 기준'})}
        ${select('parallelTools','공유 장비 수 (공통)',{0:'1대',1:'병렬 2대'})}
        ${select('assignment','대안 장비 배정',{load:'배정 건수 균등화',eta:'이송·내부 가공 완료 예상'})}
        ${select('pooling','챔버 동시 가공 (대안)',{separate:'로트 순차',shared:'호환 로트 2개 공유'})}
        ${select('arms','대안 로봇 암',{1:'단일 암',2:'이중 암 교환'})}
        ${fields('partnerWindow','짝 로트 대기 한도 (초)',0,60,12)}
      </div></details>
      <div class="experiment-submit"><button type="submit" class="experiment-primary">기준·대안 비교</button><button type="button" data-exp="single">대안을 기준과 동일하게 설정</button><span data-exp="status" role="status"></span></div>
    </form>
    <div class="experiment-results" data-exp="results" hidden>
      <section class="experiment-view">
        <div class="experiment-tools"><label>3D 재생<select data-exp="playRun"><option value="1">대안</option><option value="0">기준</option></select></label><button type="button" data-exp="toggle">재생</button><button type="button" data-exp="iso">사시도</button><button type="button" data-exp="top">평면도</button></div>
        <div data-exp="view" class="experiment-viewport"></div><p data-exp="viewError" hidden>이 환경에서 3D를 열 수 없습니다. 시간과 설비를 선택해 기록을 확인할 수 있습니다.</p>
        <div class="experiment-timeline"><label>재생 시간 <input data-exp="time" type="range" min="0" step="0.1" aria-label="실험 재생 시간"></label><output data-exp="clock"></output></div>
        <p class="experiment-legend"><span>■ OHT</span><span>■ 주 품목 FOUP</span><span>■ 교대 품목 FOUP</span><span>■ 우회로·가동 장비</span><span>■ 장애</span><span>■ 보조선·인계 장치</span></p>
        <div class="experiment-inspect"><label>설비에서 관찰<select data-exp="station"></select></label><button type="button" data-exp="workJump">다음 가공으로 이동</button><button type="button" data-exp="cutaway" aria-pressed="false">장비 내부 보기</button></div>
        <p data-exp="chambers" class="experiment-detail"></p><p data-exp="trace" class="experiment-detail"></p>
      </section>
      <section class="experiment-comparison">
        <div class="experiment-tools"><h3>운전 비교</h3><label>그래프 지표<select data-exp="metric">${options(Object.fromEntries(metrics.map(([id,label])=>[id,label])))} </select></label></div>
        <canvas data-exp="plot" role="img"></canvas>
        <p class="experiment-series"><span>● 기준</span> <span>● 대안</span> <span>│ 재생 시점</span></p>
        <div class="experiment-totals"><table><caption>관찰 종료 시점</caption><thead><tr><th scope="col">지표</th><th scope="col">기준</th><th scope="col">대안</th></tr></thead><tbody>${metrics.map(([id,label,unit])=>`<tr><th scope="row">${label} <small>${unit}</small></th><td data-value="0-${id}"></td><td data-value="1-${id}"></td></tr>`).join('')}</tbody></table></div>
        <p data-exp="mix" class="experiment-detail"></p><p data-exp="decision" class="experiment-detail"></p>
      </section>
      <details class="experiment-extra experiment-wide"><summary>품목별 운송과 로트 이력</summary>
        <div class="experiment-tools"><label>운송 유형<select data-exp="trafficKind">${options(trafficNames)}</select></label>
          <label>집계 기준<select data-exp="trafficMode"><option value="actual">실제 배차</option><option value="planned">계획된 설비 경로</option></select></label>
          <label>품목<select data-exp="trafficProduct"><option value="">전체 품목</option>${productOptions}</select></label>
          <label>로트<select data-exp="historyLot"></select></label></div>
        <div class="experiment-totals"><table><caption data-exp="trafficCaption">출발지별 목적지</caption><thead><tr><th scope="col">출발지</th><th scope="col">목적지</th><th scope="col">건수</th><th scope="col">미완료</th><th scope="col">평균 / P95 (초)</th><th scope="col">픽업 P95 (초)</th></tr></thead><tbody data-exp="trafficRows"></tbody></table></div>
        <div class="experiment-totals"><table><caption>로트 이벤트 · 모형 초</caption><thead><tr><th scope="col">시각</th><th scope="col">이벤트</th><th scope="col">설비 또는 노선</th></tr></thead><tbody data-exp="historyRows"></tbody></table></div>
      </details>
      <details class="experiment-extra experiment-wide"><summary>1~6대 차량 비교와 최소 대수</summary>
        <div class="experiment-tools"><label>반복 횟수<select data-exp="repetitions">${options({1:'1회',3:'3회',5:'5회'})}</select></label>
          <button type="button" data-exp="sweep">차량 대수 비교</button></div>
        <p class="experiment-detail" data-exp="sweepStatus" role="status">반복마다 기준과 대안에 동일한 난수 시작값을 사용합니다.</p>
        <div class="experiment-totals"><table><caption>반복 평균 · 기준 / 대안</caption><thead><tr><th scope="col">OHT</th><th scope="col">완료 웨이퍼 (장/h)</th><th scope="col">인계 P95 (초)</th><th scope="col">미완료 (건)</th></tr></thead><tbody data-exp="sweepRows"></tbody></table></div>
      </details>
      <details class="experiment-extra experiment-wide" data-exp="fieldLog"><summary>현장 로그 불러오기와 비교</summary><div data-exp="fieldLogHost"></div></details>
      <p class="experiment-basis">발췌한 공정과 모형 운전 시간으로 비교합니다. 인계형 루프에는 운행 구간별 차량이 필요합니다. 레일 복구는 재개 후 해당 구간의 첫 통과 시각을, 포트·차량·인계 장치 복구는 첫 해당 인계 완료 시각을 씁니다.</p>
    </div>`;
  host.append(dialog);
  const find=<T extends HTMLElement=HTMLElement>(id:string)=>dialog.querySelector<T>(`[data-exp="${id}"]`)!;
  const form=find<HTMLFormElement>('form'),timeInput=find<HTMLInputElement>('time');
  const runSelect=find<HTMLSelectElement>('playRun'),stationSelect=find<HTMLSelectElement>('station');
  const metricSelect=find<HTMLSelectElement>('metric'),plot=find<HTMLCanvasElement>('plot');
  const recipeProduct=find<HTMLSelectElement>('recipeProduct'),recipeSteps=find<HTMLSelectElement>('recipeSteps');
  const recipeOrder:Partial<Record<ProductId,number[]>>={};
  const input=<T extends HTMLInputElement|HTMLSelectElement>(name:string)=>form.elements.namedItem(name) as T;
  const set=(name:string,value:string|boolean|number)=>{input(name).value=typeof value==='boolean'?String(Number(value)):String(value);};
  const setPolicy=(value:ExperimentPolicy)=>Object.entries(value).forEach(([key,value])=>set(key,value));
  Object.entries(defaultInput).forEach(([key,value])=>set(key,value));
  setPolicy(alternative);
  let records:[ExperimentResult,ExperimentResult]|undefined;
  let sweep:AbortController|undefined,comparison:AbortController|undefined;
  let scene:ReturnType<typeof createExperimentScene>|undefined,firstOpen=true;
  let fieldLog:ReturnType<typeof import('./field-log-panel')['createFieldLogPanel']>|undefined;
  let disposed=false;
  let cutaway=false;
  let time=0,playing=false,animation=0,last=0,lastReadout=-Infinity;
  let graph:{name:string;series:(number|null)[][];unit:string}|undefined;

  function readInput():ExperimentInput {
    const queueProduct=input('queueProduct').value as ProductId|'',maintenance=input('maintenanceStation').value;
    return {
      primary:input('primary').value as ProductId,secondary:input('secondary').value as ProductId|'',
      outage:input('outage').value as Outage,outageAt:+input('outageAt').value,outageLength:+input('outageLength').value,
      lots:+input('lots').value,wafers:+input('wafers').value,fleet:+input('fleet').value,
      releaseEvery:+input('releaseEvery').value,horizon:+input('horizon').value,
      mixPercent:+input('mixPercent').value,seed:+input('seed').value,jitter:+input('jitter').value,
      testEvery:+input('testEvery').value,releasePattern:input('releasePattern').value as ExperimentInput['releasePattern'],
      forecastError:+input('forecastError').value,dueTime:+input('dueTime').value,maxQueue:+input('maxQueue').value,
      targetWph:+input('targetWph').value,repeatStation:input('repeatStation').value,repeatCount:+input('repeatCount').value,
      liftSeconds:+input('liftSeconds').value,liftRule:input('liftRule').value as ExperimentInput['liftRule'],liftCount:+input('liftCount').value,
      parallelTools:input('parallelTools').value==='1',
      emptyTrips:+input('emptyTrips').value,qualification:input('qualification').value as ExperimentInput['qualification'],
      recipeOrder:Object.fromEntries(Object.entries(recipeOrder).map(([product,order])=>[product,[...order]])),
      queueRule:queueProduct?{product:queueProduct,fromStep:input('queueFrom').value,toStep:input('queueTo').value,
        seconds:+input('queueSeconds').value,consequence:input('queueConsequence').value==='rework'?'rework':'hold'}:undefined,
      maintenance:maintenance?{station:maintenance,start:+input('maintenanceStart').value,length:+input('maintenanceLength').value,
        meanFailure:+input('meanFailure').value,repair:+input('repair').value}:undefined,
    };
  }
  function readPolicy():ExperimentPolicy {
    const topology=parseRail(input('bypass').value),staging=input('staging').value;
    return {staging:staging==='1',bypass:topology==='bypass',topology,reposition:staging==='1'?'forecast':staging==='demand'?'demand':'home',
      buffer:input('buffer').value as BufferPolicy,dedicated:input('dedicated').value==='1',
      chambers:+input('chambers').value,order:input('order').value as ChamberOrder,
      routing:input('routing').value as ExperimentPolicy['routing'],predictiveDispatch:input('predictiveDispatch').value==='1',
      directPercent:+input('directPercent').value,bufferAssignment:input('bufferAssignment').value as ExperimentPolicy['bufferAssignment'],
      assignment:input('assignment').value as ExperimentPolicy['assignment'],pooling:input('pooling').value as ExperimentPolicy['pooling'],
      arms:input('arms').value==='2'?2:1,partnerWindow:+input('partnerWindow').value,
      queueControl:input('queueControl').value==='1',maintenanceOffset:+input('maintenanceOffset').value};
  }
  function prepareGraph(){
    if(!records)return;
    const [key,name,unit]=metrics.find(([id])=>id===metricSelect.value)!;
    graph={name,unit,series:records.map(record=>Array.from({length:81},(_,i)=>metricsAt(record,record.input.horizon*i/80)[key]))};
  }
  function paintChart(){
    if(!graph||!records)return;
    const ctx=plot.getContext('2d'),{width,height}=plot.getBoundingClientRect();
    if(!ctx||!width||!height)return;
    const resolution=Math.min(devicePixelRatio,2);
    plot.width=Math.round(width*resolution);plot.height=Math.round(height*resolution);
    ctx.scale(resolution,resolution);
    const left=42,right=width-16,top=21,bottom=height-24;
    const values=graph.series.flatMap(series=>series.filter((value):value is number=>value!==null));
    const max=Math.max(1,...values),scale=10**Math.floor(Math.log10(max))/2;
    const limit=Math.ceil(max/scale)*scale;
    const x=(i:number)=>(right-left)*i+left,y=(value:number)=>bottom-(bottom-top)*value/limit;
    const colors=getComputedStyle(plot);
    ctx.font='11px monospace';ctx.fillStyle=colors.getPropertyValue('--muted').trim();
    ctx.strokeStyle=colors.getPropertyValue('--chart-grid').trim();
    for(let i=0;i<=4;i++){
      const value=limit*i/4,py=y(value);
      ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(right,py);ctx.stroke();ctx.fillText(figure(value),3,py+3);
    }
    ctx.fillText(graph.unit,left,12);
    ctx.fillText('0:00',left-8,height-7);
    ctx.fillText(clock(records[0].input.horizon),right-30,height-7);
    graph.series.forEach((series,index)=>{
      ctx.strokeStyle=colors.getPropertyValue(index?'--positive':'--accent').trim();ctx.lineWidth=2;
      ctx.beginPath();let connected=false;
      series.forEach((value,i)=>{
        if(value===null){connected=false;return;}
        const px=x(i/(series.length-1)),py=y(value);
        if(connected)ctx.lineTo(px,py);
        else ctx.moveTo(px,py);
        connected=true;
      });
      ctx.stroke();
    });
    const marker=x(time/records[0].input.horizon);
    ctx.lineWidth=1;ctx.strokeStyle=colors.getPropertyValue('--chart-cursor').trim();ctx.beginPath();ctx.moveTo(marker,top);ctx.lineTo(marker,bottom);ctx.stroke();
    if(!values.length)ctx.fillText('관찰 시간 내 기록 없음',left+12,top+24);
    plot.setAttribute('aria-label',graph.name+' 시계열. 기준 '+figure(graph.series[0].at(-1)??null)+', 대안 '+figure(graph.series[1].at(-1)??null)+' '+graph.unit);
  }
  const selectedRun=()=>records?.[Number(runSelect.value)];
  function showRows(id:string,rows:(string|number)[][]){
    const body=find<HTMLTableSectionElement>(id);
    body.replaceChildren();
    for(const values of rows){
      const row=body.insertRow();
      for(const value of values)row.insertCell().textContent=String(value);
    }
  }
  function showTraffic(){
    const record=selectedRun();
    if(!record)return;
    const kind=find<HTMLSelectElement>('trafficKind').value as TrafficKind;
    const mode=find<HTMLSelectElement>('trafficMode'),product=find<HTMLSelectElement>('trafficProduct');
    if(kind==='empty')mode.value='actual';
    if(kind==='empty'||kind==='carrier')product.value='';
    product.disabled=kind==='empty'||kind==='carrier';
    mode.disabled=kind==='empty';
    const names=new Map(record.stations.map(station=>[station.point.id,station.label]));
    const label=(id:string)=>names.get(id)??(id.startsWith('bay-')?'대기 지선 '+id.slice(4):id);
    const selectedProduct=(product.value||undefined) as ProductId|undefined;
    const rows=mode.value==='planned'&&kind!=='empty'?
      plannedTraffic(record,kind,selectedProduct).map(row=>[label(row.source),label(row.destination),row.count,'—','—','—']):
      analyzeTraffic(record,kind,selectedProduct).map(row=>[label(row.source),label(row.destination),row.count,row.pending,
        `${figure(row.average)} / ${figure(row.p95)}`,figure(row.pickupP95)]);
    find('trafficCaption').textContent=`${runSelect.value==='0'?'기준':'대안'} · ${trafficNames[kind]} · ${rows.length}개 노선`;
    showRows('trafficRows',rows);
  }
  function showHistory(){
    const record=selectedRun();
    if(!record)return;
    const lot=record.lots[+find<HTMLSelectElement>('historyLot').value-1];
    if(!lot)return;
    const labels=new Map(record.stations.map(station=>[station.point.id,station.label]));
    const label=(id:string)=>labels.get(id)??id;
    const rows:[number,string,string][]=[[lot.release,'투입',lot.empty?'빈 FOUP':PRODUCTS[lot.product].name+(lot.test?' · 시험':' · 생산')]];
    for(const request of record.requests.filter(request=>request.lot===lot.id))rows.push([request.time,'운송 요청',label(request.source)]);
    for(const trip of record.transfers.filter(trip=>trip.lot===lot.id)){
      rows.push([trip.dispatch,'OHT-'+trip.vehicle+' 배차',`${label(trip.source)} → ${label(trip.destination)}`],
        [trip.pickup,'픽업 완료',label(trip.source)],[trip.delivery,'내려놓기 완료',label(trip.destination)]);
      if(trip.planned!==trip.destination)rows.push([trip.dispatch,'계획 목적지',label(trip.planned)]);
    }
    for(const run of record.work.filter(run=>run.lot===lot.id))rows.push([run.start,'가공 시작',label(run.station)],
      [run.end,'공정 완료·로봇 회수',label(run.station)]);
    for(const window of record.queueWindows.filter(window=>window.lot===lot.id)){
      rows.push([window.entered,'레시피 대기시간 제한 시작','기한 '+figure(window.deadline)+'초']);
      if(window.resolved!==undefined)rows.push([window.resolved,window.consequence==='rework'?'재작업 배정':'품질 보류','레시피 최대 대기시간']);
    }
    for(const move of record.relays.filter(move=>move.lot===lot.id))rows.push([move.start,'루프 간 인계 시작',label(move.from.id)],
      [move.end,'루프 간 인계 완료',label(move.to.id)]);
    if(lot.completed!==undefined)rows.push([lot.completed,'로트 완료',label('home')]);
    showRows('historyRows',rows.filter(row=>row[0]<=record.input.horizon).sort((a,b)=>a[0]-b[0]).map(([at,event,place])=>[figure(at),event,place]));
  }
  function draw(heavy=true){
    const record=selectedRun();
    if(!record)return;
    if(!cutaway)scene?.update(time,stationSelect.value);
    if(!cutaway&&!heavy)return;
    const down=record.downtime.find(item=>item.station===stationSelect.value&&item.start<=time&&time<item.end);
    const work=down?[]:record.work.filter(run=>run.station===stationSelect.value&&run.start<=time&&time<run.end);
    const active=work.flatMap(run=>run.activities.filter(task=>task.start<=time&&time<task.end).map(task=>({...task,lot:run.lot})));
    if(cutaway)scene?.updateChambers(active,time);
    if(!heavy)return;
    timeInput.value=String(time);
    find('clock').textContent=clock(time)+' / '+clock(record.input.horizon);
    const station=record.stations.find(item=>item.point.id===stationSelect.value);
    const stored=(station?.type!=='tool')?record.lots.filter(lot=>{
      const place=lot.locations.filter(item=>item.time<=time).at(-1);
      return place?.point.id===stationSelect.value&&place?.slot!==null;
    }).length:0;
    find('chambers').textContent=down?`${down.kind==='planned'?'예방정비':'고장 복구'} · ${clock(down.start)}–${clock(down.end)}`:work.length?`${work.map(run=>'FOUP-'+run.lot).join(' · ')} · ${active[0]?.step??'로봇 인계 대기'} · ${active.map(task=>
      `챔버 ${task.chamber} / 웨이퍼 ${task.wafer} ${task.kind==='process'?'가공':task.kind==='load'?'투입':'회수'}`).join(' · ')}`:
      station?.type==='tool'?'선택 장비에서 진행 중인 가공이 없습니다.':`보관 FOUP ${stored} / ${station?.capacity??0}`;
    const labels=new Map(record.stations.map(item=>[item.point.id,item.label]));
    const latest=record.transfers.filter(trip=>trip.dispatch<=time).sort((a,b)=>b.dispatch-a.dispatch)[0];
    find('trace').textContent=latest?`최근 배차 OHT-${latest.vehicle} · FOUP-${latest.lot} · ${labels.get(latest.source)} → ${labels.get(latest.destination)} · ${time>=latest.delivery?'인계 완료':time>=latest.pickup?'적재 이동':'픽업 이동'}`:'배차를 기다리고 있습니다.';
    paintChart();
  }
  function setPlaying(value:boolean){
    playing=value;last=performance.now();
    find('toggle').textContent=value?'정지':'재생';
    cancelAnimationFrame(animation);
    if(value)animation=requestAnimationFrame(tick);
  }
  function tick(now:number){
    const record=selectedRun();
    if(!record||!playing)return;
    time=Math.min(record.input.horizon,time+(now-last)*.012);
    last=now;
    const done=time>=record.input.horizon;
    draw(done||now-lastReadout>125);
    if(now-lastReadout>125)lastReadout=now;
    if(done)setPlaying(false);
    else animation=requestAnimationFrame(tick);
  }
  function showRun(){
    const record=selectedRun();
    if(!record)return;
    const previous=stationSelect.value;
    stationSelect.replaceChildren(...record.stations.map(station=>new Option(station.label,station.point.id)));
    stationSelect.value=record.stations.some(station=>station.point.id===previous)?previous:
      record.stations.find(station=>station.type==='tool')!.point.id;
    scene?.load(record);
    updateCutaway();
    const history=find<HTMLSelectElement>('historyLot'),previousLot=history.value;
    history.replaceChildren(...record.lots.map(lot=>new Option(`FOUP-${lot.id} · ${lot.empty?'빈 용기':PRODUCTS[lot.product].name}${lot.test?' · 시험':''}`,String(lot.id))));
    if(record.lots.some(lot=>String(lot.id)===previousLot))history.value=previousLot;
    showTraffic();showHistory();
    draw();
    fieldLog?.refresh();
  }
  function updateCutaway(refresh=true){
    const record=selectedRun(),button=find<HTMLButtonElement>('cutaway');
    button.disabled=!scene||record?.stations.find(station=>station.point.id===stationSelect.value)?.type!=='tool';
    const wasCutaway=cutaway;
    if(button.disabled)cutaway=false;
    button.setAttribute('aria-pressed',String(cutaway));
    button.textContent=cutaway?'생산층 보기':'장비 내부 보기';
    if(refresh||wasCutaway!==cutaway)scene?.showLevel(cutaway?'chambers':'process',record?.policy.chambers,record?.policy.arms);
  }
  async function compare(){
    const common=readInput();
    if(common.queueRule&&(!common.queueRule.fromStep||!common.queueRule.toStep)){
      find('status').textContent='대기시간 제한을 적용할 서로 다른 두 설비를 선택하세요.';return;
    }
    if(common.outage!=='none'&&common.outageAt>=common.horizon){
      find('status').textContent='장애 시작을 관찰 시간보다 앞서 설정하세요.';
      return;
    }
    if(common.secondary===common.primary){set('secondary','');common.secondary='';}
    setPlaying(false);
    sweep?.abort();
    showRows('sweepRows',[]);
    const base={...baselinePolicy,topology:parseRail(input('baselineRail').value)};
    comparison?.abort();
    const running=new AbortController();comparison=running;
    form.setAttribute('aria-busy','true');
    find('status').textContent='기준과 대안을 계산하는 중입니다.';
    try{
      const reply=await workerJob({type:'compare',input:common,policies:[base,readPolicy()]},running.signal);
      if(reply.type!=='compare')throw new Error(reply.type==='error'?reply.message:'잘못된 계산 결과');
      if(running.signal.aborted)return;
      records=reply.result;
    }catch(error){
      if(!running.signal.aborted){find('status').textContent='비교 계산을 완료하지 못했습니다.';console.error(error);}
      return;
    }finally{
      if(comparison===running){comparison=undefined;form.setAttribute('aria-busy','false');}
    }
    find('results').hidden=false;
    time=0;timeInput.max=String(common.horizon);
    records.forEach((record,index)=>metrics.forEach(([key])=>{
      dialog.querySelector<HTMLElement>(`[data-value="${index}-${key}"]`)!.textContent=figure(record.metrics[key]);
    }));
    const [before,after]=records.map(record=>record.metrics);
    const conditions=[before.handoffP95!==null&&after.handoffP95!==null?after.handoffP95<before.handoffP95:null,
      after.wph>=before.wph,after.conflicts===0,common.maxQueue?after.waitViolations===0:null];
    const labels=['인계 P95 감소','완료량 유지','점유 충돌 없음','공정 간 대기 한도 준수'];
    find('decision').textContent='대안 판정 · '+labels.map((label,index)=>`${label} ${conditions[index]===null?'미평가':conditions[index]?'충족':'미충족'}`).join(' · ');
    const products=[...new Set(records[0].lots.filter(lot=>!lot.empty).map(lot=>lot.product))];
    find('mix').textContent='품목별 생산 완료·납기 (기준 / 대안) · '+products.map(product=>PRODUCTS[product].name+' '+
      records!.map(record=>{
        const lots=record.lots.filter(lot=>lot.product===product&&!lot.test&&!lot.empty);
        const completed=lots.filter(lot=>!lot.held&&(lot.completed??Infinity)<=common.horizon);
        if(!common.dueTime)return String(completed.length);
        const due=lots.filter(lot=>lot.release+common.dueTime!<=common.horizon||(lot.completed??Infinity)<=common.horizon).length;
        const onTime=completed.filter(lot=>lot.completed!-lot.release<=common.dueTime!).length;
        return `${completed.length}개 (${due?figure(100*onTime/due)+'%':'—'})`;
      }).join(' / ')).join(' · ');
    const port=records[0].stations.find(station=>station.point.id===records![0].outagePort)?.label;
    find('status').textContent=common.outage==='none'?'비교 계산 완료':`${clock(common.outageAt)}–${clock(common.outageAt+common.outageLength)} · ${common.outage==='port'?port+' 로드포트':outageNames[common.outage]}`;
    if(!scene){
      try{scene=createExperimentScene(find('view'));}
      catch{find('viewError').hidden=false;find('view').hidden=true;}
    }
    prepareGraph();
    showRun();
  }
  form.addEventListener('submit',event=>{event.preventDefault();compare();});
  form.addEventListener('change',()=>{
    comparison?.abort();
    find('status').textContent='설정을 반영하려면 기준·대안 비교를 실행하세요.';
    for(const name of ['outageAt','outageLength'])input(name).disabled=input('outage').value==='none';
  });
  function showRecipe(selected=0){
    const product=recipeProduct.value as ProductId;
    const steps=PRODUCTS[product].steps;
    const order=recipeOrder[product]??steps.map((_,index)=>index);
    recipeSteps.replaceChildren(...order.map((index,position)=>new Option(`${position+1}. ${steps[index].label}`,String(index))));
    recipeSteps.selectedIndex=selected;
    find<HTMLButtonElement>('recipeUp').disabled=selected<=0;
    find<HTMLButtonElement>('recipeDown').disabled=selected>=steps.length-1;
  }
  function updateQueueSteps(){
    const product=input('queueProduct').value as ProductId|'';
    const from=input<HTMLSelectElement>('queueFrom'),to=input<HTMLSelectElement>('queueTo');
    const before=from.value,after=to.value;
    const steps=product?recipeFor(product,{...defaultInput,recipeOrder}).filter((step,index,sequence)=>
      index===0||recipeStation(step)!==recipeStation(sequence[index-1])):[];
    from.replaceChildren(...steps.slice(0,-1).map(step=>new Option(step.label,step.id)));
    if(steps.slice(0,-1).some(step=>step.id===before))from.value=before;
    const successors=steps.slice(from.selectedIndex+1);
    to.replaceChildren(...successors.map(step=>new Option(step.label,step.id)));
    if(successors.some(step=>step.id===after))to.value=after;
    from.disabled=!product;to.disabled=!product;
  }
  function updateRecipeProducts(){
    const previous=recipeProduct.value,products=[...new Set([input('primary').value,input('secondary').value].filter(Boolean))] as ProductId[];
    recipeProduct.replaceChildren(...products.map(product=>new Option(PRODUCTS[product].name,product)));
    if(products.some(product=>product===previous))recipeProduct.value=previous;
    const repeat=input<HTMLSelectElement>('repeatStation'),follow=repeat.value;
    const stationIds=[...new Set(products.flatMap(product=>PRODUCTS[product].steps.map(recipeStation)))];
    repeat.replaceChildren(new Option('선택 안 함',''),...stationIds.map(id=>new Option(equipment[kindFor(id)].name,id)));
    if(stationIds.includes(follow))repeat.value=follow;
    const queue=input<HTMLSelectElement>('queueProduct'),previousQueue=queue.value;
    queue.replaceChildren(new Option('사용 안 함',''),...products.map(product=>new Option(PRODUCTS[product].name,product)));
    if(products.some(product=>product===previousQueue))queue.value=previousQueue;
    const maintenance=input<HTMLSelectElement>('maintenanceStation'),previousTool=maintenance.value;
    maintenance.replaceChildren(new Option('사용 안 함',''),...stationIds.map(id=>new Option(equipment[kindFor(id)].name,id)));
    if(stationIds.includes(previousTool))maintenance.value=previousTool;
    updateQueueSteps();
    showRecipe();
  }
  for(const name of ['primary','secondary'])input(name).addEventListener('change',updateRecipeProducts);
  recipeProduct.addEventListener('change',()=>showRecipe());
  input('queueProduct').addEventListener('change',updateQueueSteps);
  input('queueFrom').addEventListener('change',updateQueueSteps);
  recipeSteps.addEventListener('change',()=>showRecipe(recipeSteps.selectedIndex));
  for(const [id,direction] of [['recipeUp',-1],['recipeDown',1]] as const)find(id).addEventListener('click',()=>{
    const from=recipeSteps.selectedIndex,to=from+direction;
    const order=Array.from(recipeSteps.options,option=>Number(option.value));
    if(from<0||to<0||to>=order.length)return;
    [order[from],order[to]]=[order[to],order[from]];
    recipeOrder[recipeProduct.value as ProductId]=order;
    showRecipe(to);updateQueueSteps();form.dispatchEvent(new Event('change'));
  });
  find('recipeReset').addEventListener('click',()=>{
    delete recipeOrder[recipeProduct.value as ProductId];
    showRecipe();updateQueueSteps();form.dispatchEvent(new Event('change'));
  });
  updateRecipeProducts();
  form.dispatchEvent(new Event('change'));
  find('single').addEventListener('click',()=>{
    setPolicy(baselinePolicy);set('bypass',input('baselineRail').value);
    for(const [key,value] of Object.entries({routing:'eta',predictiveDispatch:'0',bufferAssignment:'near',assignment:'load',pooling:'separate',arms:1,
      queueControl:'0',maintenanceOffset:0}))set(key,value);
    form.dispatchEvent(new Event('change'));
  });
  for(const id of ['trafficKind','trafficMode','trafficProduct'])find(id).addEventListener('change',showTraffic);
  find('historyLot').addEventListener('change',showHistory);
  find<HTMLDetailsElement>('fieldLog').addEventListener('toggle',async()=>{
    if(!find<HTMLDetailsElement>('fieldLog').open){fieldLog?.pause();return;}
    if(fieldLog)return;
    try{
      const {createFieldLogPanel}=await import('./field-log-panel');
      if(disposed||fieldLog)return;
      fieldLog=createFieldLogPanel(find('fieldLogHost'),selectedRun,(seconds,station)=>{
        const record=selectedRun();if(!record)return;
        setPlaying(false);stationSelect.value=station;time=Math.min(seconds,record.input.horizon);updateCutaway(cutaway);draw();
      });
    }catch(error){console.error(error);find('fieldLogHost').textContent='현장 로그 화면을 열지 못했습니다.';}
  });
  const sweepButton=find<HTMLButtonElement>('sweep');
  sweepButton.addEventListener('click',async()=>{
    if(!records||sweep)return;
    const current=records;
    sweep=new AbortController();sweepButton.disabled=true;
    find('sweepStatus').textContent='선택한 비교 조건으로 차량 대수를 계산하는 중입니다.';
    try{
      const reply=await workerJob({type:'fleet',input:current[0].input,policies:[current[0].policy,current[1].policy],
        repetitions:+find<HTMLSelectElement>('repetitions').value},sweep.signal);
      if(reply.type!=='fleet')throw new Error(reply.type==='error'?reply.message:'잘못된 대수 계산 결과');
      const summary=reply.result;
      const pair=(values:(number|null)[])=>values.map(figure).join(' / ');
      showRows('sweepRows',summary.rows.map(row=>[row.fleet,pair(row.results.map(result=>result.wph)),
        pair(row.results.map(result=>result.handoff)),pair(row.results.map(result=>result.incomplete))]));
      find('sweepStatus').textContent=`인계 P95가 가장 짧은 대수 ${pair(summary.fastest)}대 (기준 / 대안)`+
        (current[0].input.targetWph?` · 목표를 모든 반복에서 충족한 최소 대수 ${pair(summary.minimum)}대`:'');
    }catch{
      find('sweepStatus').textContent=sweep.signal.aborted?'새 비교 조건으로 차량 대수를 계산할 수 있습니다.':'계산을 완료하지 못했습니다.';
    }finally{sweep=undefined;sweepButton.disabled=false;}
  });
  find('close').addEventListener('click',()=>dialog.close());
  find('toggle').addEventListener('click',()=>{
    if(!playing&&time>=(records?.[0].input.horizon??0))time=0;
    setPlaying(!playing);
  });
  find('iso').addEventListener('click',()=>scene?.view());
  find('top').addEventListener('click',()=>scene?.view(true));
  find('workJump').addEventListener('click',()=>{
    const record=selectedRun();
    if(!record)return;
    const work=record.work.find(run=>run.station===stationSelect.value&&run.start>time)??record.work.find(run=>run.station===stationSelect.value);
    if(work){setPlaying(false);time=work.start;draw();}
  });
  runSelect.addEventListener('change',showRun);
  stationSelect.addEventListener('change',()=>{updateCutaway(cutaway);draw();});
  find('cutaway').addEventListener('click',()=>{cutaway=!cutaway;updateCutaway();draw();});
  timeInput.addEventListener('input',()=>{setPlaying(false);time=Number(timeInput.value);draw();});
  metricSelect.addEventListener('change',()=>{prepareGraph();paintChart();});
  dialog.addEventListener('close',()=>{
    fieldLog?.pause();
    comparison?.abort();
    sweep?.abort();
    setPlaying(false);
    scene?.dispose();scene=undefined;
  });
  const observer=new ResizeObserver(paintChart);
  observer.observe(plot);
  function open(){
    if(dialog.open)return;
    dialog.showModal();
    if(firstOpen){set('fleet',fleet()||defaultInput.fleet);firstOpen=false;}
    if(!records)compare();
    else {
      try{scene=createExperimentScene(find('view'));}
      catch{find('viewError').hidden=false;find('view').hidden=true;}
      showRun();
    }
  }
  return {open,isOpen:()=>dialog.open,dispose(){disposed=true;fieldLog?.dispose();comparison?.abort();sweep?.abort();setPlaying(false);observer.disconnect();scene?.dispose();dialog.remove();}};
}
