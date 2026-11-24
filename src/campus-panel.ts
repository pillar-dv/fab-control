import {campusAreas,campusDefaults,campusHbmExample,campusInventory,campusMetrics,campusProductNames,
  recordCampusReturn,shippingNames,traceBox,type CampusInput,type CampusProduct,type CampusResult,type ShippingRoute} from './campus';
import {campusSize,campusZones,fabs,fabBays,fabFloors,bayFor,isFabSite,isExternal,
  type CampusZone,type FabSite,type FabFloor,type FabBay} from './campus-layout';
import {createCampusScene,type CampusView} from './campus-scene';
import {createExperimentScene} from './experiment-scene';
import {equipmentModelName} from './equipment-catalog';
import {sectionName,type CampusRailEdit,type FabSections} from './campus-fab-layout';
import type {ExperimentResult} from './fab-experiment';
import {advancePlayback,facilityPlayback,mergePlaybackWindows,startPlayback,type FacilityPlayback,type PlaybackWindow} from './facility-playback';
import type {createFacilityScene} from './facility-scene';
import {intervalIndex,upperBound} from './timeline-index';
import type {CampusJob,CampusReply} from './campus-worker';
import {runWorker} from './simulation-worker';

const clock=(seconds:number)=>Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0');
const numbers=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1});
const value=(count:number|null,unit='')=>count===null?'—':numbers.format(count)+unit;
const routes=(allowBoard:boolean)=>Object.entries(shippingNames).filter(([id])=>allowBoard||id!=='board')
  .map(([id,name])=>`<option value="${id}">${name}</option>`).join('');
const zoneOptions=Object.entries(campusZones).map(([id,zone])=>`<option value="${id}">${zone.name}</option>`).join('');
const faultInput=(name:string,label:string)=>`<label class="campus-check"><input type="checkbox" name="${name}">${label}</label>`;
const siteLabel=(site:FabSite)=>site==='fab'?'A동':'B동';
const siteSections=[1,2] as const;
const areaField=(site:FabSite,section:FabSections)=>site+'-'+section;
const measures=[
  ['inbound','입고 로트','건'],['quarantined','격리 로트','건'],['yield','다이 소트 수율','%'],
  ['packageYield','최종 시험 합격률','%'],['accepted','합격 패키지','개'],['delivered','고객 인도','개'],
  ['waiting','조립 부품 대기 합계','초'],['dockOnTime','정시 자재 입고율','%'],['onTime','정시 고객 인도율','%'],
  ['fabBusy','팹 가공 예약 시간 합계','초'],['finishedStock','완제품 창고 재고','개'],
  ['waferComplete','팹 완료 웨이퍼','장'],['dockWait','도크 대기 합계','초'],
  ['testWait','초회 ATE 대기 합계','초'],['fabTransfer','동 간 FOUP 이송 합계','초'],['utilityLines','가동 중인 팹','동'],
  ['dueOnTime','기한 도달 주문의 정시 인도율','%'],
] as const;

export function createCampusPanel(host:HTMLElement){
  const dialog=document.createElement('section');
  dialog.className='fab-campus';
  dialog.setAttribute('aria-labelledby','campus-title');
  dialog.innerHTML=`
    <header class="campus-head">
      <div><h1 id="campus-title">반도체 캠퍼스</h1><p>가상 부지 ${campusSize.width} × ${campusSize.depth} m · 웨이퍼 팹 A·B동과 후공정·유통 거점</p></div>
      <a href="#" class="mode-home-link" data-mode-home>처음 화면</a>
    </header>
    <form class="campus-config" data-campus="setup">
      <div class="campus-fields">
        <label>주문당 수량<select name="units"><option>3</option><option>4</option><option selected>5</option><option>6</option><option>7</option><option>8</option></select></label>
        <label>구역당 OHT 대수<select name="fleet">${Array.from({length:6},(_,i)=>`<option>${i+1}</option>`).join('')}</select></label>
        <label>주문 묶음<select name="waves"><option value="1">GPU·NPU 각 1건</option><option value="2">GPU·NPU 각 2건</option><option value="3" selected>GPU·NPU 각 3건</option></select></label>
        <label>가동 생산동<select name="fabCount"><option value="1">A동 가동</option><option value="2" selected>A·B동 가동</option></select></label>
        <label>동별 생산 구역<select name="sections"><option value="1">1구역 · 생산라인 1개</option><option value="2" selected>2구역 · 생산라인 2개</option></select></label>
        <label>공용 시험 설비<select name="testLanes"><option value="1">ATE 1대</option><option value="2">ATE 2대</option></select></label>
        <label>입고 하역 도크<select name="docks"><option value="1">1곳</option><option value="2" selected>2곳</option></select></label>
        <label>유틸리티 공급 회선<select name="utilityLines"><option value="1">1회선</option><option value="2" selected>2회선</option></select></label>
        <label>GPU 출하 경로<select name="gpuRoute">${routes(true)}</select></label>
        <label>NPU 출하 경로<select name="npuRoute">${routes(false)}</select></label>
        <label>HBM 입고 지연 (초)<input type="number" required name="hbmDelay" min="0" max="1200" step="1" value="0"></label>
        <label>외부 출하 지연 (초)<input type="number" required name="deliveryDelay" min="0" max="1200" step="1" value="0"></label>
      </div>
      <fieldset class="campus-products">
        <legend>구역별 생산 품목</legend>
        ${fabs.flatMap(site=>siteSections.map(section=>`<label data-area="${areaField(site,section)}">${siteLabel(site)} ${sectionName(section)}
          <select name="${areaField(site,section)}" aria-label="${siteLabel(site)} ${sectionName(section)} 생산 품목">
            <option value="">자동 배정</option><option value="gpu">GPU</option><option value="npu">NPU</option>
          </select></label>`)).join('')}
      </fieldset>
      <div class="campus-conditions">${faultInput('holdWafer','GPU 웨이퍼 입고 격리')}${faultInput('utilityOutage','유틸리티 투입 보류')}${faultInput('testOutage','ATE 가동 중지')}</div>
      <div class="campus-actions">
        <button type="submit" class="campus-primary">시나리오 적용</button>
        <button type="button" data-campus="hbm">HBM 지연 예시</button>
        <button type="button" data-campus="normal">정상 조건</button>
        <span data-campus="status" role="status"></span>
      </div>
    </form>
    <div class="campus-summary" data-campus="summary" aria-label="현재 운전 지표"></div>
    <div class="campus-workspace">
      <section class="campus-plan" aria-label="캠퍼스 3D 운전">
        <div class="campus-views">
          <button type="button" data-campus="map" aria-pressed="true">캠퍼스</button>
          <button type="button" data-campus="top" aria-pressed="false">평면도</button>
          <button type="button" data-campus="network" aria-pressed="false">공급망</button>
          <button type="button" data-campus="facility" aria-pressed="false">선택 시설 열기</button>
          <button type="button" data-campus="fab" aria-pressed="false">팹 내부</button>
          <label>시설<select data-campus="zone" aria-label="캠퍼스 시설">${zoneOptions}</select></label>
        </div>
        <nav class="campus-location" data-campus="location" aria-label="현재 관찰 위치"></nav>
        <div class="campus-views campus-inspector" data-campus="inspector" hidden>
          <label>생산동<select data-campus="fabSite" aria-label="팹 선택"><option value="fab">A동</option><option value="fabB">B동</option></select></label>
          <label>건물 층<select data-campus="floor" aria-label="건물 층">${Object.entries(fabFloors).map(([id,item])=>`<option value="${id}"${id==='process'?' selected':''}>${item.name}</option>`).join('')}</select></label>
          <label data-campus="sectionLabel">생산 구역<select data-campus="section" aria-label="생산 구역"></select></label>
          <label data-campus="bayLabel">공정 분류<select data-campus="bay" aria-label="공정 분류"><option value="">전체 공정</option>${Object.entries(fabBays).map(([id,item])=>`<option value="${id}">${item.name.replace(' 베이','')}</option>`).join('')}</select></label>
          <label data-campus="toolLabel">장비<select data-campus="tool" aria-label="장비"></select></label>
          <button type="button" data-campus="fabTop">팹 평면</button>
          <button type="button" data-campus="railEditor">레일 편집</button>
          <button type="button" data-campus="railHeat" aria-pressed="false">레일 점유 색상</button>
          <button type="button" data-campus="chambers" aria-pressed="false">장비·챔버 단면</button>
          <button type="button" data-campus="toolNext">다음 장비 가동</button>
        </div>
        <div class="campus-viewport" data-campus="mapHost"></div>
        <div class="campus-viewport" data-campus="fabHost" hidden></div>
        <div class="campus-viewport" data-campus="facilityHost" hidden></div>
        <p data-campus="fallback" class="campus-subtle" hidden>이 환경에서는 3D 보기를 열 수 없습니다. 시설과 운전 기록은 아래에서 확인할 수 있습니다.</p>
        <div class="campus-fab-readout" data-campus="fabReadout" hidden></div>
        <p class="campus-legend campus-fab-legend" data-campus="fabLegend" hidden><span>팹 공용 본선</span><span>구역 내부 순환</span><span>로드포트·대기선</span><span>본선 연결 분기</span></p>
        <p class="campus-subtle campus-playback-status" data-campus="detailStatus" hidden></p>
        <ul class="campus-equipment-status" data-campus="equipmentStatus" aria-label="시설 장비 상태" hidden></ul>
        <p class="campus-legend" data-campus="mapLegend"><span>● 외부 운송</span><span>● 자재 이송</span><span>● FOUP</span><span>● 다이·패키지 트레이</span><span>● 출하 상자</span></p>
        <div class="campus-play">
          <button type="button" class="campus-primary" data-campus="play">재생</button>
          <button type="button" data-campus="step">다음 기록</button>
          <button type="button" data-campus="finish">종료 시점</button>
          <label class="campus-range"><span>재생 시점</span><input type="range" data-campus="time" aria-label="캠퍼스 재생 시점" min="0" step="1"></label>
          <output data-campus="clock" aria-label="캠퍼스 시각"></output>
        </div>
      </section>
      <section class="campus-operations" aria-label="주문과 시설 운전">
        <h3>주문 진행</h3><div data-campus="orders" class="campus-orders"></div>
        <div class="campus-jumps" data-campus="jumps" aria-label="시설 대기 바로 보기"></div>
        <div class="campus-zone-head"><h3 data-campus="zoneTitle"></h3><button type="button" data-campus="zoneNext">시설의 다음 기록</button></div>
        <p class="campus-subtle" data-campus="zoneActivity"></p>
        <ol class="campus-events" data-campus="log"></ol>
        <p class="campus-subtle">장비·제품 수량, 공정 시간, 주문 납기는 모형의 설정값입니다.</p>
      </section>
    </div>
    <div class="campus-records">
      <details data-campus="inventoryDetails">
        <summary>자재 입고와 창고 재고</summary>
        <div class="campus-scroll"><table><thead><tr><th scope="col">발주 / 로트</th><th scope="col">품목</th><th scope="col">도착 / 약속</th><th scope="col">상태</th><th scope="col">가용</th><th scope="col">사용</th><th scope="col">격리</th></tr></thead><tbody data-campus="inventory"></tbody></table></div>
      </details>
      <details data-campus="waferDetails">
        <summary>웨이퍼 맵과 양품 선별</summary>
        <div class="campus-wafer-controls"><label>검사 웨이퍼<select data-campus="wafer" aria-label="검사 웨이퍼"></select></label><span>● 양품 · × 불합격</span></div>
        <div class="campus-wafer" data-campus="waferMap" aria-label="웨이퍼 다이 맵"></div><p data-campus="waferInfo" class="campus-subtle"></p>
      </details>
      <details data-campus="traceDetails">
        <summary>출하 상자와 반품 추적</summary>
        <div class="campus-wafer-controls"><label>출하 상자<select data-campus="box" aria-label="출하 상자"></select></label><button type="button" data-campus="rma">반품 접수</button></div>
        <p class="campus-subtle" data-campus="traceInfo"></p><div data-campus="trace"></div>
      </details>
      <details>
        <summary>정상 운전과 최종 지표 비교</summary>
        <div class="campus-scroll"><table><thead><tr><th scope="col">지표</th><th scope="col">정상 조건</th><th scope="col">현재 조건</th></tr></thead><tbody data-campus="compare"></tbody></table></div>
        <p class="campus-subtle">같은 주문 수량·OHT 대수·유통 경로를 적용합니다. 정시 고객 인도율은 인도된 주문을 기준으로 계산합니다.</p>
      </details>
      <details data-campus="capacityDetails">
        <summary>생산동·시험동 증설 비교</summary>
        <div class="campus-scroll"><table><thead><tr><th scope="col">지표</th><th scope="col">A동</th><th scope="col">A·B동</th><th scope="col">A·B동 + ATE 2대</th></tr></thead><tbody data-campus="capacity"></tbody></table></div>
        <p class="campus-subtle" data-campus="capacityWindow"></p>
      </details>
    </div>`;
  host.append(dialog);
  const get=<T extends HTMLElement=HTMLElement>(name:string)=>dialog.querySelector<T>(`[data-campus="${name}"]`)!;
  const setup=get<HTMLFormElement>('setup'),slider=get<HTMLInputElement>('time'),zonePicker=get<HTMLSelectElement>('zone');
  const waferPicker=get<HTMLSelectElement>('wafer'),boxPicker=get<HTMLSelectElement>('box');
  const field=(name:keyof CampusInput)=>setup.elements.namedItem(name) as HTMLInputElement;
  const productPicker=(site:FabSite,section:FabSections)=>setup.elements.namedItem(areaField(site,section)) as HTMLSelectElement;
  const selectedFabs=()=>field('fabCount').value==='1'?1 as const:2 as const;
  const selectedSections=()=>field('sections').value==='1'?1 as const:2 as const;
  let result:CampusResult|undefined,normal:CampusResult|undefined,originalLayout:CampusResult|undefined;
  let railEdits:NonNullable<CampusInput['railEdits']>={};
  let railPanel:ReturnType<typeof import('./campus-rail-panel')['createCampusRailPanel']>|undefined,railSite:FabSite='fab';
  let heatOn=false,disposed=false;
  const heatCache=new WeakMap<ExperimentResult,ReadonlyMap<string,number>>();
  let selected:CampusZone='fab',view:CampusView|'fab'='map';
  let map:ReturnType<typeof createCampusScene>|undefined,fab:ReturnType<typeof createExperimentScene>|undefined;
  let room:ReturnType<typeof createFacilityScene>|undefined,facility:FacilityPlayback|undefined;
  let windows:PlaybackWindow[]=[],loadingRoom=false,roomRequest=0;
  let fabPlan:ExperimentResult|undefined,compared:CampusResult[]|undefined;
  let calculation:AbortController|undefined,capacityCalculation:AbortController|undefined;
  let workAt=intervalIndex<CampusResult['work'][number]>([]),movesAt=intervalIndex<CampusResult['moves'][number]>([]);
  let clipsAt=intervalIndex<FacilityPlayback['clips'][number]>([]);
  let siteWork=new Map<FabSite,ReturnType<typeof intervalIndex<ExperimentResult['work'][number]>>>();
  let toolWork=new Map<string,ReturnType<typeof intervalIndex<ExperimentResult['work'][number]>>>();
  let floor:FabFloor='process',region:FabSections|''='',bay:FabBay|''='',tool='',cutaway=false;
  let time=0,playing=false,frame=0,lastFrame=0,lastReadout=0;
  let shownWafers:string|undefined,shownBoxes:string|undefined;
  function updateSelect(select:HTMLSelectElement,items:{id:string;label:string}[],empty:string){
    const previous=select.value;
    select.replaceChildren(...(items.length?items.map(item=>new Option(item.label,item.id)):[new Option(empty,'')]));
    if(items.some(item=>item.id===previous))select.value=previous;
    select.disabled=items.length===0;
  }
  function readInputs():CampusInput{
    const areaProducts:NonNullable<CampusInput['areaProducts']>={};
    for(const site of fabs)for(const section of siteSections){
      const product=productPicker(site,section).value;
      if(product==='gpu'||product==='npu')(areaProducts[site]??={})[section]=product;
    }
    return {units:+field('units').value,fleet:+field('fleet').value,
      hbmDelay:+field('hbmDelay').value,deliveryDelay:+field('deliveryDelay').value,
      holdWafer:field('holdWafer').checked,utilityOutage:field('utilityOutage').checked,testOutage:field('testOutage').checked,
      gpuRoute:field('gpuRoute').value as ShippingRoute,npuRoute:field('npuRoute').value as ShippingRoute,
      fabCount:selectedFabs(),testLanes:field('testLanes').value==='1'?1:2,
      docks:field('docks').value==='1'?1:2,utilityLines:field('utilityLines').value==='1'?1:2,
      sections:selectedSections(),areaProducts,railEdits:Object.keys(railEdits).length?railEdits:undefined,
      waves:Number(field('waves').value) as CampusInput['waves']};
  }
  function updateProductPickers(){
    const configuration={fabCount:selectedFabs(),sections:selectedSections()};
    for(const site of fabs){
      const areas=campusAreas(configuration,site);
      for(const section of siteSections){
        const picker=productPicker(site,section);
        const area=areas.find(item=>item.section===section);
        picker.disabled=!area;
        picker.parentElement!.hidden=!area;
        if(area)picker.options[0].text='자동 · '+campusProductNames[area.product];
      }
    }
  }
  function status(message:string){get('status').textContent=message;}
  const inDetail=()=>view==='facility'||view==='fab';
  function fabTools(current:ExperimentResult|undefined){
    return current?.stations.filter(station=>station.type==='tool'&&(!region||station.section===region)&&
      (!bay||(station.bay??bayFor(station.point.id))===bay))??[];
  }
  function setPlaying(value:boolean){
    cancelAnimationFrame(frame);
    playing=value&&(!inDetail()||windows.length>0);
    lastFrame=performance.now();lastReadout=0;
    get('play').textContent=playing?'정지':'재생';
    if(playing)frame=requestAnimationFrame(tick);
  }
  function refreshPlayback(autoplay:boolean){
    facility=view==='facility'&&result?facilityPlayback(result,selected):undefined;
    clipsAt=intervalIndex(facility?.clips??[]);
    windows=facility?.windows??[];
    if(view==='fab'){
      const current=plan();
      const stations=new Set(fabTools(current).map(station=>station.point.id));
      const districts=new Set(current?.campusFloor?.areas.filter(item=>!region||item.section===region).map(item=>item.district)??[]);
      const work=current?.work.filter(item=>floor!=='process'||(tool?item.station===tool:stations.has(item.station)))??[];
      const moves=floor==='process'&&!cutaway?current?.vehicles.filter(vehicle=>!region||vehicle.section===region)
        .flatMap(vehicle=>vehicle.motion.filter(({from,to})=>{
          if(tool)return from.id===tool||to.id===tool;
          if(bay)return stations.has(from.id)||stations.has(to.id);
          return !region||districts.has(from.district??'')||districts.has(to.district??'');
        }))??[]:[];
      windows=mergePlaybackWindows([...work,...moves]);
    }
    if(autoplay&&windows.length)time=startPlayback(time,windows);
    setPlaying(autoplay);
  }
  function resetFaults(){
    field('hbmDelay').value='0';field('deliveryDelay').value='0';
    for(const key of ['holdWafer','testOutage','utilityOutage'] as const)field(key).checked=false;
  }
  const task=(job:CampusJob,signal:AbortSignal)=>runWorker<CampusJob,CampusReply>(
    ()=>new Worker(new URL('./campus-worker.ts',import.meta.url),{type:'module'}),job,signal);
  function indexResult(run:CampusResult){
    workAt=intervalIndex(run.work);movesAt=intervalIndex(run.moves);
    siteWork=new Map(fabs.map(site=>[site,intervalIndex(run.fabRuns[site]?.work??[])]));
    toolWork.clear();
  }
  async function simulate(message='새 운전 준비 완료'){
    const input=readInputs();
    setPlaying(false);
    calculation?.abort();capacityCalculation?.abort();
    const job=new AbortController();calculation=job;
    setup.setAttribute('aria-busy','true');
    status('캠퍼스 시나리오 계산 중');
    try{
      const reply=await task({type:'scenario',input},job.signal);
      if(reply.type!=='scenario')throw new Error(reply.type==='error'?reply.message:'잘못된 캠퍼스 결과');
      result=reply.current;normal=reply.normal;originalLayout=reply.originalLayout;indexResult(result);
    }catch(error){
      if(!job.signal.aborted){console.error(error);status('계산을 끝내지 못했습니다. 시나리오를 다시 적용하세요.');railPanel?.failed();}
      return;
    }finally{
      if(calculation===job){calculation=undefined;setup.setAttribute('aria-busy','false');}
    }
    compared=undefined;
    time=0;shownWafers=undefined;shownBoxes=undefined;
    slider.max=String(Math.ceil(result.end));
    const waiting=[...new Set(result.orders.filter(order=>!order.fabSite).map(order=>campusProductNames[order.product]))];
    const allocationNote=waiting.length?waiting.join(' · ')+' 주문은 생산 구역 배정 대기 중입니다.':'';
    status([message,allocationNote].filter(Boolean).join(' · '));
    const updatedRail=result.fabRuns[railSite];
    if(updatedRail)railPanel?.update(updatedRail,originalLayout?.fabRuns[railSite],result.input.railEdits?.[railSite]);
    updateCompare();void updateCapacity();
    if(inDetail())switchView(view);
    else draw();
  }
  function plan(){
    return result?.fabRuns[isFabSite(selected)?selected:'fab'];
  }
  async function repaintHeat(){
    const current=plan(),scene=fab;
    if(!current||!scene)return;
    if(!heatOn){scene.setRailHeat();draw();return;}
    let values=heatCache.get(current);
    try{
      if(!values){
        const {railUsage}=await import('./campus-rail-panel');
        const usage=railUsage(current),max=Math.max(.01,...usage.values());
        values=new Map([...usage].map(([id,ratio])=>[id,ratio/max]));heatCache.set(current,values);
      }
      if(heatOn&&fab===scene&&plan()===current){scene.setRailHeat(values);draw();}
    }catch(error){console.error(error);status('레일 점유 정보를 열지 못했습니다.');}
  }
  async function openRailEditor(){
    const site=isFabSite(selected)?selected:'fab',current=result?.fabRuns[site];
    if(!current)return;
    const button=get<HTMLButtonElement>('railEditor');button.disabled=true;
    try{
      const {createCampusRailPanel}=await import('./campus-rail-panel');
      if(disposed||host.hidden)return;
      railPanel??=createCampusRailPanel(host,(edit?:CampusRailEdit)=>{
        railEdits={...railEdits};
        if(edit)railEdits[railSite]=edit;
        else delete railEdits[railSite];
        void simulate(edit?'레일 배치 반영 완료':'기본 레일 배치 복원 완료');
      });
      railSite=site;
      railPanel.open(current,siteLabel(site),originalLayout?.fabRuns[site],result?.input.railEdits?.[site]);
    }catch(error){console.error(error);status('레일 편집 화면을 열지 못했습니다.');}
    finally{button.disabled=false;}
  }
  function syncFab(){
    const current=plan();
    if(current&&!fab)fab=createExperimentScene(get('fabHost'),true);
    if(fabPlan!==current){
      fabPlan=current;
      if(current)fab?.load(current);
    }
    const areas=current?.campusFloor?.areas??[];
    if(region&&!areas.some(item=>item.section===region))region='';
    const regionPicker=get<HTMLSelectElement>('section');
    regionPicker.replaceChildren(new Option('전체 구역',''),...areas.map(area=>new Option(
      sectionName(area.section)+' · '+area.product.toUpperCase(),String(area.section))));
    regionPicker.value=String(region);
    const tools=fabTools(current);
    const toolPicker=get<HTMLSelectElement>('tool');
    toolPicker.replaceChildren(new Option('선택 안 함',''),...tools.map(item=>new Option(item.label,item.point.id)));
    tool=tools.some(item=>item.point.id===tool)?tool:'';
    toolPicker.value=tool;
    if(!tool)cutaway=false;
    get('sectionLabel').hidden=floor!=='process';
    get('bayLabel').hidden=floor!=='process';
    get('toolLabel').hidden=floor!=='process';
    get('fabTop').hidden=floor!=='process'||cutaway||!current;
    get('railEditor').hidden=get('railHeat').hidden=floor!=='process'||cutaway||!current;
    get<HTMLButtonElement>('chambers').disabled=!tool||floor!=='process';
    get('chambers').setAttribute('aria-pressed',String(cutaway));
    get('toolNext').hidden=floor!=='process';
    get<HTMLSelectElement>('fabSite').value=isFabSite(selected)?selected:'fab';
    get('fabHost').hidden=!current;
    fab?.showLevel(cutaway?'chambers':floor,current?.policy.chambers);
    if(floor==='process'&&!cutaway&&(tool||bay||region))fab?.focus(tool?[tool]:tools.map(item=>item.point.id),region||undefined);
    if(heatOn&&floor==='process'&&!cutaway)void repaintHeat();
  }
  function select(zone:CampusZone){
    const changed=selected!==zone;
    selected=zone;
    zonePicker.value=zone;
    if(inDetail()&&changed){
      tool='';cutaway=false;
      switchView('facility');
    }
    else if(view==='map'&&isExternal(zone))switchView('network');
    else draw();
  }
  function closeRoom(){
    roomRequest++;
    loadingRoom=false;
    room?.dispose();room=undefined;
  }
  async function openRoom(){
    if(!facility?.machines.length)return;
    const request=++roomRequest;
    loadingRoom=true;
    try{
      const {createFacilityScene}=await import('./facility-scene');
      if(request!==roomRequest)return;
      room=createFacilityScene(get('facilityHost'),campusZones[selected].name,facility.machines);
    }catch{
      if(request!==roomRequest)return;
      get('facilityHost').hidden=true;
      get('fallback').hidden=false;
    }
    if(request===roomRequest){
      loadingRoom=false;
      lastFrame=performance.now();
      draw();
    }
  }
  function switchView(request:typeof view,autoplay=true){
    const next=request==='facility'&&isFabSite(selected)?'fab':request;
    const wasPlaying=playing&&!inDetail();
    view=next;
    if(view==='fab'&&!isFabSite(selected)){selected='fab';zonePicker.value=selected;}
    const staticSite=view==='facility'&&selected==='reserve';
    const showMap=!inDetail()||staticSite;
    const mapHost=get('mapHost'),fabHost=get('fabHost'),facilityHost=get('facilityHost');
    closeRoom();
    mapHost.hidden=!showMap;fabHost.hidden=view!=='fab';facilityHost.hidden=view!=='facility'||staticSite;
    get('inspector').hidden=view!=='fab';
    get('mapLegend').hidden=inDetail();
    if(view!=='fab')refreshPlayback(inDetail()&&autoplay||!inDetail()&&wasPlaying);
    for(const key of ['map','top','network','facility','fab'] as const)get(key).setAttribute('aria-pressed',String(key===view));
    try{
      get('fallback').hidden=true;
      if(!showMap){map?.dispose();map=undefined;}
      if(view==='fab'){
        syncFab();
      }else {
        fab?.dispose();fab=undefined;fabPlan=undefined;
        if(showMap){
          map??=createCampusScene(mapHost,select);
          map.setView(view,selected);
        }else void openRoom();
      }
    }catch{
      (view==='fab'?fabHost:showMap?mapHost:facilityHost).hidden=true;
      get('fallback').hidden=false;
    }
    if(view==='fab')refreshPlayback(autoplay);
    draw();
  }
  function jump(target:number){
    setPlaying(false);
    time=Math.min(target,result?.end??0);
    draw();
  }
  function tick(now:number){
    if(!result||!playing)return;
    if(!loadingRoom)time=inDetail()?advancePlayback(time,Math.max(0,Math.min(now-lastFrame,100))*.006,windows):
      Math.min(result.end,time+(now-lastFrame)*.033);
    lastFrame=now;
    const ended=!inDetail()&&time>=result.end,show=ended||now-lastReadout>135;
    draw(show);
    if(show)lastReadout=now;
    if(ended)setPlaying(false);
    else frame=requestAnimationFrame(tick);
  }
  function updateCompare(){
    if(!result||!normal)return;
    const benchmark=campusMetrics(normal,normal.end),current=campusMetrics(result,result.end);
    get('compare').innerHTML=measures.map(([key,label,unit])=>
      `<tr><th scope="row">${label}</th><td>${value(benchmark[key],unit)}</td><td>${value(current[key],unit)}</td></tr>`).join('');
  }
  async function updateCapacity(){
    if(!result||!get<HTMLDetailsElement>('capacityDetails').open)return;
    const run=result;
    if(!compared){
      if(capacityCalculation)return;
      const job=new AbortController();capacityCalculation=job;
      get('capacity').replaceChildren();get('capacityWindow').textContent='증설 조건 계산 중';
      try{
        const reply=await task({type:'capacity',input:run.input},job.signal);
        if(reply.type!=='capacity')throw new Error(reply.type==='error'?reply.message:'잘못된 증설 결과');
        if(result!==run)return;
        compared=reply.cases;
      }catch(error){
        if(!job.signal.aborted){console.error(error);get('capacityWindow').textContent='증설 조건을 계산하지 못했습니다.';}
        return;
      }finally{if(capacityCalculation===job)capacityCalculation=undefined;}
    }
    const window=Math.max(...result.orders.map(order=>order.due));
    const readings=compared.map(run=>campusMetrics(run,window));
    const shown=['waferComplete','fabTransfer','dockWait','testWait','accepted','delivered','dueOnTime'];
    get('capacity').innerHTML=measures.filter(([key])=>shown.includes(key)).map(([key,label,unit])=>
      `<tr><th scope="row">${label}</th>${readings.map(item=>`<td>${value(item[key],unit)}</td>`).join('')}</tr>`).join('');
    get('capacityWindow').textContent='공통 관찰 종료 '+clock(window)+' · 주문·도크·공급 회선·동별 OHT·장애 조건 동일';
  }
  function drawTrace(){
    if(!result)return;
    const current=result.boxes.filter(box=>box.verified<=time);
    const ids=current.map(item=>item.id).join('/');
    if(ids!==shownBoxes||!boxPicker.options.length){
      updateSelect(boxPicker,current.map(box=>({id:box.id,label:box.id})),'포장 완료 후 표시');
      shownBoxes=ids;
    }
    const box=current.find(item=>item.id===boxPicker.value);
    const ret=box&&result.returns.find(item=>item.box===box.id);
    const allDelivered=result.boxes.length>0&&result.boxes.every(box=>box.delivered<=time);
    get<HTMLButtonElement>('rma').disabled=!box||!allDelivered||!!ret;
    get('traceInfo').textContent=!box?'포장 검수가 끝나면 상자를 선택할 수 있습니다.':
      ret?(time<ret.received?'반품 접수 · 분석 시설로 운송 중':time<ret.inspected?'반품 인수 · 고장 분석 대기':
        time<ret.quarantinedAt?'자재 로트 추적 완료 · 관련 잔여 재고를 격리 창고로 이송 중':
        '분석용 격리 · 관련 잔여 자재 '+ret.heldLots.length+'개 로트 보류'):
        allDelivered?'고객 인도 완료 · 이 출하 상자의 반품을 접수할 수 있습니다.':'출하 상자 인도가 모두 끝나면 반품을 접수할 수 있습니다.';
    if(!box){get('trace').innerHTML='';return;}
    const trace=traceBox(result,box);
    const rows:[string,string[]][]=[
      ['패키지',trace.packages.map(item=>item.id)],['구성 다이',trace.dies.map(item=>item.id)],
      ['웨이퍼',trace.wafers.map(item=>item.id)],['공급 로트',trace.receipts.map(item=>item.id+' / '+item.po+' / '+item.supplier)],
    ];
    get('trace').innerHTML=`<p class="campus-box-label">라벨 ${box.label} · ${box.contents} · ${shippingNames[box.route]}</p>
      <ol class="campus-lineage">${rows.map(([label,items])=>`<li><strong>${label}</strong><span>${items.join(' · ')}</span></li>`).join('')}</ol>`;
  }
  function drawWafer(){
    if(!result)return;
    const available=result.wafers.filter(wafer=>wafer.sorted<=time);
    const ids=available.map(wafer=>wafer.id).join('/');
    if(ids!==shownWafers||!waferPicker.options.length){
      updateSelect(waferPicker,available.map(wafer=>({id:wafer.id,label:wafer.id})),'검사 완료 후 표시');
      shownWafers=ids;
    }
    const wafer=available.find(item=>item.id===waferPicker.value);
    get('waferInfo').textContent=wafer?`공급 로트 ${wafer.material} · 검사 ${wafer.dies.length}개 · 양품 ${wafer.dies.filter(die=>die.good).length}개`:'웨이퍼 소트 완료 후 다이별 판정이 표시됩니다.';
    get('waferMap').innerHTML=wafer?wafer.dies.map(die=>
      `<span class="${die.good?'pass':'fail'}" title="${die.id} · ${die.good?'양품':'불합격'}">${die.good?'●':'×'} D${die.row*3+die.column+1}</span>`).join(''):'';
  }
  function draw(readout=true){
    if(!result)return;
    const run=result;
    const active=view==='map'||view==='top'||view==='network'||readout?workAt(time):[];
    const current=plan();
    const site=isFabSite(selected)?selected:'fab',key=site+'/'+tool;
    let toolIndex=toolWork.get(key);
    if(tool&&current&&!toolIndex){toolIndex=intervalIndex(current.work.filter(item=>item.station===tool));toolWork.set(key,toolIndex);}
    const chamberItems=toolIndex?.(time).flatMap(item=>item.activities).filter(task=>task.start<=time&&task.end>time)??[];
    const equipment=clipsAt(time);
    if(view==='fab'){
      if(cutaway)fab?.updateChambers(chamberItems,time);
      else if(floor!=='process')fab?.updateSupport(time,windows.some(item=>item.start<=time&&item.end>time));
      else fab?.update(time,tool);
    }
    else if(view==='facility'&&selected!=='reserve')room?.update(time,equipment);
    else {
      const zones=active.map(item=>item.zone);
      for(const site of ['fab','fabB'] as const){
        if(siteWork.get(site)?.(time).length)zones.push(site);
      }
      map?.update(time,movesAt(time),zones,selected,run.input.fabCount);
    }
    if(!readout)return;
    const figures=campusMetrics(run,time);
    const level=fabFloors[floor];
    const activeStation=current?.stations.find(item=>item.point.id===tool);
    const area=region&&current?.campusFloor?.areas.find(item=>item.section===region);
    const fleet=current?.vehicles.filter(car=>!region||car.section===region)??[];
    get('location').textContent=(view==='network'?'공급망':'캠퍼스')+' / '+campusZones[selected].name+
      (view==='fab'?' / '+level.name+(area&&floor==='process'?' / '+sectionName(area.section)+' '+area.product.toUpperCase():'')+
      (bay&&floor==='process'?' / '+fabBays[bay].name.replace(' 베이',''):'')+(activeStation&&floor==='process'?' / '+activeStation.label:''):'');
    const report=get('fabReadout');
    report.hidden=view!=='fab';
    report.textContent=!current?'대기 생산동 · A·B동 가동 시나리오를 적용하면 열립니다.':
      floor!=='process'?level.equipment+' · 가동 팹 '+figures.utilityLines+'동 / 공급 '+run.input.utilityLines+'회선':
      chamberItems.length?chamberItems.map(item=>'챔버 '+item.chamber+' · 웨이퍼 '+item.wafer+' · '+
        (item.kind==='load'?'투입':item.kind==='unload'?'회수':'가공')).join(' / '):
        tool?'선택한 장비의 챔버가 대기 중입니다.':current.campusFloor?
          (area?sectionName(area.section)+' '+area.product.toUpperCase():current.campusFloor.areas.length+'개 품목 라인')+
          ' · '+fabTools(current).length+'개 공정 셀 · OHT '+fleet.filter(item=>{
            const move=item.motion[upperBound(item.motion,time,segment=>segment.start)-1];return move&&time<move.end;
          }).length+
          ' / '+fleet.length+'대 운전':
          '베이와 장비를 선택하면 챔버별 작업을 볼 수 있습니다.';
    get('fabLegend').hidden=view!=='fab'||floor!=='process'||cutaway||!current?.campusFloor;
    const detailStatus=get('detailStatus');
    detailStatus.hidden=!inDetail();
    detailStatus.textContent=loadingRoom?'시설 3D 에셋 불러오는 중':
      !windows.length?'선택한 시설의 가동 기록이 없습니다.':
      playing?'선택 시설 작업 구간 반복 재생 · 시뮬레이션 시간 6배속':'일시정지 · 재생 시 선택 시설 작업 구간부터 이어집니다.';
    const equipmentStatus=get('equipmentStatus');
    equipmentStatus.hidden=!facility?.machines.length;
    if(facility?.machines.length){
      const labels=facility.machines.map(machine=>{
        const active=equipment.filter(item=>item.unit===machine.id);
        const task=active[0];
        const queued=machine.kind==='yard';
        const motion=task?queued?active.length+'대 대기':task.label+(task.reference?' · '+task.reference:''):'대기';
        const model=machine.modelId&&equipmentModelName(machine.modelId);
        return `<li class="${task?queued?'queued':'operating':''}"><strong>${machine.label}</strong>${model?`<small>${model}</small>`:''}<span>${motion}</span></li>`;
      }).join('');
      if(labels!==equipmentStatus.dataset.rendered){
        equipmentStatus.innerHTML=labels;equipmentStatus.dataset.rendered=labels;
      }
    }
    get<HTMLButtonElement>('play').disabled=inDetail()&&!windows.length;
    get<HTMLButtonElement>('toolNext').disabled=!tool||!current?.work.some(item=>item.station===tool);
    slider.value=String(time);
    get('clock').textContent=clock(time)+' / '+clock(run.end);
    get('summary').innerHTML=measures.filter(([key])=>['waferComplete','utilityLines','accepted','testWait','delivered','dueOnTime'].includes(key))
      .map(([key,label,unit])=>`<div><span>${label}</span><strong>${value(figures[key],unit)}</strong></div>`).join('');
    get('orders').innerHTML=run.orders.map(order=>{
      const ship=run.boxes.find(box=>box.order===order.id);
      const [label,style]=!order.fabSite?['구역 배정 대기','alert']:
        ship&&ship.delivered<=time?[ship.delivered<=order.due?'정시 인도':'지연 인도',ship.delivered<=order.due?'good':'alert']:
        ship&&ship.shipped<=time?['출하 운송','moving']:ship&&ship.verified<=time?['포장 완료','good']:
        time>=(order.sorted??Infinity)&&time<(order.kitStart??Infinity)?['부품 대기','alert']:
        time>=(order.kitStart??Infinity)?['조립·시험','moving']:time>=(order.release??Infinity)?['팹·웨이퍼 검사','moving']:
        ['자재 입고 대기','pending'];
      const detail=ship&&ship.delivered<=time?'인도 '+clock(ship.delivered)+' · ':'';
      const area=order.fabSite&&order.fabSection?siteLabel(order.fabSite)+' '+sectionName(order.fabSection):'배정 대기';
      return `<article><div><strong>${order.reference}</strong><small>${order.id} · ${order.quantity}개</small></div>
        <span class="campus-badge ${style}">${label}</span><small>${detail}납기 ${clock(order.due)} · ${area} · ${shippingNames[order.route]}</small></article>`;
    }).join('');
    const queued=run.moves.filter(item=>item.from==='yard'&&item.to==='yard'&&item.start<=time&&item.end>time).length;
    const testQueue=run.work.filter(item=>item.lane.startsWith('ATE')&&item.job!=='재시험'&&item.start>time&&
      run.moves.some(move=>move.to==='test'&&move.order===item.order&&move.end<=time)).length;
    const partQueue=run.orders.filter(order=>time>=(order.sorted??Infinity)&&time<(order.kitStart??Infinity)).length;
    get('jumps').innerHTML=([
      ['yard','하역 대기',queued],['test','초회 시험 대기',testQueue],['assembly','조립 부품 대기',partQueue],
    ] as const).filter(([, ,count])=>count>0).map(([id,name,count])=>
      `<button type="button" data-jump="${id}">${name} ${count}${id==='yard'?'대':'건'}</button>`).join('');
    get('zoneTitle').textContent=campusZones[selected].name;
    const work=active.filter(item=>item.zone===selected);
    const stopped=selected==='test'?run.outage:selected==='utilities'?run.utility:undefined;
    const waiting=selected==='assembly'&&run.orders.find(order=>time>=(order.sorted??Infinity)&&time<(order.kitStart??Infinity));
    get('zoneActivity').textContent=stopped&&time>=stopped.start&&time<stopped.end?'가동 중지 · '+clock(stopped.end)+' 복구 예정':
      work.length?work.map(item=>item.lane+' · '+item.job).join(' / '):
        waiting?waiting.reference+' · 조립 부품 대기 중':
        selected==='reserve'?'후속 생산동 증설 부지':
        isFabSite(selected)&&run.fabRuns[selected]?.work.some(item=>item.start<=time&&item.end>time)?'웨이퍼 공정 가동 중':
        equipment.length?equipment.map(item=>item.label).join(' / '):'진행 중인 작업 없음';
    const recorded=run.events.filter(event=>event.zone===selected&&event.time<=time).slice(-6).reverse();
    get('log').innerHTML=recorded.length?recorded.map(event=>
      `<li><time>${clock(event.time)}</time><div>${event.label}<small>${[event.order,event.ref].filter(Boolean).join(' · ')}</small></div></li>`).join(''):
      '<li class="campus-subtle">현재 시점까지 시설 기록이 없습니다.</li>';
    get<HTMLButtonElement>('zoneNext').disabled=!run.events.some(event=>event.zone===selected&&event.time>time+.01);
    drawDetails();
  }
  function refreshDetails(){
    if(!result)return;
    get('inventory').innerHTML=campusInventory(result,time).map(item=>
      `<tr><th scope="row">${item.po} / ${item.id}</th><td>${item.order} ${item.name}</td><td>${item.arrived<=time?clock(item.arrived):'—'} / ${clock(item.promised)}</td>
        <td>${item.state}</td><td>${item.available}</td><td>${item.used}</td><td>${item.quarantined}</td></tr>`).join('');
  }
  function drawDetails(){
    if(get<HTMLDetailsElement>('inventoryDetails').open)refreshDetails();
    if(get<HTMLDetailsElement>('waferDetails').open)drawWafer();
    if(get<HTMLDetailsElement>('traceDetails').open)drawTrace();
  }
  function goNext(onlyFacility=false){
    const event=result?.events.find(item=>item.time>time+.01&&(!onlyFacility||item.zone===selected));
    if(event)jump(event.time);
  }
  setup.addEventListener('submit',event=>{event.preventDefault();void simulate();});
  setup.addEventListener('change',()=>{
    calculation?.abort();
    updateProductPickers();
    status('설정을 반영하려면 시나리오를 적용하세요.');
  });
  get('hbm').addEventListener('click',()=>{
    resetFaults();field('hbmDelay').value=String(campusHbmExample);
    void simulate('HBM 입고를 '+campusHbmExample+'초 늦춘 예시');
  });
  get('normal').addEventListener('click',()=>{resetFaults();void simulate();});
  for(const key of ['map','top','network','facility','fab'] as const)get(key).addEventListener('click',()=>switchView(key));
  get<HTMLSelectElement>('fabSite').addEventListener('change',event=>{
    tool='';cutaway=false;select((event.target as HTMLSelectElement).value as CampusZone);
  });
  get<HTMLSelectElement>('floor').addEventListener('change',event=>{
    floor=(event.target as HTMLSelectElement).value as FabFloor;cutaway=false;syncFab();refreshPlayback(true);draw();
  });
  get<HTMLSelectElement>('section').addEventListener('change',event=>{
    const id=(event.target as HTMLSelectElement).value;
    region=id?Number(id) as FabSections:'';tool='';cutaway=false;syncFab();refreshPlayback(true);draw();
  });
  get<HTMLSelectElement>('bay').addEventListener('change',event=>{
    bay=(event.target as HTMLSelectElement).value as typeof bay;tool='';cutaway=false;syncFab();refreshPlayback(true);draw();
  });
  get<HTMLSelectElement>('tool').addEventListener('change',event=>{
    tool=(event.target as HTMLSelectElement).value;cutaway=false;syncFab();refreshPlayback(true);draw();
  });
  get('chambers').addEventListener('click',()=>{cutaway=!cutaway;syncFab();refreshPlayback(playing);draw();});
  get('fabTop').addEventListener('click',()=>{
    region='';bay='';tool='';cutaway=false;
    get<HTMLSelectElement>('bay').value='';
    syncFab();fab?.view(true);refreshPlayback(playing);draw();
  });
  get('railEditor').addEventListener('click',()=>void openRailEditor());
  get('railHeat').addEventListener('click',()=>{
    heatOn=!heatOn;get('railHeat').setAttribute('aria-pressed',String(heatOn));
    void repaintHeat();
  });
  get('toolNext').addEventListener('click',()=>{
    const work=plan()?.work.filter(item=>item.station===tool)??[];
    const next=work.find(item=>item.start>time+.01)??work[0];
    if(next)jump(next.start+.01);
  });
  get('jumps').addEventListener('click',event=>{
    const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-jump]');
    if(button)select(button.dataset.jump as CampusZone);
  });
  get('play').addEventListener('click',()=>{
    const next=!playing;
    if(next&&inDetail())time=startPlayback(time,windows);
    else if(next&&result&&time>=result.end)time=0;
    setPlaying(next);draw();
  });
  get('step').addEventListener('click',()=>goNext());
  get('zoneNext').addEventListener('click',()=>goNext(true));
  get('finish').addEventListener('click',()=>{if(result)jump(result.end);});
  slider.addEventListener('input',()=>jump(Number(slider.value)));
  zonePicker.addEventListener('change',()=>select(zonePicker.value as CampusZone));
  waferPicker.addEventListener('change',drawWafer);
  boxPicker.addEventListener('change',drawTrace);
  dialog.querySelectorAll('details').forEach(section=>section.addEventListener('toggle',()=>{
    if(section.open){drawDetails();updateCapacity();}
  }));
  get('rma').addEventListener('click',()=>{
    if(!result)return;
    const id=boxPicker.value,updated=recordCampusReturn(result,id,time);
    if(updated===result)return;
    result=updated;indexResult(result);slider.max=String(Math.ceil(result.end));
    select('returns');updateCompare();status(id+' 반품 등록');
    if(inDetail())refreshPlayback(true);
    else setPlaying(true);
    draw();
  });
  function deactivate(){
    calculation?.abort();capacityCalculation?.abort();
    setPlaying(false);
    closeRoom();
    railPanel?.close();
    map?.dispose();map=undefined;
    fab?.dispose();fab=undefined;fabPlan=undefined;
  }
  field('fleet').value=String(campusDefaults.fleet);
  field('gpuRoute').value=campusDefaults.gpuRoute;
  field('npuRoute').value=campusDefaults.npuRoute;
  updateProductPickers();
  return {activate(){
    if(!result)void simulate();
    switchView(view,false);
  },deactivate,dispose(){
    disposed=true;deactivate();railPanel?.dispose();dialog.remove();
  }};
}
