import {equipment} from './equipment';
import {accepts,actionNames,dockOf,footprint,issuesFor,machineCode,machineKinds,machineName,maxFleet,newMachine,nextId,parkedCount,sides,
  type LineLayout,type MachineKind,type RailSide} from './line-layout';
import type {Action,Product,SceneFrame} from './simulation';
import {createFabScene} from './scene';

export function createLineEditor(host:HTMLElement,onApply:(line:LineLayout)=>void){
  const dialog=document.createElement('dialog');dialog.className='line-editor';dialog.setAttribute('aria-labelledby','line-title');
  host.append(dialog);
  const previewHost=document.createElement('div');previewHost.className='edit-preview';
  previewHost.setAttribute('aria-label','라인 배치 3D 미리보기');
  let preview:ReturnType<typeof createFabScene>|undefined,previewKey='';
  let original:LineLayout,draft:LineLayout,product:Product,state:SceneFrame,selected='',kind:MachineKind='etch_strip',action:Action='etch';
  let history:LineLayout[]=[];
  const usage:Record<string,string>={slot:'FOUP 슬롯',atmosphere_robot:'전면 로봇',vacuum_robot:'진공 로봇',track_robot:'트랙 로봇',chamber:'챔버',scanner_stage:'노광 스테이지',load_lock:'로드록'};
  const edit=(change:()=>void)=>{history.push(structuredClone(draft));change();render();};
  const option=(value:string,label:string,active:string)=>`<option value="${value}" ${value===active?'selected':''}>${label}</option>`;
  function updatePreview(){
    const key=JSON.stringify([draft.machines.map(m=>[m.id,m.kind]),draft.steps.map(s=>s.station),draft.rails,parkedCount(draft)]);
    if(key!==previewKey){
      preview?.dispose();preview=undefined;previewKey=key;previewHost.replaceChildren();
      try{preview=createFabScene(previewHost,id=>{if(draft.machines.some(m=>m.id===id)){selected=id;render();}},structuredClone(draft));}
      catch{previewHost.textContent='3D 미리보기를 사용할 수 없습니다. 평면에서 계속 편집할 수 있습니다.';}
    }
    preview?.setDraftPositions(draft.machines);preview?.setSelection(selected);
  }
  function shapeStyle(x:number,z:number,w:number,d:number){return `left:${(x-w/2)/36*100}%;top:${(z-d/2)/18*100}%;width:${w/36*100}%;height:${d/18*100}%`;}
  function render(){
    const selectedMachine=draft.machines.find(m=>m.id===selected);
    const issues=issuesFor(draft,product.id),changed=JSON.stringify(draft)!==JSON.stringify(original);
    const invalid=new Set(issues.map(i=>i.target));
    const names=new Map(draft.machines.map(m=>[m.id,machineName(m)]));
    const originalName=(id:string)=>{const m=original.machines.find(m=>m.id===id);return m?machineCode(m):id;};
    const options=machineKinds.map(k=>option(k,equipment[k].name,kind)).join('');
    function machineDetails(){
      if(!selectedMachine)return '<p>배치할 장비를 추가하거나 평면에서 장비를 선택하세요.</p>';
      const m=selectedMachine,p=dockOf(m);
      return `<strong>${machineName(m)}</strong><div class="coordinate-controls"><label>X (m)<input data-field="x" type="number" step=".5" value="${m.x}"></label>
        <label>Z (m)<input data-field="z" type="number" step=".5" value="${m.z}"></label>
        <label>정면<select data-field="facing">${option('0','0° · 남향',String(m.facing))}${option('180','180° · 북향',String(m.facing))}</select></label></div>
        <p>${m.kind==='scanner'?'웨이퍼 인계 · 인접 트랙의 브리지':'FOUP 포트 · X '+p.x+' / Z '+p.z+' m'}</p>
        <div class="edit-row"><button data-cmd="clone">복제</button><button data-cmd="replace">선택 기종으로 교체</button><button data-cmd="remove">철거</button></div>
        ${issues.filter(i=>i.target===m.id).map(i=>'<p class="field-error">'+i.message+'</p>').join('')}`;
    }
    function map(){
      const shapes=draft.machines.map(m=>{
        const [w,d]=footprint(m.kind),p=dockOf(m);
        const box=shapeStyle(m.x,m.z,w,d);
        return `<button type="button" data-machine="${m.id}" title="${issues.filter(i=>i.target===m.id).map(i=>i.message).join(' ')||machineName(m)}" aria-label="${machineName(m)} 선택" aria-pressed="${m.id===selected}" class="map-machine ${invalid.has(m.id)?'invalid':''}" style="${box}">${machineCode(m)}</button>`+
          (m.kind==='scanner'?'':`<i class="map-port" data-port="${m.id}" title="${machineCode(m)} 인계점" style="left:${p.x/36*100}%;top:${p.z/18*100}%"></i>`);
      }).join('');
      return `<div class="floor-map" aria-label="생산층 배치도">${Object.keys(sides).map(k=>`<i class="map-rail ${k} ${draft.rails[k as RailSide]?'':'invalid'}"></i>`).join('')}${shapes}</div>`;
    }
    const stepRows=draft.steps.map((s,i)=>{
      const candidates=draft.machines.filter(m=>accepts(m.kind,s.action));
      const assigned=candidates.some(m=>m.id===s.station);
      return `<li data-step="${s.id}" class="${invalid.has('step-'+s.id)?'invalid':''}"><span class="step-number">${i+1}</span><div><strong>${s.label}</strong>
      <select data-assign="${i}" aria-label="${i+1}단계 처리 장비">${assigned?'':option('','장비 지정 필요','')}${candidates.map(m=>option(m.id,machineName(m),s.station)).join('')}</select></div>
      <div class="edit-order"><button data-cmd="up" data-index="${i}" aria-label="${i+1}단계 위로" ${i===0?'disabled':''}>↑</button><button data-cmd="down" data-index="${i}" aria-label="${i+1}단계 아래로" ${i===draft.steps.length-1?'disabled':''}>↓</button><button data-cmd="drop" data-index="${i}" aria-label="${i+1}단계 삭제">×</button></div></li>`;
    }).join('');
    const issuesText=issues.map(i=>{
      const s=draft.steps.find(s=>'step-'+s.id===i.target);
      const label=names.get(i.target)??(s?s.label:i.target==='home'?'스토커':i.target in sides?'레일':i.target==='oht'?'OHT':'공정');
      return '<li>'+label+' · '+i.message+'</li>';
    }).join('');
    const reserved=Object.entries(state.equipment).filter(([,v])=>v.status==='reserved').map(([id,v])=>originalName(id)+' / '+v.carrierId);
    const impact=state.time>0?`<div class="edit-impact"><strong>편집을 열었을 때의 운전 상태</strong>
      <p>${state.carriers.map(c=>c.id+' ('+c.wafer.id+' · '+(c.station?originalName(c.station):'OHT')+' / '+usage[c.wafer.owner]+')').join(' · ')}</p>
      <p>당시 예약 ${reserved.join(', ')||'없음'}. 적용하면 배치를 바꾸고 선택한 스토커에서 새 사이클을 시작합니다. 취소하면 기존 라인의 운전이 이어집니다.</p></div>`:'';
    dialog.innerHTML=`<header class="editor-head"><div><h2 id="line-title">라인 편집</h2><p>${product.name} · 생산층 36 × 18 m</p></div><button data-cmd="cancel">취소</button></header>
      <div class="edit-columns"><section><h3>장비 배치 <small>${draft.machines.length}대</small></h3>${map()}
      <p class="map-caption">● FOUP 인계점 · 장비를 끌거나 빈 바닥을 클릭해 옮깁니다.</p>
      <div class="edit-row"><label>장비 기종 <select data-field="kind">${options}</select></label><button data-cmd="add">장비 추가</button></div>
      <div class="machine-fields">${machineDetails()}</div>
      <h3>물류 시설</h3><label>출발·복귀 스토커 <select data-field="home">${draft.machines.some(m=>m.id===draft.home&&m.kind==='stocker')?'':option('','스토커 지정 필요','')}${draft.machines.filter(m=>m.kind==='stocker').map(m=>option(m.id,machineCode(m),draft.home)).join('')}</select></label>
      <div class="rail-fields"><label>OHT 가용 대수 <input data-field="fleet" type="number" min="0" max="${maxFleet}" step="1" value="${parkedCount(draft)}" aria-label="OHT 가용 대수"></label>
      ${Object.entries(sides).map(([k,label])=>`<label><input type="checkbox" data-rail="${k}" ${draft.rails[k as RailSide]?'checked':''}>${label} 레일</label>`).join('')}</div></section>
      <section><h3>3D 배치 미리보기</h3><div data-preview-slot></div><h3>웨이퍼 공정 <small>${draft.steps.length}단계</small></h3><ol class="editor-steps">${stepRows}</ol>
      <div class="edit-row"><select data-field="action" aria-label="추가할 공정">${Object.entries(actionNames).map(([k,label])=>option(k,label,action)).join('')}</select><button data-cmd="append">공정 추가</button></div></section></div>
      <div class="edit-checks" role="status">${issues.length?'<strong>적용 전 수정할 항목</strong><ul>'+issuesText+'</ul>':'배치와 공정 연결을 확인했습니다.'}</div>${impact}
      <footer><button data-cmd="undo" ${history.length?'':'disabled'}>되돌리기</button><button class="apply-line" data-cmd="apply" ${issues.length?'disabled':''}>${changed?'라인 적용':'편집 마치기'}</button></footer>`;
    dialog.querySelector('[data-preview-slot]')!.append(previewHost);
    updatePreview();
  }
  let drag:{pointer:number;machine:string;map:HTMLElement;x:number;z:number;clientX:number;clientY:number;moved:boolean}|undefined;
  dialog.addEventListener('pointerdown',event=>{
    const button=(event.target as HTMLElement).closest<HTMLElement>('[data-machine]');
    if(!button||event.button!==0||drag)return;
    const machine=draft.machines.find(m=>m.id===button.dataset.machine)!;
    const map=button.closest<HTMLElement>('.floor-map')!;
    drag={pointer:event.pointerId,machine:machine.id,map,x:machine.x,z:machine.z,clientX:event.clientX,clientY:event.clientY,moved:false};
    button.setPointerCapture(event.pointerId);
  });
  dialog.addEventListener('pointermove',event=>{
    if(!drag||drag.pointer!==event.pointerId)return;
    const dx=event.clientX-drag.clientX,dz=event.clientY-drag.clientY;
    if(!drag.moved){
      if(Math.hypot(dx,dz)<3)return;
      drag.moved=true;selected=drag.machine;history.push(structuredClone(draft));
    }
    const machine=draft.machines.find(m=>m.id===drag!.machine)!;
    const bounds=drag.map.getBoundingClientRect(),[w,d]=footprint(machine.kind);
    machine.x=Math.max(w/2,Math.min(36-w/2,Math.round((drag.x+dx/bounds.width*36)*10)/10));
    machine.z=Math.max(d/2,Math.min(18-d/2,Math.round((drag.z+dz/bounds.height*18)*10)/10));
    const button=drag.map.querySelector<HTMLElement>('[data-machine="'+machine.id+'"]')!;
    button.style.cssText=shapeStyle(machine.x,machine.z,w,d);
    const p=dockOf(machine),port=drag.map.querySelector<HTMLElement>('[data-port="'+machine.id+'"]');
    if(port){port.style.left=p.x/36*100+'%';port.style.top=p.z/18*100+'%';}
    const invalid=new Set(issuesFor(draft,product.id).map(issue=>issue.target));
    for(const el of drag.map.querySelectorAll<HTMLElement>('[data-machine]')){
      el.classList.toggle('invalid',invalid.has(el.dataset.machine!));
      el.setAttribute('aria-pressed',String(el===button));
    }
    updatePreview();
  });
  function endDrag(event:PointerEvent){
    if(!drag||drag.pointer!==event.pointerId)return;
    const {moved}=drag;drag=undefined;
    if(!moved)return;
    if(event.type==='pointercancel')draft=history.pop()!;
    render();
  }
  dialog.addEventListener('pointerup',endDrag);dialog.addEventListener('pointercancel',endDrag);
  dialog.addEventListener('close',()=>{drag=undefined;preview?.dispose();preview=undefined;previewKey='';});
  dialog.addEventListener('change',event=>{
    const el=event.target as HTMLInputElement|HTMLSelectElement,f=el.dataset.field;
    if(f==='kind'){kind=el.value as MachineKind;return;}
    if(f==='action'){action=el.value as Action;return;}
    const m=draft.machines.find(m=>m.id===selected);
    if(f==='x'||f==='z'){
      const n=(el as HTMLInputElement).valueAsNumber;
      if(!Number.isFinite(n)){render();return;}
      edit(()=>{if(m)m[f]=n;});
    }else if(f==='facing')edit(()=>{if(m)m.facing=Number(el.value) as 0|180;});
    else if(f==='home')edit(()=>{draft.home=el.value;});
    else if(f==='fleet'){
      const count=(el as HTMLInputElement).valueAsNumber;
      if(!Number.isFinite(count)){render();return;}
      edit(()=>{draft.fleetSize=count;draft.oht=count>0;});
    }
    else if(el.dataset.rail)edit(()=>{draft.rails[el.dataset.rail as RailSide]=(el as HTMLInputElement).checked;});
    else if(el.dataset.assign!==undefined)edit(()=>{draft.steps[Number(el.dataset.assign)].station=el.value;});
  });
  dialog.addEventListener('click',event=>{
    const el=event.target as HTMLElement,btn=el.closest<HTMLButtonElement>('button');
    const m=draft.machines.find(m=>m.id===selected);
    if(el.classList.contains('floor-map')&&m){
      const rect=el.getBoundingClientRect();
      edit(()=>{m.x=Math.round((event.clientX-rect.left)/rect.width*72)/2;m.z=Math.round((event.clientY-rect.top)/rect.height*36)/2;});return;
    }
    if(!btn)return;
    if(btn.dataset.machine){selected=btn.dataset.machine;render();return;}
    const cmd=btn.dataset.cmd,i=Number(btn.dataset.index);
    if(cmd==='cancel'){dialog.close();return;}
    if(cmd==='apply'){
      if(issuesFor(draft,product.id).length)return;
      if(JSON.stringify(draft)!==JSON.stringify(original))onApply(draft);
      dialog.close();return;
    }
    if(cmd==='undo'){const last=history.pop();if(last){draft=last;if(!draft.machines.some(m=>m.id===selected))selected=draft.machines[0]?.id??'';render();}return;}
    edit(()=>{
      if(cmd==='clone'||cmd==='add'){
        const next=newMachine(draft,cmd==='clone'&&m?m.kind:kind);draft.machines.push(next);selected=next.id;
      }else if(cmd==='remove'&&m){draft.machines=draft.machines.filter(v=>v.id!==m.id);selected=draft.machines[0]?.id??'';}
      else if(cmd==='replace'&&m){
        const id=nextId(draft,kind);
        if(draft.home===m.id)draft.home=id;
        for(const s of draft.steps)if(s.station===m.id)s.station=id;
        m.kind=kind;m.id=id;selected=id;
      }else if(cmd==='append'){
        let n=1;while(draft.steps.some(s=>s.id==='edit-'+n))n++;
        draft.steps.push({id:'edit-'+n,action,label:actionNames[action],station:draft.machines.find(m=>accepts(m.kind,action))?.id??''});
      }else if(cmd==='drop')draft.steps.splice(i,1);
      else if(cmd==='up'||cmd==='down'){const j=i+(cmd==='up'?-1:1);[draft.steps[i],draft.steps[j]]=[draft.steps[j],draft.steps[i]];}
    });
  });
  return (line:LineLayout,current:Product,frame:SceneFrame,id:string)=>{
    original=line;draft=structuredClone(line);history=[];product=current;state=frame;
    selected=line.machines.some(m=>m.id===id)?id:line.home;kind='etch_strip';action='etch';dialog.showModal();render();
  };
}
