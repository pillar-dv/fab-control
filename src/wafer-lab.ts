import type {Material,EtchCondition} from './simulation';

export type LabResults = Partial<Record<EtchCondition,Material>>;
export interface LabView {
  visible:boolean; wafer:string; location:string; material:Material; stageLabel:string;
  steps:string[]; currentStep:number; targetLabel:string; results:LabResults;
}
export type LabAction = {type:'etch-run';condition:EtchCondition}|{type:'step-seek';index:number}|{type:'etch-rewind'};

function sectionGraphic(m:Material) {
  // Both samples use the same mask and a fixed 42 px per initial film thickness.
  const base=70, scale=42, protectedHeight=m.protected*scale, openingHeight=m.opening*scale;
  const patterned=m.resist==='developed';
  const finish={dielectric:'#74b8ac',metal:'#c99856',optical:'#a58dcc'}[m.surface];
  const layers=m.surface==='dielectric'?Math.max(1,Math.min(8,m.layers)):1;
  let profile='';
  for(let i=0;i<5;i++){
    const x=12+i*44;
    const h=i%2===0?protectedHeight:openingHeight;
    if(m.surface==='optical'){
      const color=['#b07d94','#79ac9a','#8096bf'][i%3];
      profile+=`<rect x="${x}" y="${base-h}" width="44" height="${h}" fill="${color}"/><path d="M${x+2} ${base-h} Q${x+22} ${base-h-25} ${x+42} ${base-h}Z" fill="${finish}"/>`;
    }else for(let layer=0;layer<layers;layer++){
      const thickness=h/layers;
      profile+=`<rect x="${x}" y="${base-(layer+1)*thickness}" width="44" height="${thickness}" fill="${layer%2===0?finish:'#507b79'}"/>`;
    }
    if(m.resist!=='none' && (!patterned||i%2===0)){
      const color=m.resist==='exposed'&&i%2===1?'#ffe3a1':'#d8ae70';
      profile+=`<rect x="${x}" y="${base-h-10}" width="44" height="10" fill="${color}"/>`;
    }
  }
  return `<svg class="lab-section" viewBox="0 0 244 98" role="img" aria-label="개구부 잔량 ${m.opening.toFixed(2)}, 보호 영역 ${m.protected.toFixed(2)}"><path d="M12 28H232" stroke="var(--chart-cursor)" stroke-dasharray="3 4"/><rect x="12" y="70" width="220" height="${m.thinned?8:16}" fill="#76868f"/>${profile}<path d="M78 14V78" stroke="var(--accent)" stroke-dasharray="2 3"/><path d="m74 10 4 5 4-5" fill="var(--accent)"/></svg>`;
}

export function createWaferLab(host:HTMLElement,dispatch:(action:LabAction)=>void) {
  host.innerHTML=`<header class="lab-head"><div><h2>웨이퍼 단면</h2><p data-lab="context"></p></div><label>공정으로 이동 <select data-lab="steps" aria-label="공정으로 이동"></select></label></header>
    <div class="lab-current"><div data-lab="profile"></div><div><strong data-lab="stage"></strong><p class="lab-legend"><i></i><span data-lab="base"></span> <i></i><span data-lab="surface"></span> <i></i>감광막</p><small>점선은 같은 개구부의 측정 위치입니다.</small></div></div>
    <div class="lab-head lab-compare-head"><div><h3>식각 시간 비교</h3><p data-lab="target"></p></div><button type="button" data-lab="rewind">식각 직전으로</button></div>
    <div class="lab-cards"></div><p class="lab-note">잔량은 초기 절연막 두께를 1로 둔 교육용 상대값입니다.</p>`;
  const get=(name:string)=>host.querySelector<HTMLElement>(`[data-lab="${name}"]`)!;
  const select=get('steps') as HTMLSelectElement;
  const names={standard:'기준 시간',short:'짧은 시간'};
  const conditions=['standard','short'] as const;
  for(const key of conditions){
    const card=document.createElement('article');
    card.innerHTML=`<div class="lab-card-title"><strong>${names[key]}</strong><span>${key==='standard'?'100':'50'}%</span></div><div data-result="${key}" class="lab-result"></div><button type="button" data-run="${key}">${names[key]} 실행</button>`;
    host.querySelector('.lab-cards')!.append(card);
    card.querySelector('button')!.onclick=()=>dispatch({type:'etch-run',condition:key});
  }
  get('rewind').onclick=()=>dispatch({type:'etch-rewind'});
  select.onchange=()=>{if(select.value!=='')dispatch({type:'step-seek',index:Number(select.value)});};
  let stepKey='',signature='';
  return (view:LabView)=>{
    host.hidden=!view.visible;
    host.parentElement!.classList.toggle('lab-open',view.visible);
    if(!view.visible)return;
    const key=JSON.stringify(view);
    if(key===signature)return;
    signature=key;
    if(JSON.stringify(view.steps)!==stepKey){
      stepKey=JSON.stringify(view.steps);select.replaceChildren(new Option('공정 선택',''));
      view.steps.forEach((s,i)=>select.add(new Option((i+1)+'. '+s,String(i))));
    }
    select.value=view.currentStep<0?'':String(view.currentStep);
    get('context').textContent=view.wafer+' · '+view.location;
    get('stage').textContent=view.stageLabel;
    get('base').textContent=view.material.thinned?'박형화 기판':view.material.layers>1?'기판·하부층':'실리콘';
    get('surface').textContent={dielectric:'절연막',metal:'금속층',optical:'광학층'}[view.material.surface];
    get('surface').dataset.surface=view.material.surface;
    get('profile').innerHTML=sectionGraphic(view.material);
    get('target').textContent=view.targetLabel?view.targetLabel+' · 동일 웨이퍼, 동일 개구부':'이 라인에는 식각 단계가 없습니다.';
    for(const button of host.querySelectorAll<HTMLButtonElement>('[data-lab="rewind"],[data-run]'))button.disabled=!view.targetLabel;
    for(const condition of conditions){
      const target=host.querySelector<HTMLElement>(`[data-result="${condition}"]`)!;
      const result=view.results[condition];
      target.innerHTML=result?sectionGraphic(result)+`<dl><div><dt>개구부</dt><dd>${Number(result.opening.toFixed(2))}</dd></div><div><dt>보호 영역</dt><dd>${Number(result.protected.toFixed(2))}</dd></div></dl>`:'<p>실행 후 단면과 잔량이 표시됩니다.</p>';
    }
  };
}
