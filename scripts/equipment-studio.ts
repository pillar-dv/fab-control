import * as T from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createFabScene, doorOffset } from '../src/scene';
import { FabSimulation, type SceneFrame } from '../src/simulation';
import { equipment } from '../src/equipment';
import { componentInfo } from '../src/hover';
import {additional,categories,legacy,type LegacyId} from './equipment-definitions';
import {referenceEquipmentModel} from './reference-equipment-model';
import reference from '../fab-model-reference.json';

type Source=keyof typeof reference.sources;
const parts:Record<string,keyof typeof componentInfo> = {
  foup:'foup',load_port:'port',efem_robot:'efem',vacuum_robot:'vacuum',track_robot:'trackRobot'
};
const sources:Record<string,Source[]>={
  stocker:['muratec_stocker'],deposition:['nnfc','brooks_m2'],track:['tel_track','scanner_interface'],
  scanner:['asml_nxt1950i','scanner_interface'],etch_strip:['nnfc','brooks_m2'],oht:['muratec_oht','mfsg_oht'],
  foup:['entegris_a300'],load_port:['tdk_tas300_j1'],efem_robot:['brooks_m2'],vacuum_robot:['brooks_m2'],track_robot:['tel_track','scanner_interface']
};
const basis:Record<string,string>={
  foup:'A300 외곽 426 × 355 × 338 mm, 25슬롯, 피치 10 mm. 문 이동 거리는 모델 가정.',
  load_port:'TAS300 J1 폭 472 mm, 높이 1,386 mm, 장착 기준면에서 돌출 493 mm. 받침면 높이 900 mm는 모델 가정.',
  oht:'벨트 승강과 플랜지 파지는 Muratec 사례. 차체 외곽과 승강 스트로크는 모델 가정.',
  etch_strip:'AEO20의 식각 챔버 3개와 제거 챔버 1개를 기준으로 구성. 패널·챔버 배치와 외곽은 모델 가정.',
  scanner:'액침 스캐너와 트랙 사이 웨이퍼 인계를 표현. 브리지 방향과 외곽은 모델 가정.',
  track:'도포·현상 모듈과 노광기 인계를 표현. 모듈 배치와 외곽은 모델 가정.',
  stocker:'보관 랙과 OHT 인계대를 구분. 단수, 패널과 외곽은 모델 가정.',
  deposition:'Producer-SE의 PECVD 역할과 EFEM–로드록–진공 구성을 참조. 패널·조작면과 외곽은 모델 가정.'
};
const references=new Map(additional.map(item=>[item.id,item]));
export const equipmentIds=[...Object.keys(legacy),...references.keys()];
export const catalogCategories=Object.entries(categories).map(([id,[name,description]])=>({id,name,description}));
const views = {
  front:{label:'정면',direction:[0,0,1]},side:{label:'우측면',direction:[1,0,0]},
  rear:{label:'후면',direction:[0,0,-1]},iso:{label:'사시도',direction:[1,.78,1.25]}
};
const simulation=new FabSimulation('baseline');
const fab=createFabScene(document.querySelector<HTMLElement>('#fab')!);
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
const width=720,height=520;
renderer.setSize(width,height,false);
renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.13;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
const studio=new T.Scene();
studio.background=new T.Color('#25323b');
studio.add(new T.HemisphereLight(0xf1f8ff,0x899b9c,2.25));
const keyLight=new T.DirectionalLight(0xfff5df,2.65);keyLight.castShadow=true;
keyLight.shadow.mapSize.set(1024,1024);keyLight.shadow.normalBias=.012;
studio.add(keyLight,keyLight.target);
const fill=new T.DirectionalLight(0xb5dcff,1.8);fill.position.set(-4,3,-3);studio.add(fill);
const floor=new T.Mesh(new T.PlaneGeometry(1,1),new T.ShadowMaterial({opacity:.33,depthWrite:false}));
floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;studio.add(floor);
function modelAt(id:string,time:number){
  simulation.seek(time);fab.update(simulation.snapshot);
  return fab.copyEquipmentModel(id);
}
// Plain mesh nodes keep the files compatible with glTF viewers lacking GPU instancing.
function expandInstances(root:T.Object3D){
  const batches:T.InstancedMesh[]=[];
  root.traverse(o=>{if(o instanceof T.InstancedMesh)batches.push(o);});
  for(const batch of batches){
    const parent=batch.parent!;
    for(let i=0;i<batch.count;i++){
      const mesh=new T.Mesh(batch.geometry,batch.material),matrix=new T.Matrix4();
      batch.getMatrixAt(i,matrix);matrix.premultiply(batch.matrix).decompose(mesh.position,mesh.quaternion,mesh.scale);
      parent.add(mesh);
    }
    parent.remove(batch);batch.dispose();
  }
}
// Sample local transforms from the running baseline for a complete door, hoist or handoff motion.
function movement(id:string) {
  let matches:(s:SceneFrame)=>boolean;
  let nodes:string[];
  if(id==='oht'){matches=s=>s.vehicle.hoistY<s.vehicle.position.y-.49;nodes=['gripper','hoist_belts'];}
  else if(id==='foup'){matches=s=>s.carriers[0].doorOpen>.001;nodes=['front_door'];}
  else if(id.endsWith('_robot')){
    const owner=id==='efem_robot'?'atmosphere_robot':id==='vacuum_robot'?'vacuum_robot':'track_robot';
    const station=id==='track_robot'?'track':'deposition';
    matches=s=>s.carriers[0].station===station&&s.carriers[0].wafer.owner===owner;
    nodes=['upper_arm','forearm','elbow','wafer_fork'];
  }else return [];
  let start=-1,end=-1;const step=.125;
  for(let t=0;t<=simulation.snapshot.duration;t+=step){
    simulation.seek(t);
    if(matches(simulation.snapshot)){if(start<0)start=Math.max(0,t-step);}
    else if(start>=0){end=t;break;}
  }
  if(end<=start)throw new Error('가동 구간 누락 '+id);
  const times:number[]=[],poses=new Map<string,number[]>();
  for(let time=start;time<=end;time+=step){
    const sample=modelAt(id,time);times.push(time-start);
    for(const name of nodes){
      const node=sample.getObjectByName(name)!;
      for(const property of ['position','quaternion','scale'] as const){
        const key=name+'.'+property,values=poses.get(key)??[];
        values.push(...node[property].toArray());poses.set(key,values);
      }
    }
  }
  const tracks:T.KeyframeTrack[]=[];
  for(const [key,values] of poses){
    const size=values.length/times.length;
    if(values.every((n,i)=>Math.abs(n-values[i%size])<1e-6))continue;
    const Track=key.endsWith('.quaternion')?T.QuaternionKeyframeTrack:T.VectorKeyframeTrack;
    tracks.push(new Track(key,times,values));
  }
  if(!tracks.length)throw new Error('정지된 가동부 '+id);
  return [new T.AnimationClip(id+'_cycle',end-start,tracks)];
}
function pngs(model:T.Object3D,bounds:T.Box3,name:string,modelLabel:string,id:string){
  const centre=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3());
  const corners:T.Vector3[]=[];
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])
    for(const z of [bounds.min.z,bounds.max.z])corners.push(new T.Vector3(x,y,z));
  const camera=new T.OrthographicCamera(-1,1,1,-1,.005,200);
  function aim(direction:number[]){
    camera.position.fromArray(direction).normalize().multiplyScalar(size.length()*2+1).add(centre);
    camera.lookAt(centre);camera.updateMatrixWorld();
  }
  let span=0;
  for(const {direction} of Object.values(views)){
    aim(direction);
    for(const point of corners){
      const p=point.clone().applyMatrix4(camera.matrixWorldInverse);
      span=Math.max(span,Math.abs(p.y)*2/.72,Math.abs(p.x)*2*height/width/.89);
    }
  }
  camera.top=span/2;camera.bottom=-camera.top;camera.right=camera.top*width/height;camera.left=-camera.right;
  camera.updateProjectionMatrix();
  const radius=Math.max(.5,size.length());
  keyLight.target.position.copy(centre);
  keyLight.position.copy(centre).add(new T.Vector3(.7,1,.8).multiplyScalar(radius*1.65));
  Object.assign(keyLight.shadow.camera,{left:-radius,right:radius,top:radius,bottom:-radius,far:radius*5});
  keyLight.shadow.camera.updateProjectionMatrix();
  floor.position.set(centre.x,bounds.min.y-.008,centre.z);floor.scale.setScalar(radius*4);
  model.traverse(o=>{if(o instanceof T.Mesh){o.castShadow=true;o.receiveShadow=true;}});
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
  const images:Record<string,string>={},webp:Record<string,string>={};studio.add(model);
  for(const [view,{label,direction}] of Object.entries(views)){
    aim(direction);renderer.render(studio,camera);ctx.drawImage(renderer.domElement,0,0);
    const pixels=ctx.getImageData(0,0,width,height).data;
    let occupied=0;
    for(let i=0;i<pixels.length;i+=4){
      if(Math.abs(pixels[i]-pixels[0])>12||Math.abs(pixels[i+1]-pixels[1])>12||Math.abs(pixels[i+2]-pixels[2])>12)occupied++;
    }
    if(occupied<600)throw new Error('빈 장비 이미지 '+id+'/'+view);
    ctx.fillStyle='#e1eeeb';ctx.font='600 21px sans-serif';ctx.textAlign='left';ctx.fillText(modelLabel,24,35,570);
    ctx.fillStyle='#a9c2c0';ctx.font='14px sans-serif';ctx.fillText(name,24,58,550);
    ctx.fillStyle='#acccc7';ctx.font='15px sans-serif';ctx.textAlign='right';ctx.fillText(label,width-24,34);
    const metres=[.01,.02,.05,.1,.2,.5,1,2,5,10].filter(m=>m<=span*.23).at(-1)??.01;
    const length=metres*height/span,x=24,y=height-22;
    ctx.strokeStyle='#bad5cf';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,y-5);ctx.lineTo(x,y);ctx.lineTo(x+length,y);ctx.lineTo(x+length,y-5);ctx.stroke();
    ctx.textAlign='left';ctx.fillText(metres<1?Math.round(metres*1000)+' mm':metres+' m',x,y-10);
    images[view]=canvas.toDataURL('image/png').split(',')[1];
    webp[view]=canvas.toDataURL('image/webp',.9).split(',')[1];
  }
  studio.remove(model);
  return {images,webp,span};
}
export async function generate(id:string){
  const item=references.get(id);
  const old=legacy[id as LegacyId];
  if(!item&&!old)throw new Error('도감에 등록되지 않은 장비 '+id);
  const clips=item?[]:movement(id);
  const original=item?referenceEquipmentModel(item):modelAt(id,0);
  expandInstances(original);
  const encoded=await new GLTFExporter().parseAsync(original,{binary:true,animations:clips}) as ArrayBuffer;
  const decoded=await new GLTFLoader().parseAsync(encoded,'');
  const bounds=new T.Box3().setFromObject(decoded.scene,true);
  const originalBounds=new T.Box3().setFromObject(original,true);
  if(bounds.isEmpty()||bounds.min.distanceTo(originalBounds.min)>.0001||bounds.max.distanceTo(originalBounds.max)>.0001||decoded.animations.length!==clips.length)
    throw new Error('GLB 재수입 결과 불일치 '+id);
  const info=item??equipment[id]??componentInfo[parts[id]];
  const categoryId=item?.category??old[0],folder=categoryId+'/'+(item?.id??old[1]);
  const maker=item?.maker??old[2],model=item?.model??old[3];
  const {images,webp,span}=pngs(decoded.scene,bounds,info.name,maker+' · '+model,id);
  const size=bounds.getSize(new T.Vector3());
  const dimensionBasis=item?'공개 기능을 참고한 개념 모델의 외곽입니다. 설치 치수, 패널 배치와 정비 공간은 모델 가정입니다.'
    :basis[id]??'대기·진공·트랙 이송 역할을 참조. 팔 길이, 베이스와 궤적은 모델 가정.';
  const metadata={id,name:info.name,categoryId,category:categories[categoryId][0],manufacturer:maker,modelName:model,
    referenceModel:maker+' · '+model,description:info.description,mode:item?'reference':'simulation',
    published:item?.published??(id==='foup'?'제조사 사양 폭 426 × 깊이 355 × 높이 338 mm, 25장형'
      :id==='load_port'?'제조사 사양 폭 472 mm, 돌출 깊이 493 mm, 높이 1,386 mm':id==='etch_strip'?'NNFC AEO20 식각 3실·제거 1실':'공개 장비 역할과 시스템 구조를 참조'),
    dimensionsM:[size.x,size.z,size.y].map(n=>Number(n.toFixed(5))),dimensionBasis,
    sources:item?[item.source]:sources[id].map(key=>reference.sources[key]),orthographicHeightM:span,
    model:folder+'/models/'+id+'.glb',images:Object.fromEntries(Object.keys(views).map(v=>[v,folder+'/images/'+v+'.png'])),
    animations:clips.map(c=>({name:c.name,seconds:c.duration}))};
  const base64=await new Promise<string>(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(new Blob([encoded]));});
  decoded.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const mat of [o.material].flat()){mat.map?.dispose();mat.dispose();}}});
  if(item){
    const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>();
    original.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);for(const mat of [o.material].flat())materials.add(mat);}});
    geometries.forEach(g=>g.dispose());
    materials.forEach(mat=>{if(mat instanceof T.MeshBasicMaterial)mat.map?.dispose();mat.dispose();});
  }
  return {base64,images,webp,metadata};
}

// Test the docking interfaces in the exported local frame, including the south-facing etch cell.
export function verifyInterfaces(){
  const layout=reference.project_assumptions,pod=modelAt('foup',0),port=modelAt('load_port',0);
  expandInstances(port);expandInstances(pod);
  const boxOf=(o:T.Object3D)=>new T.Box3().setFromObject(o,true);
  const bounds=boxOf(pod),size=bounds.getSize(new T.Vector3()),spec=reference.published_model_specs.carrier;
  if(size.distanceTo(new T.Vector3(spec.width_m,spec.height_m,spec.depth_m))>.0001)throw new Error('FOUP 외곽 치수');
  pod.rotation.y=Math.PI;pod.position.y=.9;pod.updateMatrixWorld(true);
  const door=pod.getObjectByName('front_door')!,obstacles:T.Box3[]=[];
  port.traverse(o=>{if(o instanceof T.Mesh)obstacles.push(boxOf(o));});
  const doorSamples=101;
  for(let i=0;i<doorSamples;i++){
    door.position.set(...doorOffset(i/(doorSamples-1)));pod.updateMatrixWorld(true);
    const envelope=boxOf(door);
    if(obstacles.some(b=>b.intersectsBox(envelope)))throw new Error('로드포트와 FOUP 문 간섭 '+i);
  }
  const landings:string[]=[];
  for(const {id,stop_xz_m:[x,z]} of layout.stations){
    const body=modelAt(id,0);expandInstances(body);body.updateMatrixWorld(true);
    const zone=layout.reserved_zones.find(item=>item.id===id)!;
    const [w,d]=zone.reserved_width_depth_m, [ox,oz]=zone.nw_corner_xz_m,sign=id==='etch_strip'?-1:1;
    const cx=(x-ox-w/2)*sign,cz=(z-oz-d/2)*sign;
    const sweep=new T.Box3(new T.Vector3(cx-size.x/2,.9001,cz-size.z/2),new T.Vector3(cx+size.x/2,layout.rail.elevation_y_m-.82+size.y,cz+size.z/2));
    if(cz<=0)throw new Error('장비 전면 인계 방향 '+id);
    body.traverse(o=>{
      if(o instanceof T.Mesh&&o.parent?.name!=='locating_pins'&&boxOf(o).intersectsBox(sweep))
        throw new Error('수직 인계 공간 간섭 '+id+' '+o.name);
    });
    landings.push(id);
  }
  const checked=new Set<string>();let checks=0,maxForkErrorM=0;
  for(let t=0;t<=simulation.snapshot.duration;t+=.25){
    simulation.seek(t);const frame=simulation.snapshot;
    for(const carrier of frame.carriers){
      const {wafer,station}=carrier;
      if(!station||!['atmosphere_robot','vacuum_robot','track_robot'].includes(wafer.owner))continue;
      fab.update(frame);
      const machine=fab.copyEquipmentModel(station);
      const kind=wafer.owner==='atmosphere_robot'?'efem':wafer.owner==='vacuum_robot'?'vacuum':'trackRobot';
      const fork=machine.getObjectByName(kind)!.getObjectByName('wafer_fork')!;
      const zone=layout.reserved_zones.find(item=>item.id===station)!;
      const [w,d]=zone.reserved_width_depth_m, [x,z]=zone.nw_corner_xz_m,sign=station==='etch_strip'?-1:1;
      const target=new T.Vector3((wafer.position.x-x-w/2)*sign,wafer.position.y-.009,(wafer.position.z-z-d/2)*sign);
      const error=fork.getWorldPosition(new T.Vector3()).distanceTo(target);
      maxForkErrorM=Math.max(maxForkErrorM,error);checked.add(station+'/'+kind);checks++;
    }
  }
  if(checked.size!==5||maxForkErrorM>.0001||!Number.isFinite(maxForkErrorM))throw new Error('이송 포크/웨이퍼 인계 불일치');
  return {doorSamples,landings,robotHandoffs:[...checked],forkPoseSamples:checks,maxForkErrorM:Number(maxForkErrorM.toFixed(7))};
}
