import {defaultRailEdit,sectionName,type CampusRailEdit,type FabSections} from './campus-fab-layout';
import {metricsAt,type ExperimentResult} from './fab-experiment';
import {mergeSpans} from './fab-constraints';
import type {RailPoint} from './experiment-rail';

export function railUsage(run:ExperimentResult,time=run.input.horizon){
  const spans=new Map<string,{start:number;end:number}[]>();
  for(const booking of run.bookings){
    if(!booking.resource.startsWith('rail:'))continue;
    const list=spans.get(booking.resource)??[];list.push(booking);spans.set(booking.resource,list);
  }
  const usage=new Map<string,number>();
  for(const edge of run.edges){
    if(usage.has(edge.block))continue;
    const seconds=mergeSpans(spans.get(edge.block)??[]).reduce((sum,span)=>sum+Math.max(0,Math.min(span.end,time)-Math.max(0,span.start)),0);
    usage.set(edge.block,time>0?seconds/time:0);
  }
  return usage;
}

const number=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1});
const figure=(value:number|null)=>value===null?'—':number.format(value);
const railLabel=(block:string)=>block.replace(/^rail:/,'').replaceAll('spine-cross','분기').replaceAll('line-','구역 ');

export function createCampusRailPanel(host:HTMLElement,apply:(edit?:CampusRailEdit)=>void){
  const dialog=document.createElement('dialog');
  dialog.className='fab-experiment campus-rail-dialog';dialog.setAttribute('aria-labelledby','campus-rail-title');
  dialog.innerHTML=`<header class="experiment-header"><div><h2 id="campus-rail-title">팹 레일 편집과 병목 지도</h2><p data-rail="site"></p></div>
    <button type="button" data-rail="close">닫기</button></header>
    <form class="experiment-config" data-rail="form">
      <fieldset><legend>본선 연결 분기</legend><div class="experiment-fields">
        <label>서쪽 위치 (m)<input name="west" type="number" required min="-23" max="-5" step=".5"></label>
        <label>동쪽 위치 (m)<input name="east" type="number" required min="5" max="23" step=".5"></label>
        <label>서쪽 연결<input name="westOpen" type="checkbox"></label><label>동쪽 연결<input name="eastOpen" type="checkbox"></label>
      </div></fieldset>
      <fieldset><legend>구역 스토커</legend><div class="experiment-fields">
        <label>구역<select data-rail="section"></select></label>
        <label>스토커 이동 (m)<input name="bufferOffset" type="number" min="-2" max="2" step=".5" required></label>
        <label>보관 슬롯<input name="bufferCapacity" type="number" min="1" max="6" required></label>
      </div></fieldset>
      <fieldset><legend>장비 로드포트</legend><div class="experiment-fields">
        <label>장비<select data-rail="port"></select></label>
        <label>로드포트 이동 (m)<input name="portOffset" type="number" min="-.7" max=".7" step=".1" required></label>
        <label>레일 연결<input name="portOpen" type="checkbox"></label>
      </div></fieldset>
      <div class="experiment-submit"><button type="submit" class="experiment-primary">배치 적용·재계산</button>
        <button type="button" data-rail="reset">기본 배치로 복원</button><span data-rail="status" role="status"></span></div>
    </form>
    <p class="experiment-detail" data-rail="validation"></p>
    <canvas data-rail="diagram" width="900" height="450" role="img" aria-label="팹 레일 점유율 평면 · 원을 눌러 로드포트 선택"></canvas>
    <p class="experiment-detail">녹색에서 적색으로 갈수록 점유가 높습니다. 회색 점은 연결이 끊긴 포트입니다. 비교 지표는 동일 주문과 공통 관찰 시간으로 계산합니다.</p>
    <div class="experiment-totals"><table><caption>기본 배치와 적용 배치</caption><thead><tr><th scope="col">지표</th><th scope="col">기본</th><th scope="col">적용</th></tr></thead><tbody data-rail="comparison"></tbody></table></div>
    <div class="experiment-totals"><table><caption>적용 배치 점유 상위 레일</caption><thead><tr><th scope="col">구간</th><th scope="col">점유율</th></tr></thead><tbody data-rail="bottlenecks"></tbody></table></div>`;
  host.append(dialog);
  const get=<T extends HTMLElement=HTMLElement>(id:string)=>dialog.querySelector<T>(`[data-rail="${id}"]`)!;
  const form=get<HTMLFormElement>('form'),section=get<HTMLSelectElement>('section'),port=get<HTMLSelectElement>('port');
  const field=(name:string)=>form.elements.namedItem(name) as HTMLInputElement;
  const canvas=get<HTMLCanvasElement>('diagram');
  let current:ExperimentResult|undefined,original:ExperimentResult|undefined;
  let draft=defaultRailEdit(),saved=defaultRailEdit(),edited=false,usage=new Map<string,number>();
  const hits=new Map<string,{x:number;z:number}>();
  function fill(){
    field('west').value=String(draft.west);field('east').value=String(draft.east);
    field('westOpen').checked=draft.westOpen;field('eastOpen').checked=draft.eastOpen;
    fillSection();fillPort();
  }
  function fillSection(){
    const buffer=draft.buffers[Number(section.value) as FabSections];
    field('bufferOffset').value=String(buffer?.offset??0);field('bufferCapacity').value=String(buffer?.capacity??2);
  }
  function fillPort(){
    field('portOffset').value=String(draft.ports[port.value]?.offset??0);
    field('portOpen').checked=draft.ports[port.value]?.open??true;
  }
  function read(name:string){
    if(!form.checkValidity())return;
    draft.west=+field('west').value;draft.east=+field('east').value;
    draft.westOpen=field('westOpen').checked;draft.eastOpen=field('eastOpen').checked;
    if(name.startsWith('buffer'))draft.buffers[Number(section.value) as FabSections]={offset:+field('bufferOffset').value,capacity:+field('bufferCapacity').value};
    if(name.startsWith('port'))draft.ports[port.value]={offset:+field('portOffset').value,open:field('portOpen').checked};
    edited=true;get('status').textContent='초안 배치 · 계산 결과는 마지막 적용 기준';draw();
  }
  function point(p:RailPoint){
    const cross=p.id.startsWith('spine-cross-')?p.id.endsWith('-0')?'west':'east':undefined;
    const buffer=p.id.startsWith('buffer-line-')?Number(p.id.at(-1)) as FabSections:undefined;
    const change=buffer?(draft.buffers[buffer]?.offset??0)-(saved.buffers[buffer]?.offset??0):
      (draft.ports[p.id]?.offset??0)-(saved.ports[p.id]?.offset??0);
    return {x:cross?draft[cross]:p.x+change,z:p.z};
  }
  function draw(){
    if(!current)return;
    const ctx=canvas.getContext('2d');if(!ctx)return;
    const width=current.campusFloor?.width??73,depth=current.campusFloor?.depth??52;
    const x=(value:number)=>(value/width+.5)*(canvas.width-50)+25,z=(value:number)=>(value/depth+.5)*(canvas.height-46)+23;
    ctx.fillStyle='#e7eff8';ctx.fillRect(0,0,canvas.width,canvas.height);hits.clear();
    ctx.strokeStyle='#b9cede';ctx.lineWidth=1;
    for(let i=-30;i<=30;i+=5){ctx.beginPath();ctx.moveTo(x(i),0);ctx.lineTo(x(i),canvas.height);ctx.stroke();}
    const rendered=new Set<string>(),high=Math.max(.01,...usage.values());
    for(const edge of current.edges){
      if(rendered.has(edge.block))continue;
      if(draft.ports[edge.from.id]?.open===false||draft.ports[edge.to.id]?.open===false)continue;
      rendered.add(edge.block);
      const crossover=edge.from.id.startsWith('spine-cross')&&edge.to.id.startsWith('spine-cross')&&edge.from.z!==edge.to.z;
      if(crossover&&!(edge.from.id.endsWith('-0')?draft.westOpen:draft.eastOpen))continue;
      const a=point(edge.from),b=point(edge.to),ratio=(usage.get(edge.block)??0)/high;
      ctx.strokeStyle=edited?'#65829e':`hsl(${113*(1-ratio)} 66% 39%)`;
      ctx.lineWidth=edge.kind==='siding'?1.8:4;
      ctx.beginPath();ctx.moveTo(x(a.x),z(a.z));ctx.lineTo(x(b.x),z(b.z));ctx.stroke();
    }
    const disconnected=new Set(current.unreachablePorts);
    for(const station of current.stations){
      const marker=point(station.point),id=station.point.id;
      const isSelected=station.type==='tool'&&id===port.value;
      const inactive=draft.ports[id]?.open===false||disconnected.has(id)&&draft.ports[id]?.open!==true;
      hits.set(id,{x:x(marker.x),z:z(marker.z)});
      ctx.fillStyle=inactive?'#74838b':isSelected?'#d9811e':station.type==='tool'?'#1a486d':'#62428a';
      ctx.beginPath();ctx.arc(x(marker.x),z(marker.z),isSelected?7:station.type==='tool'?3.5:5,0,Math.PI*2);ctx.fill();
    }
  }
  function rows(target:string,data:(string|number)[][]){
    const body=get<HTMLTableSectionElement>(target);body.replaceChildren();
    for(const record of data){const row=body.insertRow();for(const value of record)row.insertCell().textContent=String(value);}
  }
  function update(run:ExperimentResult,base:ExperimentResult|undefined,edit?:CampusRailEdit){
    current=run;original=base??run;edited=false;
    saved=structuredClone(edit??defaultRailEdit());draft=structuredClone(saved);
    const selectedSection=section.value,selectedPort=port.value;
    const areas=run.campusFloor?.areas??[];
    section.replaceChildren(...areas.map(item=>new Option(sectionName(item.section)+' · '+item.product.toUpperCase(),String(item.section))));
    if(areas.some(item=>String(item.section)===selectedSection))section.value=selectedSection;
    const tools=run.stations.filter(station=>station.type==='tool');
    port.replaceChildren(...tools.map(station=>new Option(station.label,station.point.id)));
    if(tools.some(tool=>tool.point.id===selectedPort))port.value=selectedPort;
    const horizon=Math.min(run.input.horizon,original.input.horizon);
    usage=railUsage(run,horizon);
    const before=metricsAt(original,horizon),after=metricsAt(run,horizon);
    rows('comparison',[
      ['시간당 완료 웨이퍼',before.wph,after.wph],['운송 요청부터 안착 P95 (초)',before.handoffP95,after.handoffP95],
      ['합류 대기 (초)',before.mergeWait,after.mergeWait],['미완료 운송',before.incomplete,after.incomplete],
      ['왕복 불가 로드포트',original.unreachablePorts.length,run.unreachablePorts.length],
    ].map(([name,a,b])=>[String(name),figure(a as number|null),figure(b as number|null)]));
    rows('bottlenecks',[...usage].filter(([,ratio])=>ratio>0).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([block,ratio])=>[railLabel(block),figure(ratio*100)+'%']));
    get('validation').textContent=run.unreachablePorts.length?'왕복 불가 · '+tools.filter(tool=>run.unreachablePorts.includes(tool.point.id)).map(tool=>tool.label).join(' · '):
      `모든 로드포트 왕복 가능 · ${tools.length}대`;
    get('status').textContent=`관찰 ${figure(horizon)}초 · 적용 완료`;fill();draw();
  }
  function setBusy(){
    form.setAttribute('aria-busy','true');get('status').textContent='배치와 운송 예약 재계산 중';
  }
  form.addEventListener('input',event=>{const target=event.target;if(target instanceof HTMLInputElement)read(target.name);});
  section.addEventListener('change',fillSection);port.addEventListener('change',()=>{fillPort();draw();});
  canvas.addEventListener('pointerup',event=>{
    const bounds=canvas.getBoundingClientRect();
    const x=(event.clientX-bounds.left)/bounds.width*canvas.width,z=(event.clientY-bounds.top)/bounds.height*canvas.height;
    const id=[...hits].filter(([id])=>current?.stations.some(station=>station.type==='tool'&&station.point.id===id))
      .map(([id,at])=>({id,distance:Math.hypot(x-at.x,z-at.z)})).sort((a,b)=>a.distance-b.distance)[0];
    if(id&&id.distance<15){port.value=id.id;fillPort();draw();}
  });
  form.addEventListener('submit',event=>{event.preventDefault();if(form.reportValidity()){setBusy();apply(structuredClone(draft));}});
  get('reset').addEventListener('click',()=>{setBusy();apply();});
  get('close').addEventListener('click',()=>dialog.close());
  return {open(run:ExperimentResult,site:string,base?:ExperimentResult,edit?:CampusRailEdit){
    get('site').textContent=site;update(run,base,edit);if(!dialog.open)dialog.showModal();
  },update(run:ExperimentResult,base?:ExperimentResult,edit?:CampusRailEdit){if(dialog.open)update(run,base,edit);form.setAttribute('aria-busy','false');},
  failed(){form.setAttribute('aria-busy','false');get('status').textContent='배치 계산을 완료하지 못했습니다.';},
  close(){if(dialog.open)dialog.close();},dispose(){dialog.remove();}};
}
