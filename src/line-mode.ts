import { createFabScene } from './scene';
import { createUI, type UIAction, type UIView } from './ui';
import { FabSimulation, PRODUCTS, type ProductId, type EtchCondition, type WaferOwner } from './simulation';
import type { LabResults } from './wafer-lab';
import { equipment } from './equipment';
import {defaultLine,machineName,parkedCount,type LineLayout} from './line-layout';
import {createLineEditor} from './line-editor';
import {createMetricsPanel} from './metrics-panel';

export function mountLine(root:HTMLElement){
  const lines=new Map<ProductId,LineLayout>();
  let line=defaultLine(PRODUCTS.baseline.steps);
  let simulation = new FabSimulation('baseline',line);
  const ui = createUI(root, handleAction);
  const metricsPanel=createMetricsPanel(root,()=>({
    product:PRODUCTS[simulation.snapshot.productId].name,timeline:simulation.metricsTimeline,
    stations:line.machines.map(machine=>({id:machine.id,name:machineName(machine)})),
  }));
  let experimentPanel:ReturnType<typeof import('./experiment-panel')['createExperimentPanel']>|undefined;
  let experimentLoading=false;
  async function openExperiment(){
    if(experimentLoading)return;
    experimentLoading=true;
    try{
      experimentPanel??=(await import('./experiment-panel')).createExperimentPanel(root,()=>parkedCount(line));
      if(root.isConnected&&!root.hidden)experimentPanel.open();
    }catch(error){
      console.error(error);
      const button=root.querySelector('[data-action="experiment"]');
      if(button)button.textContent='다각화 실험 다시 열기';
    }finally{experimentLoading=false;}
  }
  let scene: ReturnType<typeof createFabScene> | undefined;
  let running = true;
  let speed = 1;
  let camera: UIView['camera'] = 'iso';
  let cutaway = false;
  let dimensions = false;
  let following = false;
  let selectedStation = 'deposition';
  let carrierIndex = 0;
  let labVisible=false;
  let etchRun:{end:number;key:string;condition:EtchCondition}|null=null;
  const comparisons=new Map<string,LabResults>();
  const openEditor=createLineEditor(root,next=>{
    const id=simulation.snapshot.productId;
    lines.set(id,next);reset(id,true);draw();
  });
  function info(id:string){
    const machine=line.machines.find(m=>m.id===id);
    if(/^oht-\d+$/.test(id))return {...equipment.oht,name:'OHT-'+id.split('-')[1].padStart(2,'0')+' · 천장 운송차'};
    return machine?{...equipment[machine.kind],name:machineName(machine)}:equipment[id];
  }
  const locations:Record<WaferOwner,string>={slot:'FOUP 슬롯',atmosphere_robot:'대기 이송 로봇',load_lock:'로드록',vacuum_robot:'진공 이송 로봇',chamber:'공정 챔버',track_robot:'트랙 이송 로봇',scanner_stage:'노광 스테이지'};
  function etchTarget(state=simulation.snapshot) {
    const steps=line.steps;
    const count=state.carriers[carrierIndex].completedSteps;
    let index=steps.findIndex(s=>s.action==='etch');
    for(let i=0;i<count;i++){
      if(steps[i].action==='deposit'){
        const next=steps.findIndex((s,j)=>j>i&&s.action==='etch');
        if(next>=0)index=next;
      }
    }
    return {index,key:[state.productId,state.cycle,carrierIndex,index].join('/')};
  }
  function moveTime(target:number) {
    simulation.seek(etchRun?Math.min(etchRun.end,target):target);
    if(etchRun && target>=etchRun.end){
      const result=simulation.snapshot.carriers[carrierIndex].wafer.material;
      const pair=comparisons.get(etchRun.key)??{};
      pair[etchRun.condition]={...result};comparisons.set(etchRun.key,pair);
      etchRun=null;running=false;
    }
  }
  let lastFrame: number | undefined;
  let lastPanelUpdate = 0;
  let request = 0;

  function attachScene(){
    ui.viewport.querySelector('.scene-notice')?.remove();
    try {
      scene = createFabScene(ui.viewport, id => selectStation(id, false),line);
      scene.setView(camera);scene.setCutaway(cutaway);scene.setDimensions(dimensions);
      scene.setProduct(PRODUCTS[simulation.snapshot.productId].name);
      scene.setSelection(selectedStation);
    } catch (error) {
      console.error('3D 장면 초기화 실패', error);
      const notice = document.createElement('p');
      notice.setAttribute('role', 'alert');
      notice.className = 'scene-notice';
      notice.textContent = '3D 보기를 시작하려면 WebGL 2가 필요합니다. 브라우저의 그래픽 가속을 확인한 뒤 다시 시도해 주세요.';
      ui.viewport.append(notice);
    }
  }

  function draw(updatePanels = true) {
    const state = simulation.snapshot;
    const product = PRODUCTS[state.productId];
    const carrier = state.carriers[carrierIndex];
    scene?.update(state, carrier.id, following);
    if (!updatePanels) return;
    const previousStep = line.steps[carrier.completedSteps - 1];
    const materialStage = previousStep?.action ?? (carrier.wafer.material.layers > 0 ? 'deposit' : 'initial');
    const currentStep = carrier.activeStepIndex === null ? undefined : line.steps[carrier.activeStepIndex];
    const stationId = currentStep?.station ?? carrier.station;
    const stationName=stationId?info(stationId).name:state.vehicles.find(v=>v.carrierId===carrier.id)?.id??'천장 운송차';
    const target=etchTarget(state);
    const view: UIView = {
      machineCount:line.machines.length,portCount:line.machines.filter(m=>m.kind!=='scanner').length,
      fleetCount:state.vehicles.length,activeVehicles:state.vehicles.filter(v=>v.busy).length,cycle:state.cycle,
      lab:{visible:labVisible,wafer:`${carrier.wafer.id} · ${carrier.id}`,location:stationName+' / '+locations[carrier.wafer.owner],
        material:carrier.wafer.material,stageLabel:carrier.phase,steps:line.steps.map(s=>s.label),
        currentStep:carrier.activeStepIndex??-1,targetLabel:line.steps[target.index]?.label??'',results:comparisons.get(target.key)??{}},
      productId: state.productId,
      products: Object.values(PRODUCTS).map(p => ({id: p.id, name: p.name})),
      productDescription: product.description,
      productSource:{url:product.source,label:product.sourceLabel},
      steps: line.steps.map(step => ({ name: step.label, stationId: step.station, label: info(step.station).name })),
      activeStep: carrier.activeStepIndex ?? -1,
      completedSteps: carrier.completedSteps,
      running, finished: state.finished, elapsed: simulation.totalTime, speed,
      progress: state.duration ? state.time / state.duration : 0,
      activity: carrier.phase,
      stationName,
      selectedStationId: selectedStation,
      equipment: info(selectedStation),
      logs: state.events.map(event => ({time: event.time, text: `${event.carrierId} · ${event.label}`+(event.kind==='process'?' · '+info(event.station).name:'' )})),
      camera, cutaway, dimensions, following, materialStage,
      carrierId: carrier.id,
      carriers: state.carriers.map(c => ({id:c.id, name:c.id})),
      lotLabel: carrier.id,
      waferLabel: `${carrier.wafer.id} · 슬롯 ${carrier.wafer.slot}`,
    };
    ui.update(view);
    metricsPanel.refresh();
  }

  function selectStation(id: string, focus: boolean) {
    if (!info(id)) return;
    selectedStation = id;
    following = false;
    labVisible=false;
    scene?.setSelection(id);
    if (focus) scene?.focus(id);
    draw();
  }

  function reset(id: ProductId,rebuild=false) {
    lastFrame = undefined;
    carrierIndex = 0;
    if (following) { camera = 'iso'; scene?.setView(camera); }
    following = false;
    etchRun=null;comparisons.clear();
    const next=lines.get(id)??defaultLine(PRODUCTS[id].steps);
    const switched=id!==simulation.snapshot.productId;
    if(switched)metricsPanel.archive();
    if(rebuild||switched){
      simulation=new FabSimulation(id,next);line=next;
      if(scene){
        scene.dispose();scene=createFabScene(ui.viewport,id=>selectStation(id,false),line);
        scene.setView(camera);scene.setCutaway(cutaway);scene.setDimensions(dimensions);
      }
      if(!line.machines.some(m=>m.id===selectedStation))selectedStation=line.home;
      scene?.setSelection(selectedStation);
    }else simulation.reset();
    metricsPanel.reset();
    scene?.setProduct(PRODUCTS[id].name);
  }

  function handleAction(action: UIAction) {
    switch (action.type) {
      case 'edit': {
        const state=simulation.snapshot;
        openEditor(line,PRODUCTS[state.productId],state,selectedStation);return;
      }
      case 'metrics': metricsPanel.open(); return;
      case 'experiment': void openExperiment(); return;
      case 'lab': labVisible=!labVisible; break;
      case 'step-seek': {
        running=false;etchRun=null;
        simulation.seek(simulation.stepInterval(carrierIndex,action.index).start);
        break;
      }
      case 'etch-rewind': {
        if(etchTarget().index<0)break;
        running=false;etchRun=null;
        simulation.seek(simulation.stepInterval(carrierIndex,etchTarget().index).start);
        break;
      }
      case 'etch-run': {
        const target=etchTarget();
        if(target.index<0)break;
        const interval=simulation.startEtch(carrierIndex,target.index,action.condition);
        etchRun={end:interval.end,key:target.key,condition:action.condition};
        running=true;lastFrame=undefined;
        break;
      }
      case 'product':
        if (Object.hasOwn(PRODUCTS, action.id) && action.id !== simulation.snapshot.productId) reset(action.id as ProductId);
        break;
      case 'toggle':
        running = !running;
        lastFrame = undefined;
        break;
      case 'reset': reset(simulation.snapshot.productId); break;
      case 'advance':
        running = false;
        moveTime(simulation.nextEventTime());
        break;
      case 'speed': speed = action.value; break;
      case 'station': selectStation(action.id, true); return;
      case 'camera':
        labVisible=false;camera=action.id;
        if(camera==='entry'||camera==='floor'||camera==='services')following=false;
        if(camera==='bottom'){cutaway=true;scene?.setCutaway(true);}
        scene?.setView(camera);
        break;
      case 'fit': labVisible=false; following = false; camera = 'iso'; scene?.setView(camera); break;
      case 'cutaway': cutaway = !cutaway; scene?.setCutaway(cutaway); break;
      case 'dimensions': dimensions = !dimensions; scene?.setDimensions(dimensions); break;
      case 'follow':
        labVisible=false;
        following = !following;
        if (following) {
          if(camera==='entry'||camera==='floor'||camera==='services'){camera='iso';scene?.setView(camera);}
          cutaway = true; scene?.setCutaway(true);
        }
        break;
      case 'carrier': {
        const index = simulation.snapshot.carriers.findIndex(c => c.id === action.id);
        if (index >= 0 && index!==carrierIndex) {if(etchRun)running=false;etchRun=null;carrierIndex = index;}
        break;
      }
    }
    draw();
  }

  function animate(now: number) {
    if (running) {
      if (lastFrame !== undefined) {
        const seconds=(now-lastFrame)*speed/1000;
        if(etchRun)moveTime(simulation.time+seconds);
        else simulation.advanceContinuous(seconds);
      }
      const refresh = !running || now - lastPanelUpdate >= 140;
      if(!experimentPanel?.isOpen())draw(refresh);
      if (refresh) lastPanelUpdate = now;
    }
    lastFrame = now;
    request = requestAnimationFrame(animate);
  }

  const resetFrame=()=>{lastFrame=undefined;};
  function activate(){
    if(request)return;
    document.addEventListener('visibilitychange',resetFrame);
    resetFrame();attachScene();draw();
    request=requestAnimationFrame(animate);
  }
  function deactivate(){
    root.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog=>dialog.close());
    cancelAnimationFrame(request);request=0;resetFrame();
    document.removeEventListener('visibilitychange',resetFrame);
    scene?.dispose();scene=undefined;
  }
  return {activate,deactivate,dispose(){
    deactivate();metricsPanel.dispose();experimentPanel?.dispose();
  }};
}
