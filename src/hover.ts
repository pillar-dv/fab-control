import * as T from 'three';
import {equipment} from './equipment';
import reference from '../fab-model-reference.json';

const {carrier,load_port:port}=reference.published_model_specs;
export const componentInfo = {
  pump:{name:'진공 펌프',category:'서브팹 · 진공 설비',model:'Intel 팹 단면 구조 참조',description:'증착·식각 장비 아래에서 진공 배관을 통해 공정실의 기체를 배기합니다.'},
  ffu:{name:'팬필터 유닛',category:'공조층 · 청정 공기 공급',model:'Intel 팹 단면 구조 참조',description:'상부 덕트에서 공급된 공기를 필터로 걸러 클린룸으로 내려보냅니다.'},
  foup:{name:'웨이퍼 운반 용기',category:'물류 · 운반 용기',model:'Entegris A300 · 25장형',description:'웨이퍼를 슬롯에 수평으로 보관하고, 장비 도킹 후 앞문을 엽니다.'},
  port:{name:'로드포트',category:'지원 설비 · 도킹',model:'TDK TAS300 TYPE J1',description:'운반 용기를 받침에 정렬하고 장비 내부 로봇이 접근할 수 있게 합니다.'},
  efem:{name:'전면 이송 로봇',category:'물류 · 장비 내부',model:'Brooks Marathon 2 구조 참조',description:'대기압 구역에서 웨이퍼 한 장을 꺼내 다음 모듈에 전달합니다.'},
  vacuum:{name:'진공 이송 로봇',category:'물류 · 장비 내부',model:'Brooks Marathon 2 구조 참조',description:'로드록과 진공 공정 챔버 사이에서 웨이퍼를 인계합니다.'},
  trackRobot:{name:'트랙 이송 로봇',category:'물류 · 장비 내부',model:'LITHIUS 트랙 구조 참조',description:'트랙 내부와 노광기 사이에서 웨이퍼를 한 장씩 전달합니다.'},
};
const info:Record<string,(typeof componentInfo)['port']> = {...equipment,...componentInfo};
const mm = (n:number)=>Math.round(n*1000).toLocaleString('ko-KR');
export function createEquipmentHover(host:HTMLElement,scene:T.Scene) {
  const tip=document.createElement('aside');
  tip.className='equipment-tooltip';tip.hidden=true;tip.setAttribute('role','tooltip');
  host.append(tip);
  const bounds=new T.Box3();
  const outline=new T.Box3Helper(bounds, new T.Color('#24599d'));
  outline.visible=false;outline.renderOrder=5;scene.add(outline);
  let previous:T.Object3D|null=null;
  function hide(){previous=null;tip.hidden=true;outline.visible=false;}
  function show(root:T.Object3D,id:string,x:number,y:number) {
    const data=info[id];
    if(!data){hide();return;}
    const changed=previous!==root;
    previous=root;
    root.updateWorldMatrix(true,true);
    bounds.setFromObject(root);
    outline.visible=true;
    if(changed){
      const inverse=root.matrixWorld.clone().invert(),local=new T.Box3();
      root.traverse(child=>{
        if(!(child instanceof T.Mesh))return;
        const shape=child instanceof T.InstancedMesh?child:child.geometry;
        if(!shape.boundingBox)shape.computeBoundingBox();
        if(shape.boundingBox)local.union(shape.boundingBox.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(inverse,child.matrixWorld)));
      });
      const size=local.getSize(new T.Vector3());
      const official=id==='foup'?[carrier.width_m,carrier.depth_m,carrier.height_m]:
        id==='port'?[port.full_width_m,port.depth_from_bolts_plane_m,port.full_height_m]:null;
      tip.replaceChildren();
      function line(tag:string,copy:string){const el=document.createElement(tag);el.textContent=copy;tip.append(el);}
      line('small',data.category);line('strong',data.name);line('em',data.model);line('p',data.description);
      line('small','폭 × 깊이 × 높이');
      line('div','모델 외곽　'+[size.x,size.z,size.y].map(mm).join(' × ')+' mm');
      line('div','제조사 사양　'+(official?official.map(mm).join(' × ')+' mm':'미확인'));
      if(id==='port')line('small','제조사 깊이는 장착 기준면에서의 돌출 길이');
      tip.dataset.equipment=id;
    }
    tip.hidden=false;
    const left=x+14+tip.offsetWidth>host.clientWidth?x-tip.offsetWidth-14:x+14;
    const top=y+14+tip.offsetHeight>host.clientHeight?y-tip.offsetHeight-14:y+14;
    tip.style.left=Math.max(4,Math.min(left,host.clientWidth-tip.offsetWidth-4))+'px';
    tip.style.top=Math.max(4,Math.min(top,host.clientHeight-tip.offsetHeight-4))+'px';
  }
  return {show,hide,dispose(){tip.remove();outline.dispose();scene.remove(outline);}};
}
