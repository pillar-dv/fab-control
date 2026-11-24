import './style.css';
import './launcher.css';

type Destination='line'|'campus';
interface Mode {activate():void;deactivate():void;dispose():void}
const modes={
  line:{label:'생산라인 모니터',load:async()=> (await import('./line-mode')).mountLine},
  campus:{label:'반도체 캠퍼스',load:async()=> (await import('./campus-mode')).mountCampus},
};
const root=document.querySelector<HTMLElement>('#app')!;
root.innerHTML=`
  <section class="fab-launcher" data-launcher>
    <header class="fab-top"><div class="fab-brand"><span class="fab-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>FAB<span class="brand-slash">/</span>CONTROL</span></div></header>
    <div class="launcher-wrap">
      <h1 tabindex="-1">반도체 공장 시뮬레이터</h1>
      <p>웨이퍼 공정부터 조달·생산·출하가 연결된 캠퍼스까지 살펴보세요.</p>
      <nav class="launcher-modes" aria-label="시뮬레이션 선택">
        <a class="launcher-card" href="#line" data-mode-choice="line">
          <div class="launcher-illustration launcher-line" aria-hidden="true"><div><i></i><i></i><i></i><i></i><i></i></div></div>
          <div class="launcher-card-copy"><div><h2>생산라인 모니터</h2><p>10개 품목의 공정 비교, 장비 배치 편집, 웨이퍼 단면과 OHT 운송 실험</p></div><span aria-hidden="true">↗</span></div>
        </a>
        <a class="launcher-card" href="#campus" data-mode-choice="campus">
          <div class="launcher-illustration launcher-campus" aria-hidden="true"><div><i></i><i></i><i></i><i></i><i></i><i></i></div></div>
          <div class="launcher-card-copy"><div><h2>반도체 캠퍼스</h2><p>생산동과 외부 물류 거점 탐색, 입고·조립·시험·출하 운전과 증설 비교</p></div><span aria-hidden="true">↗</span></div>
        </a>
      </nav>
    </div>
  </section>
  <section class="launcher-loading" data-loader hidden>
    <div><h2 tabindex="-1" data-load-title></h2><p role="status" data-load-status></p><progress aria-label="모드 로딩 중"></progress>
    <div class="loader-actions"><button type="button" data-retry hidden>다시 시도</button><a href="#">처음 화면</a></div></div>
  </section>`;
const launcher=root.querySelector<HTMLElement>('[data-launcher]')!;
const loader=root.querySelector<HTMLElement>('[data-loader]')!;
const title=loader.querySelector<HTMLElement>('[data-load-title]')!;
const status=loader.querySelector<HTMLElement>('[data-load-status]')!;
const progress=loader.querySelector<HTMLProgressElement>('progress')!;
const retry=loader.querySelector<HTMLButtonElement>('[data-retry]')!;
const loaded=new Map<Destination,{element:HTMLElement;mode:Mode}>();
let previous:Destination|undefined,active:Destination|undefined;
let revision=0;
const paint=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));

async function navigate(){
  const request=++revision;
  const hash=location.hash.slice(1);
  const destination=hash==='line'||hash==='campus'?hash:undefined;
  if(active!==undefined&&destination===active)return;
  if(active){
    previous=active;
    const leaving=loaded.get(active)!;
    leaving.mode.deactivate();
    leaving.element.hidden=true;
    active=undefined;
  }
  if(!destination){
    loader.hidden=true;loader.setAttribute('aria-busy','false');launcher.hidden=false;
    if(previous)launcher.querySelector<HTMLElement>(`[data-mode-choice="${previous}"]`)?.focus();
    return;
  }
  launcher.hidden=true;loader.hidden=false;retry.hidden=true;progress.hidden=false;
  loader.setAttribute('aria-busy','true');
  title.textContent=modes[destination].label+' 준비 중';
  status.textContent='선택한 화면과 3D 장면을 불러오는 중입니다.';
  title.focus();
  try{
    let entry=loaded.get(destination);
    if(!entry){
      const mount=await modes[destination].load();
      if(request!==revision)return;
      const element=document.createElement('section');
      element.className='fab-mode';
      element.dataset.route=destination;
      element.hidden=true;
      root.append(element);
      try{
        entry={element,mode:mount(element)};
        loaded.set(destination,entry);
      }catch(error){element.remove();throw error;}
    }
    await paint();
    if(request!==revision)return;
    entry.element.hidden=false;
    entry.mode.activate();
    active=destination;previous=destination;
    loader.hidden=true;loader.setAttribute('aria-busy','false');
    window.scrollTo(0,0);
    entry.element.querySelector<HTMLElement>('[data-mode-home]')?.focus();
  }catch(error){
    if(request!==revision)return;
    const entry=loaded.get(destination);
    entry?.mode.dispose();entry?.element.remove();loaded.delete(destination);
    console.error(error);
    title.textContent='화면을 열지 못했습니다';
    status.textContent='잠시 후 다시 시도하거나 처음 화면에서 다른 모드를 열 수 있습니다.';
    progress.hidden=true;retry.hidden=false;loader.setAttribute('aria-busy','false');retry.focus();
  }
}
window.addEventListener('hashchange',navigate);
retry.addEventListener('click',navigate);
void navigate();
if(import.meta.hot)import.meta.hot.dispose(()=>{
  revision++;
  window.removeEventListener('hashchange',navigate);
  loaded.forEach(entry=>entry.mode.dispose());
});
