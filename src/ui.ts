import {createWaferLab,type LabAction,type LabView} from './wafer-lab';
import {equipmentCatalogById} from './equipment-catalog';
import type {CameraView} from './camera';
import type {Action} from './simulation';
import {actionNames} from './line-layout';

export type UIAction =
  | LabAction | {type:'lab'|'edit'|'metrics'|'experiment'}
  | {type:'follow'}
  | {type: 'product' | 'station' | 'carrier'; id: string}
  | {type: 'toggle' | 'reset' | 'advance' | 'fit' | 'cutaway' | 'dimensions'}
  | {type: 'speed'; value: number}
  | {type: 'camera'; id: CameraView};

export interface UIView {
  machineCount:number;
  portCount:number;
  fleetCount:number;
  activeVehicles:number;
  cycle:number;
  lab:LabView;
  following: boolean;
  productId: string;
  products: {id: string; name: string}[];
  steps: {name: string; stationId: string; label?: string}[];
  activeStep: number;
  completedSteps: number;
  running: boolean;
  finished: boolean;
  elapsed: number;
  speed: number;
  progress: number;
  activity: string;
  stationName: string;
  selectedStationId: string;
  equipment: {id: string; name: string; category: string; model: string; description: string; galleryId?:string};
  logs: {time: number; text: string}[];
  camera: CameraView;
  cutaway: boolean;
  dimensions: boolean;
  carriers?: {id: string; name: string}[];
  carrierId?: string;
  materialStage?: Action|'initial';
  productDescription?: string;
  productSource:{url:string;label:string};
  lotLabel?: string;
  waferLabel?: string;
}

const paths = {
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/>',
  layers: '<path d="M12 3 2.8 8 12 13l9.2-5L12 3ZM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  flow: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h6a3 3 0 0 1 3 3v1a3 3 0 0 1-3 3h-2a2.5 2.5 0 0 0 0 5h6"/>',
  scope: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  section: '<path d="m12 2 8.5 5v10L12 22l-8.5-5V7L12 2Zm0 10 8.5-5M12 12v10M12 12 3.5 7"/><path d="m8 4.3 8.5 5V19" stroke-dasharray="2 2"/>',
  cube: '<path d="m12 2 8.5 5v10L12 22l-8.5-5V7L12 2Zm0 10 8.5-5M12 12v10M12 12 3.5 7"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3.5 2"/>',
  play: '<path d="M7.5 4.8v14.4L19 12Z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none"/>',
  next: '<path d="m5 6 9 6-9 6V6Z" fill="currentColor" stroke="none"/><path d="M18 6v12"/>',
  reset: '<path d="M4 11a8 8 0 1 1 1.7 6.1M4 5v6h6"/>',
  mouse: '<rect x="6" y="2.5" width="12" height="19" rx="6"/><path d="M12 6v4"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  activity: '<path d="M2 12h5l3-7 4 14 3-7h5"/>',
  chart: '<path d="M4 4v16h16M8 16l4-6 4 3 4-6"/>',
  carrier: '<path d="M4 9h16v11H4zM7 9V6h10v3M9 4h6M8 14h8m-8 3h8"/>',
  wafer: '<circle cx="12" cy="12" r="9"/><path d="M4.5 8h15m-16 5h17m-13 5h9M8 4.5v15m5-16v17m5-13v9"/>',
  expand: '<path d="M4 10V4h6m4 0h6v6m0 4v6h-6m-4 0H4v-6"/>',
  ruler: '<path d="m3 15 12-12 6 6L9 21l-6-6Z"/><path d="m8 10 2 2m1-5 3 3m0-6 2 2"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
} as const;

function icon(name: keyof typeof paths): string {
  return '<svg class="fab-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' + paths[name] + '</svg>';
}

const escapeText = (value: string) => value.replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]!));
const twoDigits = (value: number) => String(value).padStart(2, '0');
function clock(seconds: number, hours = false) {
  const time = Math.max(0, Math.floor(seconds));
  return (hours || time >= 3600 ? twoDigits(Math.floor(time / 3600)) + ':' : '') + twoDigits(Math.floor(time / 60) % 60) + ':' + twoDigits(time % 60);
}

export function createUI(root: HTMLElement, onAction: (action: UIAction) => void) {
  root.classList.add('fab-shell');
  root.innerHTML = `
    <header class="fab-top">
      <div class="fab-brand"><span class="fab-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>FAB<span class="brand-slash">/</span>CONTROL</span></div>
      <span class="fab-appname">생산 시뮬레이터</span>
      <button class="open-editor" type="button" data-action="edit">라인 편집</button>
      <a href="#" class="mode-home-link" data-mode-home>처음 화면</a>
      <div class="fab-session"><span class="session-light" data-ui="light"></span><span data-ui="status" role="status">대기</span></div>
      <div class="fab-clock" title="시뮬레이션 시간">${icon('clock')}<time data-ui="clock">00:00:00</time></div>
    </header>
    <div class="fab-workspace">
      <aside class="fab-sidebar" aria-label="라인 구성">
        <section class="side-product">
          <h2 class="side-title">${icon('chip')}생산 품목</h2>
          <div class="product-grid" data-ui="products" aria-label="생산 품목 선택"></div>
          <p class="product-desc" data-ui="productDesc"></p>
          <a class="product-source" data-ui="source" target="_blank" rel="noopener noreferrer"></a>
        </section>
        <section class="side-flow">
          <div class="side-heading"><h2 class="side-title">${icon('flow')}공정 순서</h2><span class="mono small-count" data-ui="stepCount"></span></div>
          <ol class="process-list" data-ui="steps"></ol>
        </section>
        <section class="side-tracking">
          <div class="side-heading"><h2 class="side-title">${icon('wafer')}웨이퍼 추적</h2><button type="button" class="follow-btn" data-action="follow" aria-label="선택 웨이퍼 따라가기">따라가기</button></div>
          <div class="carrier-switch" data-ui="carriers" aria-label="추적할 운반 용기 선택"></div>
          <div class="material-view" data-ui="material" role="img">
            <div class="profile-layers" aria-hidden="true"><i class="silicon"></i><i class="oxide"></i><i class="resist"></i><i class="mask"></i></div>
            <div class="profile-caption"><span>웨이퍼 단면</span><strong data-ui="materialName"></strong></div>
          </div>
        </section>
        <section class="side-spec">
          <h2 class="side-title">${icon('layers')}라인 사양</h2>
          <dl class="spec-list"><div><dt>생산층</dt><dd>36 × 18 <small>m</small></dd></div><div><dt>웨이퍼</dt><dd>300 <small>mm</small></dd></div><div><dt>천장 운송차 운행 / 가용</dt><dd data-ui="fleet"></dd></div><div><dt>설치 장비 / FOUP 인계점</dt><dd data-ui="counts"></dd></div></dl>
        </section>
      </aside>
      <main class="fab-main">
        <div class="main-heading">
          <div class="main-title"><div><div class="heading-kicker"><span class="heading-rule"></span>FAB OPERATIONS</div><h1>생산라인 모니터</h1></div><div class="monitor-actions"><button type="button" class="metrics-trigger" data-action="metrics" aria-haspopup="dialog">${icon('chart')}지표 확인</button><button type="button" class="metrics-trigger" data-action="experiment" aria-haspopup="dialog">다각화 실험</button></div></div>
          <div class="view-switch" role="group" aria-label="카메라 시점">
            <button type="button" data-camera="entry">입구</button><button type="button" data-camera="iso">등각</button><button type="button" data-camera="top">상면</button><button type="button" data-camera="bottom">하면</button><button type="button" data-camera="floor">현장</button><button type="button" data-camera="services">설비 단면</button><button type="button" data-action="lab" aria-label="웨이퍼 단면 및 식각 비교">웨이퍼 단면</button>
          </div>
        </div>
        <section class="stage-shell" aria-label="3D 생산라인 및 재생">
          <div class="stage-area"><div class="stage-viewport" data-ui="viewport" aria-label="3D 생산라인"></div>
            <div class="stage-corner"><span class="corner-cross"></span><span class="stage-bay">FAB 01</span><span class="corner-divider"></span><span data-ui="stageProduct"></span></div>
            <div class="scene-tools" role="group" aria-label="관찰 도구"><button type="button" data-action="dimensions" title="치수 표시" aria-label="치수 표시">${icon('ruler')}</button><button type="button" data-action="cutaway" title="장비 단면 보기" aria-label="장비 단면 보기">${icon('section')}</button><button type="button" data-action="fit" title="전체 라인 보기" aria-label="전체 라인 보기">${icon('expand')}</button></div>
            <div class="stage-hint">${icon('mouse')} 드래그 회전 <span>·</span> 휠 확대</div>
            <section class="wafer-lab" data-ui="lab" aria-label="웨이퍼 단면 실습" hidden></section>
          </div>
          <div class="transport">
            <button class="play-button" type="button" data-action="toggle" data-ui="play"></button>
            <button class="icon-btn" type="button" data-action="advance" title="다음 동작" aria-label="다음 동작">${icon('next')}</button>
            <button class="icon-btn" type="button" data-action="reset" title="처음부터" aria-label="처음부터">${icon('reset')}</button>
            <div class="transport-progress"><div class="progress-caption"><span data-ui="activity"></span><span class="mono" data-ui="percent"></span></div><div class="progress-track" data-ui="progress" role="progressbar" aria-label="전체 진행률" aria-valuemin="0" aria-valuemax="100"><i data-ui="bar"></i></div></div>
            <div class="speed-wrap"><select data-ui="speed" aria-label="재생 속도"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select>${icon('down')}</div>
          </div>
        </section>
        <div class="details-grid">
          <section class="detail-panel" aria-label="선택 장비 정보"><div class="detail-heading"><h2>${icon('scope')}장비 정보</h2><button type="button" class="gallery-open" data-ui="galleryOpen">장비 도감</button></div><div class="equipment-info" data-ui="equipment"></div></section>
          <section class="detail-panel log-panel" aria-label="시뮬레이션 이벤트"><div class="detail-heading"><h2>${icon('activity')}이벤트 기록</h2><span class="mono small-count" data-ui="logCount"></span></div><ol class="event-list" data-ui="events"></ol></section>
        </div>
      </main>
    </div>`;

  function find<T extends HTMLElement = HTMLElement>(key: string): T {
    return root.querySelector<T>('[data-ui="' + key + '"]')!;
  }
  const viewport = find('viewport');
  const source=find<HTMLAnchorElement>('source'),fleet=find('fleet');
  let openGallery:ReturnType<typeof import('./equipment-gallery')['createEquipmentGallery']>|undefined;
  const galleryButton=find<HTMLButtonElement>('galleryOpen');
  galleryButton.addEventListener('click',async()=>{
    galleryButton.disabled=true;
    try{
      openGallery??=(await import('./equipment-gallery')).createEquipmentGallery(root);
      if(root.isConnected&&!root.hidden)openGallery(galleryButton.value);
    }catch(error){console.error(error);galleryButton.textContent='장비 도감 다시 열기';}
    finally{galleryButton.disabled=false;}
  });
  const updateLab=createWaferLab(find('lab'),onAction);
  const productsEl = find('products'), stepsEl = find('steps'), equipEl = find('equipment'), logEl = find('events');
  const play = find<HTMLButtonElement>('play'), speed = find<HTMLSelectElement>('speed'), light = find('light');
  const activity = find('activity'), percent = find('percent'), progress = find('progress'), bar = find('bar');
  const status = find('status'), stepCount = find('stepCount'), stageProduct = find('stageProduct'), logCount = find('logCount'), timeEl = find('clock');
  const cameraButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-camera]')];
  const cutaway = root.querySelector<HTMLButtonElement>('[data-action="cutaway"]')!;
  const dimensions = root.querySelector<HTMLButtonElement>('[data-action="dimensions"]')!;
  const productDesc = find('productDesc'), carrierSwitch = find('carriers'), material = find('material'), materialName = find('materialName');
  const advance = root.querySelector<HTMLButtonElement>('[data-action="advance"]')!;
  let productSig = '', stepSig = '', equipmentSig = '', logSig = '', carrierSig = '';
  let wasRunning: boolean | undefined;
  function setText(el: HTMLElement, text: string) { if (el.textContent !== text) el.textContent = text; }
  function pressed(el: HTMLElement, value: boolean) {
    const next = String(value);
    if (el.getAttribute('aria-pressed') !== next) el.setAttribute('aria-pressed', next);
  }
  root.addEventListener('click', event => {
    const btn = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!btn || !root.contains(btn) || btn.disabled) return;
    if (btn.dataset.product) onAction({type:'product', id:btn.dataset.product});
    else if (btn.dataset.carrier) onAction({type:'carrier', id:btn.dataset.carrier});
    else if (btn.dataset.station) onAction({type:'station', id:btn.dataset.station});
    else if (btn.dataset.camera) onAction({type:'camera', id:btn.dataset.camera as CameraView});
    else if (btn.dataset.action) onAction({type:btn.dataset.action as 'toggle'|'reset'|'advance'|'fit'|'cutaway'|'dimensions'|'metrics'|'experiment'});
  });
  speed.addEventListener('change', () => onAction({type:'speed', value:Number(speed.value)}));

  function update(v: UIView) {
    setText(find('counts'),v.machineCount+'대 / '+v.portCount+'곳');
    updateLab(v.lab);
    material.style.setProperty('--opening-height',(v.lab.material.opening*7)+'px');
    pressed(root.querySelector<HTMLElement>('[data-action="lab"]')!,v.lab.visible);
    const currentProduct = v.products.find(p => p.id === v.productId);
    const productKey = JSON.stringify(v.products);
    if (productKey !== productSig) {
      productSig = productKey;
      productsEl.innerHTML = v.products.map(p => '<button type="button" data-product="' + escapeText(p.id) + '">' + escapeText(p.name) + '</button>').join('');
    }
    for (const button of productsEl.querySelectorAll<HTMLButtonElement>('button')) pressed(button, button.dataset.product === v.productId);
    const stepKey = JSON.stringify(v.steps);
    if (stepKey !== stepSig) {
      stepSig = stepKey;
      stepsEl.innerHTML = v.steps.map((s,i) => '<li><button type="button" data-station="' + escapeText(s.stationId) + '" title="' + escapeText(s.name + ' 장비 선택') + '"><span class="step-dot">' + twoDigits(i+1) + '</span><span class="step-copy"><strong>' + escapeText(s.name) + '</strong>' + (s.label ? '<small>' + escapeText(s.label) + '</small>' : '') + '</span></button></li>').join('');
    }
    for (let i = 0; i < stepsEl.children.length; i++) {
      const row = stepsEl.children[i];
      row.classList.toggle('current', i === v.activeStep && !v.finished);
      row.classList.toggle('done', i < v.completedSteps);
      row.classList.toggle('inspected', v.steps[i].stationId === v.selectedStationId);
    }
    setText(stepCount, v.completedSteps + ' / ' + v.steps.length);
    setText(stageProduct, currentProduct?.name ?? v.productId);
    setText(productDesc,v.productDescription ?? '');
    if(source.getAttribute('href')!==v.productSource.url){source.href=v.productSource.url;setText(source,v.productSource.label);}
    setText(fleet,v.activeVehicles+' / '+v.fleetCount+' 대');
    const carrierKey=JSON.stringify(v.carriers);
    if (carrierKey !== carrierSig) {
      carrierSig = carrierKey;
      carrierSwitch.innerHTML = (v.carriers ?? []).map(c => '<button type="button" data-carrier="' + escapeText(c.id) + '">' + escapeText(c.name) + '</button>').join('');
    }
    for (const button of carrierSwitch.querySelectorAll<HTMLButtonElement>('button')) pressed(button, button.dataset.carrier === v.carrierId);
    const mat = v.materialStage ?? 'initial';
    if (material.dataset.stage !== mat) {
      const name = mat==='initial'?'실리콘 기판':actionNames[mat];
      material.dataset.stage=mat;
      setText(materialName,name);
      material.setAttribute('aria-label','웨이퍼 확대 단면 · '+name);
    }
    const equipKey = JSON.stringify([v.equipment,v.waferLabel,v.lotLabel]);
    if (equipmentSig !== equipKey) {
      equipmentSig = equipKey;
      galleryButton.value=v.equipment.galleryId??v.equipment.id;
      galleryButton.hidden=!equipmentCatalogById.has(galleryButton.value);
      const e = v.equipment;
      equipEl.innerHTML = '<div class="equip-title"><span class="equip-glyph">' + icon('cube') + '</span><div><h3>' + escapeText(e.name) + '</h3><span>' + escapeText(e.category) + (e.model ? ' · ' + escapeText(e.model) : '') + '</span></div></div><p>' + escapeText(e.description) + '</p><div class="equipment-ids">' + (v.lotLabel ? '<span>' + icon('carrier') + escapeText(v.lotLabel) + '</span>':'') + (v.waferLabel ? '<span>' + icon('wafer') + escapeText(v.waferLabel) + '</span>':'') + '</div>';
    }
    const logs = v.logs.slice().reverse();
    const eventKey = JSON.stringify([v.logs.length,logs]);
    if (logSig !== eventKey) {
      logSig = eventKey;
      setText(logCount, String(v.logs.length));
      logEl.innerHTML = logs.length ? logs.map(e => '<li><time>' + clock(e.time) + '</time><span>' + escapeText(e.text) + '</span></li>').join('') : '<li class="log-wait">첫 이송 대기 중</li>';
    }
    setText(timeEl, clock(v.elapsed,true));
    setText(status, v.running ? '운전 중' : v.finished ? '운전 완료' : v.elapsed > 0 ? '정지' : '운전 대기');
    light.classList.toggle('active',v.running);
    setText(activity, v.stationName + ' · ' + v.activity);
    const pct = Math.round(Math.max(0, Math.min(1, v.progress)) * 100);
    setText(percent, v.cycle+'회차 · '+pct+'%');
    if (progress.getAttribute('aria-valuenow') !== String(pct)) {
      progress.setAttribute('aria-valuenow',String(pct));
      bar.style.width = pct + '%';
    }
    if (wasRunning !== v.running) {
      wasRunning = v.running;
      play.innerHTML = icon(v.running ? 'stop' : 'play') + '<span>' + (v.running ? '정지' : '재생') + '</span>';
    }
    play.setAttribute('aria-label',v.running ? '시뮬레이션 정지' : '시뮬레이션 재생');
    advance.disabled = v.finished;
    speed.value = String(v.speed);
    for (const button of cameraButtons) pressed(button, !v.lab.visible && button.dataset.camera === v.camera);
    pressed(cutaway,v.cutaway);
    pressed(root.querySelector<HTMLButtonElement>('[data-action="follow"]')!,v.following);
    pressed(dimensions,v.dimensions);
  }
  return {viewport, update};
}
