import {measureMetrics,metricGroups,metrics,recordedMetrics,validateMeasurement,
  type Measurement,type MetricGroup,type MetricId,type MetricTimeline,type RecordGroup,type Targets} from './fab-metrics';

const integer = new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0});
const decimal = new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1});
const cards = Object.keys(metrics) as MetricId[];
const keyFigures:MetricId[]=['wph','wip','pickupP95','blocked'];
const countUnits=new Set(['장','건','개']);
const format=(id:MetricId,value:number|null)=>value===null?'—':(countUnits.has(metrics[id].unit)?integer:decimal).format(value);
function timeLabel(seconds:number){
  const time=Math.max(0,Math.floor(seconds));
  const parts=[Math.floor(time/3600),Math.floor(time/60)%60,time%60];
  return parts.map(value=>String(value).padStart(2,'0')).join(':');
}

type Reading={time:number;value:number|null};
type Run={product:string;timeline:MetricTimeline;stations:{id:string;name:string}[]};
type SavedRun=Run&{targets:Targets;records:Measurement[]};
export function createMetricsPanel(host:HTMLElement,read:()=>Run){
  const dialog=document.createElement('dialog');
  dialog.className='fab-metrics';dialog.setAttribute('aria-labelledby','metrics-title');
  dialog.innerHTML=`<header class="metrics-header"><div><h2 id="metrics-title">생산 지표</h2><p data-metrics="context"></p></div><div class="metrics-controls"><label>운전 기록 <select data-metrics="run" aria-label="운전 기록"><option value="current">현재 운전</option></select></label><button type="button" data-metrics="close">닫기</button></div></header>
    <div class="metrics-summary" aria-label="주요 지표">${keyFigures.map(id=>`<button type="button" data-indicator="${id}"><span>${metrics[id].name}</span><div><strong data-summary="${id}">—</strong><small>${metrics[id].unit}</small></div></button>`).join('')}</div>
    <div class="metrics-tabs" role="group" aria-label="지표 그룹">${Object.entries(metricGroups).map(([key,label])=>`<button type="button" data-group="${key}">${label}</button>`).join('')}</div>
    <div class="metrics-workspace">
      <section class="metrics-trend" aria-label="선택 지표 그래프">
        <div class="metrics-chart-title"><div><h3 data-metrics="name"></h3><p data-metrics="description"></p></div><div class="metrics-chart-controls"><label>구간 <select data-metrics="range" aria-label="그래프 구간"><option value="all">전체 운전</option><option value="hour">최근 1시간</option></select></label><label data-metrics="scope" hidden>설비 범위 <select data-metrics="station" aria-label="설비 범위"></select></label></div></div>
        <div class="metrics-plot"><canvas role="img" data-metrics="chart"></canvas><p data-metrics="empty" hidden>그래프에 표시할 기록이 없습니다.</p></div>
        <div class="metrics-scrub"><label>그래프 시점 <input type="range" min="0" max="0" value="0" data-metrics="cursor" aria-label="그래프 시점"></label><output data-metrics="reading"></output></div>
      </section>
      <section class="metrics-selection" aria-label="지표 선택"><div data-metrics="cards" class="metric-cards"></div></section>
    </div>
    <p class="metrics-basis">시뮬레이션 시간 기준 · FOUP당 추적 웨이퍼 1장</p>
    <details class="metrics-inputs" data-metrics="settings">
      <summary>생산 목표와 납기 기준 입력</summary>
      <div class="metrics-fields"><label>시간당 생산 목표 (장/h)<input data-metrics="target" type="number" min="0.01" step="any" placeholder="미설정"></label>
      <label>투입부터 완료까지 목표 (분)<input data-metrics="due" type="number" min="0.01" step="any" placeholder="미설정"></label></div>
      <p>입력한 목표는 현재 시뮬레이션의 누적 완료 기록에 적용됩니다.</p>
    </details>
    <details class="metrics-inputs" data-metrics="external" hidden>
      <summary data-metrics="record-title"></summary>
      <p>별도로 측정한 구간의 증가분을 입력하세요. 같은 구간을 두 번 입력하면 중복 집계됩니다.</p>
      <form data-metrics="form"><div class="metrics-fields" data-metrics="fields"></div><button type="submit">현재 시점에 기록</button><button type="button" data-metrics="undo">최근 기록 취소</button></form>
      <p data-metrics="feedback" role="status"></p>
    </details>`;
  host.append(dialog);
  const find=<T extends HTMLElement=HTMLElement>(id:string)=>dialog.querySelector<T>(`[data-metrics="${id}"]`)!;
  const canvas=find<HTMLCanvasElement>('chart'),ctx=canvas.getContext('2d');
  const cursor=find<HTMLInputElement>('cursor'),range=find<HTMLSelectElement>('range'),run=find<HTMLSelectElement>('run'),station=find<HTMLSelectElement>('station');
  const targets:Targets={wph:null,dueSeconds:null};
  const records:Measurement[]=[];
  const saved=new Map<string,SavedRun>();
  let group:MetricGroup='production',selection:MetricId='wph',readings:Reading[]=[];
  let cardValues=new Map<MetricId,HTMLElement>(),pickTime:number|null=null,lastRefresh=-Infinity,lastDataTime=-1;
  let xRange:[number,number]=[58,100];

  function renderChart(){
    const {width,height}=canvas.getBoundingClientRect();
    if(!ctx||!width||!height)return;
    const scale=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
    ctx.scale(scale,scale);
    const left=58,right=width-20,top=17,bottom=height-31;
    xRange=[left,right];
    const known=readings.filter((p):p is {time:number;value:number}=>p.value!==null);
    const cap=Math.max(1,...known.map(p=>p.value));
    const magnitude=10**Math.floor(Math.log10(cap));
    const highest=Math.ceil(cap/magnitude*2)*magnitude/2;
    const first=readings[0]?.time??0,last=readings.at(-1)?.time??first;
    const x=(t:number)=>left+(right-left)*(last===first?0:(t-first)/(last-first));
    const y=(value:number)=>bottom-(bottom-top)*value/highest;
    const colors=getComputedStyle(canvas);
    const axis=colors.getPropertyValue('--muted').trim();
    const grid=colors.getPropertyValue('--chart-grid').trim();
    const series=colors.getPropertyValue('--accent').trim();
    ctx.font='11px Consolas, monospace';ctx.textAlign='right';ctx.textBaseline='middle';
    ctx.fillStyle=axis;
    for(let i=0;i<=4;i++){
      const value=i*highest/4,at=y(value);
      ctx.beginPath();ctx.strokeStyle=grid;ctx.lineWidth=1;ctx.moveTo(left,at);ctx.lineTo(right,at);ctx.stroke();
      ctx.fillText(decimal.format(value),left-8,at);
    }
    ctx.textAlign='left';ctx.fillText(timeLabel(first),left,bottom+17);
    if(last>first){ctx.textAlign='right';ctx.fillText(timeLabel(last),right,bottom+17);}
    if(known.length){
      ctx.strokeStyle=series;ctx.fillStyle=series;ctx.lineWidth=2;ctx.beginPath();
      for(const [index,point] of known.entries()){
        if(index===0)ctx.moveTo(x(point.time),y(point.value));
        else if(countUnits.has(metrics[selection].unit)||Object.hasOwn(recordedMetrics,group)){
          ctx.lineTo(x(point.time),y(known[index-1].value));ctx.lineTo(x(point.time),y(point.value));
        }else ctx.lineTo(x(point.time),y(point.value));
      }
      ctx.stroke();
      const marker=readings[Number(cursor.value)];
      if(marker?.value!=null){
        ctx.beginPath();ctx.lineWidth=1;ctx.strokeStyle=colors.getPropertyValue('--chart-cursor').trim();
        ctx.moveTo(x(marker.time),top);ctx.lineTo(x(marker.time),bottom);ctx.stroke();
        ctx.beginPath();ctx.arc(x(marker.time),y(marker.value),4,0,Math.PI*2);ctx.fill();
      }else if(known.length===1){
        ctx.beginPath();ctx.arc(x(known[0].time),y(known[0].value),4,0,Math.PI*2);ctx.fill();
      }
    }
    find('empty').hidden=known.length>0;
  }

  function setReading(){
    const last=readings.length-1;
    let i=last;
    if(pickTime!==null)i=readings.reduce((best,point,index)=>Math.abs(point.time-pickTime!)<Math.abs(readings[best].time-pickTime!)?index:best,0);
    cursor.max=String(Math.max(0,last));cursor.value=String(Math.max(0,i));cursor.disabled=last<1;
    const p=readings[i],metric=metrics[selection];
    find('reading').textContent=p?timeLabel(p.time)+' · '+(p.value===null?'집계 대기':format(selection,p.value)+' '+metric.unit):'';
    cursor.setAttribute('aria-valuetext',find('reading').textContent??'');
    canvas.setAttribute('aria-label',metric.name+' 시간 추세 · '+find('reading').textContent);
    renderChart();
  }

  function refresh(force=false){
    if(!dialog.open)return;
    const now=performance.now();
    if(!force&&now-lastRefresh<850)return;
    const archived=saved.get(run.value);
    const {product,timeline}=archived??read();
    if(!force&&lastDataTime===timeline.elapsed)return;
    lastRefresh=now;lastDataTime=timeline.elapsed;
    const input=archived?.targets??targets,entries=archived?.records??records;
    const scope=group==='equipment'?station.value:'';
    const value=measureMetrics(timeline,timeline.elapsed,input,entries,scope);
    const overview=scope?measureMetrics(timeline,timeline.elapsed,input,entries):value;
    for(const [id,el] of cardValues)el.textContent=format(id,value[id]);
    for(const id of keyFigures){
      const el=dialog.querySelector<HTMLElement>(`[data-summary="${id}"]`)!;
      const summary=overview[id];
      el.textContent=format(id,summary);
      el.dataset.value=summary?.toString()??'';
    }
    find('context').textContent=product+' · '+timeLabel(timeline.elapsed);
    const min=range.value==='hour'?Math.max(0,timeline.elapsed-3600):0;
    const count=Math.min(56,Math.max(1,Math.ceil((timeline.elapsed-min)/3)));
    const times=new Set<number>();
    for(let i=0;i<=count;i++)times.add(min+(timeline.elapsed-min)*i/count);
    for(const r of entries)if(r.group===group&&r.time>=min&&r.time<=timeline.elapsed)times.add(r.time);
    readings=[...times].sort((a,b)=>a-b).map(time=>({time,value:time===timeline.elapsed?value[selection]:measureMetrics(timeline,time,input,entries,scope)[selection]}));
    const groupTotal=records.filter(record=>record.group===group&&record.time<=timeline.elapsed).length;
    find<HTMLButtonElement>('undo').disabled=groupTotal===0;
    find('feedback').textContent=groupTotal?`현재 시점까지 ${groupTotal}건 입력`:'입력된 기록이 없습니다.';
    setReading();
  }

  function configureGroup(groupChanged:boolean){
    if(groupChanged){
      const list=cards.filter(id=>metrics[id].group===group);
      find('cards').innerHTML=list.map(id=>`<button type="button" data-indicator="${id}"><span>${metrics[id].name}</span><span><strong data-value="${id}">—</strong><small>${metrics[id].unit}</small></span></button>`).join('');
      cardValues=new Map(list.map(id=>[id,find('cards').querySelector<HTMLElement>(`[data-value="${id}"]`)!]));
      const external=Object.hasOwn(recordedMetrics,group);
      if(external){
        find('record-title').textContent=metricGroups[group]+' 측정값 입력';
        find('fields').innerHTML=Object.entries(recordedMetrics[group as RecordGroup]).map(([field,info])=>
          `<label>${info.label} (${info.unit})<input name="${field}" type="number" min="0" step="${info.whole?1:'any'}" required></label>`).join('');
      }
    }
    find('settings').hidden=group!=='production'||run.value!=='current';
    find('external').hidden=!Object.hasOwn(recordedMetrics,group)||run.value!=='current';
    find('scope').hidden=group!=='equipment';
    if(group==='equipment'){
      const selected=station.value,{stations}=saved.get(run.value)??read();
      station.replaceChildren(new Option('라인 전체',''),...stations.map(tool=>new Option(tool.name,tool.id)));
      station.value=stations.some(tool=>tool.id===selected)?selected:'';
    }
    for(const el of dialog.querySelectorAll<HTMLElement>('[data-group]'))el.setAttribute('aria-pressed',String(el.dataset.group===group));
    for(const el of dialog.querySelectorAll<HTMLElement>('[data-indicator]'))el.setAttribute('aria-pressed',String(el.dataset.indicator===selection));
    find('name').textContent=metrics[selection].name+' ('+metrics[selection].unit+')';
    find('description').textContent=metrics[selection].help;
    refresh(true);
  }

  dialog.addEventListener('click',event=>{
    const button=(event.target as Element).closest<HTMLButtonElement>('button');
    if(!button)return;
    if(button.dataset.metrics==='close'){dialog.close();return;}
    const chosen=button.dataset.indicator as MetricId|undefined;
    const next=chosen?metrics[chosen].group:button.dataset.group as MetricGroup|undefined;
    if(next){
      const changed=group!==next;
      group=next;selection=chosen??(changed?cards.find(id=>metrics[id].group===group)!:selection);
      pickTime=null;configureGroup(changed);return;
    }
    if(button.dataset.metrics==='undo'){
      const time=read().timeline.elapsed;
      const index=records.reduce((last,record,index)=>record.group===group&&record.time<=time?index:last,-1);
      if(index>=0){records.splice(index,1);refresh(true);}
    }
  });
  find<HTMLFormElement>('form').addEventListener('submit',event=>{
    event.preventDefault();
    const form=event.currentTarget as HTMLFormElement,recordGroup=group as RecordGroup;
    const values=Object.fromEntries(Array.from(new FormData(form),([key,value])=>[key,value===''?NaN:Number(value)]));
    const error=validateMeasurement(recordGroup,values);
    if(error){find('feedback').textContent=error;return;}
    records.push({time:read().timeline.elapsed,group:recordGroup,values});
    form.reset();pickTime=null;refresh(true);
  });
  function bindTarget(id:string,key:keyof Targets,scale=1){
    const input=find<HTMLInputElement>(id);
    input.addEventListener('change',()=>{
      const value=input.valueAsNumber*scale;
      targets[key]=Number.isFinite(value)&&value>0?value:null;
      if(targets[key]===null)input.value='';
      refresh(true);
    });
  }
  bindTarget('target','wph');bindTarget('due','dueSeconds',60);
  range.onchange=()=>{pickTime=null;refresh(true);};
  run.onchange=()=>{pickTime=null;configureGroup(false);};
  station.onchange=()=>{pickTime=null;refresh(true);};
  cursor.oninput=()=>{pickTime=readings[Number(cursor.value)]?.time??null;setReading();};
  canvas.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch'||!readings.length)return;
    const [left,right]=xRange;
    const f=Math.max(0,Math.min(1,(event.offsetX-left)/(right-left)));
    const first=readings[0].time,last=readings.at(-1)!.time;
    pickTime=first+f*(last-first);setReading();
  });
  canvas.addEventListener('pointerleave',()=>{pickTime=null;setReading();});
  const observer=new ResizeObserver(renderChart);observer.observe(canvas);
  configureGroup(true);
  return {
    open(){dialog.showModal();pickTime=null;refresh(true);},
    refresh,
    archive(){
      const view=read();
      if(view.timeline.elapsed<=0)return;
      saved.set(view.product,{...view,targets:{...targets},records:[...records]});
      run.replaceChildren(new Option('현재 운전','current'),...Array.from(saved.keys(),product=>new Option(product+' · 전환 전',product)));
    },
    reset(){records.length=0;lastDataTime=-1;pickTime=null;run.value='current';find<HTMLFormElement>('form').reset();configureGroup(false);},
    dispose(){observer.disconnect();dialog.remove();},
  };
}
