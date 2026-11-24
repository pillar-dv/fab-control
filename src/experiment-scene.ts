import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import type {ChamberActivity,ExperimentResult} from './fab-experiment';
import {hubs,type RailEdge,type RailPoint} from './experiment-rail';
import type {FabFloor} from './campus-layout';
import {campusToolSize,scannerOffset,sectionName,type CampusFabFloor,type CampusFabLine,type FabSections} from './campus-fab-layout';
import {kindFor,machineCode} from './line-layout';
import {fabEquipmentModel} from './equipment-catalog';
import {intervalIndex,upperBound} from './timeline-index';

const steel=0x233f65, amber=0xd9861f, mint=0x279675, faultRed=0xbc3d4b;
const lotColors=[0x83a333,0x8064bf];
const floorY=.1,railY=3.05;

export function createExperimentScene(host:HTMLElement,detailedAssets=false) {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  const nativeScale=Math.min(devicePixelRatio,1.5);
  let renderScale=nativeScale,frameAverage=0,frameSamples=0,lastMeasuredAt=0,lastMeasuredTime=-Infinity,nextScaleCheck=0;
  renderer.setPixelRatio(nativeScale);
  if(detailedAssets){
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.16;
  }
  renderer.domElement.setAttribute('role','img');
  renderer.domElement.setAttribute('aria-label',(detailedAssets?'팹 생산층 장비와 OHT':'OHT 실험 생산층')+' 3D 도면. 드래그로 시점을 바꾸고 휠로 확대합니다.');
  host.append(renderer.domElement);
  const scene=new THREE.Scene();
  scene.background=new THREE.Color(0xe6eef7);
  scene.add(new THREE.HemisphereLight(0xe9f3ff,0x516888,2.8));
  const sunlight=new THREE.DirectionalLight(0xf3fff7,3);
  sunlight.position.set(-7,18,12);
  scene.add(sunlight);
  const camera=new THREE.PerspectiveCamera(37,1,.1,280);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.minDistance=detailedAssets?4.5:9;
  controls.maxDistance=detailedAssets?185:84;
  controls.maxPolarAngle=Math.PI/2-.06;
  controls.addEventListener('change',()=>render());
  const geometry=new THREE.BoxGeometry(1,1,1);
  const waferGeometry=new THREE.CylinderGeometry(.54,.54,.034,28);
  const spoolGeometry=new THREE.CylinderGeometry(.5,.5,1,24);
  const ringGeometry=new THREE.TorusGeometry(.455,.045,8,24);
  const models=detailedAssets?import('./equipment-models').then(({createEquipmentModels})=>createEquipmentModels(true)).catch(()=>undefined):undefined;
  const mountedModels=new Set<string>();
  const materials=new Map<number,THREE.MeshStandardMaterial>();
  const railGhost=new THREE.MeshStandardMaterial({color:0x6885a2,transparent:true,opacity:.19,depthWrite:false});
  const upperDeck=new THREE.MeshStandardMaterial({color:0xa5b6c9,transparent:true,opacity:.23,depthWrite:false});
  const batchMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.8});
  const batchGhost=new THREE.MeshStandardMaterial({color:0xffffff,transparent:true,opacity:.19,depthWrite:false});
  function material(color:number){
    let value=materials.get(color);
    if(!value){value=new THREE.MeshStandardMaterial({color,roughness:.8});materials.set(color,value);}
    return value;
  }
  function box(w:number,h:number,d:number,color:number){
    const mesh=new THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>(geometry,material(color));
    mesh.scale.set(w,h,d);
    return mesh;
  }
  function view(top=false){
    const layout=level==='process'?active?.campusFloor:undefined;
    if(layout&&top){
      const halfAngle=THREE.MathUtils.degToRad(camera.fov/2);
      const distance=Math.max(layout.depth,layout.width/camera.aspect)*.585/Math.tan(halfAngle);
      camera.position.set(0,distance,.025);
    }else if(layout)camera.position.set(36,62,63);
    else if(level==='chambers')camera.position.set(top?.03:8,top?18:9,top?.03:9);
    else if(active){
      const angle=THREE.MathUtils.degToRad(camera.fov/2);
      const scale=Math.max(1,experimentWidth/35,experimentDepth/27);
      const distance=Math.max(experimentDepth,experimentWidth/camera.aspect)*.59/Math.tan(angle);
      camera.position.set(top?.06:26*scale,top?distance:29*scale,top?.08:26*scale);
    }else camera.position.set(top?.06:26,top?46:29,top?.08:26);
    controls.target.set(0,level==='chambers'?.5:0,0);
    controls.update();
  }
  function render(){
    const {clientWidth:width,clientHeight:height}=host;
    if(!width||!height)return;
    for(const entry of detailLevels){
      const radius=renderScale<.75?56:72;
      const detailed=entry.station===focusedTool||camera.position.distanceToSquared(entry.position)<radius**2;
      entry.near.visible=detailed;entry.far.visible=!detailed;
      entry.showFar=!detailed&&(stationViews.get(entry.station)?.visible??false)&&(!focusedLine||entry.section===focusedLine);
    }
    for(const {mesh,members} of overviewBatches){
      let visible=false;
      for(const [index,member] of members.entries()){
        visible||=member.level.showFar;
        if(member.shown===member.level.showFar)continue;
        member.shown=member.level.showFar;
        mesh.setMatrixAt(index,member.shown?member.matrix:hiddenInstance);
        mesh.instanceMatrix.needsUpdate=true;
      }
      mesh.visible=visible;
    }
    renderer.render(scene,camera);
    const calls=String(renderer.info.render.calls);
    if(renderer.domElement.dataset.drawCalls!==calls)renderer.domElement.dataset.drawCalls=calls;
    const placed:{x:number;y:number}[]=[];
    for(const {node,position,section,detail} of lineLabels){
      projection.copy(typeof position==='function'?position():position).project(camera);
      const x=(projection.x+1)*width/2,y=(1-projection.y)*height/2;
      node.hidden=level!=='process'||!!focusedTool||width<540||Math.abs(projection.x)>.94||
        Math.abs(projection.y)>.94||projection.z>1;
      node.hidden||=detail?focusedLine!==section:focusedLine!==undefined;
      if(!node.hidden&&detail){
        node.hidden=placed.some(item=>Math.abs(item.x-x)<45&&Math.abs(item.y-y)<16);
        if(!node.hidden)placed.push({x,y});
      }
      node.style.transform=`translate(${x}px,${y}px) translate(-50%, -50%)`;
    }
  }
  function fit(){
    const {clientWidth:width,clientHeight:height}=host;
    if(!width||!height)return;
    camera.aspect=width/height;
    camera.fov=camera.aspect<1.35?49:37;
    camera.updateProjectionMatrix();
    renderer.setSize(width,height,false);
    render();
  }
  function adjustRenderScale(time:number){
    if(!active?.campusFloor||!detailedAssets||time===lastMeasuredTime)return;
    const now=performance.now(),frameMs=now-lastMeasuredAt;
    lastMeasuredAt=now;lastMeasuredTime=time;
    if(frameMs<4||frameMs>300)return;
    frameAverage=frameSamples===0?frameMs:frameAverage*.88+frameMs*.12;
    if(++frameSamples<12||now<nextScaleCheck)return;
    const scale=frameAverage>34?Math.max(.6,renderScale-.15):frameAverage<20?Math.min(nativeScale,renderScale+.1):renderScale;
    nextScaleCheck=now+2200;
    if(Math.abs(scale-renderScale)<.01)return;
    renderScale=scale;frameSamples=0;
    renderer.setPixelRatio(scale);
    renderer.domElement.dataset.renderScale=scale.toFixed(2);
  }
  const model=new THREE.Group();
  const buildingDeck=new THREE.Group();
  const lineGroups=new Map<string,THREE.Group>();
  const deckDetails:THREE.InstancedMesh[]=[];
  const detail=new THREE.Group();
  detail.visible=false;scene.add(model,detail);
  let active:ExperimentResult|undefined;
  let experimentWidth=35,experimentDepth=27;
  let level:FabFloor|'chambers'='process';
  const observer=new ResizeObserver(fit);
  observer.observe(host);
  interface VehicleView {node:THREE.Group;fallback:THREE.Mesh;hoist?:THREE.Mesh;gripper?:THREE.Object3D;gripperY?:number;scale?:number}
  let vehicles:VehicleView[]=[];
  let pods:THREE.Group[]=[];
  const toolLights=new Map<string,THREE.Mesh>();
  const railViews:{mesh:THREE.Mesh;color:number;fault:boolean;block?:string;batch?:THREE.InstancedMesh;index?:number;shown?:number}[]=[];
  const railBatches:THREE.InstancedMesh[]=[];
  interface DetailLevel {station:string;section?:FabSections;position:THREE.Vector3;near:THREE.Object3D;far:THREE.Object3D;showFar:boolean}
  interface OverviewMember {level:DetailLevel;source:THREE.Mesh;matrix:THREE.Matrix4;shown:boolean}
  const detailLevels:DetailLevel[]=[];
  const overviewBatches:{mesh:THREE.InstancedMesh;members:OverviewMember[]}[]=[];
  const hiddenInstance=new THREE.Matrix4().makeScale(0,0,0),railColor=new THREE.Color();
  let overviewTimer=0;
  let heat:ReadonlyMap<string,number>|undefined;
  let activeWork=intervalIndex<ExperimentResult['work'][number]>([]);
  let activeRelays=intervalIndex<ExperimentResult['relays'][number]>([]);
  function addDetailLevels(station:string,anchor:THREE.Mesh,asset:THREE.Object3D,section?:FabSections){
    detailLevels.push({station,section,position:anchor.getWorldPosition(new THREE.Vector3()),near:asset.getObjectByName('equipment-detail')??asset,
      far:asset.getObjectByName('equipment-overview')??anchor,showFar:false});
    window.clearTimeout(overviewTimer);
    overviewTimer=window.setTimeout(buildOverviewBatches,140);
  }
  function clearOverviewBatches(){
    window.clearTimeout(overviewTimer);
    for(const {mesh,members} of overviewBatches){
      for(const member of members)member.source.visible=true;
      mesh.removeFromParent();mesh.dispose();
    }
    overviewBatches.length=0;
  }
  function buildOverviewBatches(){
    clearOverviewBatches();
    const groups=new Map<string,OverviewMember[]>();
    for(const level of detailLevels){
      if(level.far.name!=='equipment-overview')continue;
      level.far.updateWorldMatrix(true,true);
      level.far.traverse(node=>{
        if(!(node instanceof THREE.Mesh)||Array.isArray(node.material)||node.material.transparent) return;
        const key=node.geometry.uuid+'/'+node.material.uuid;
        const group=groups.get(key)??[];
        group.push({level,source:node,matrix:node.matrixWorld.clone(),shown:true});groups.set(key,group);
      });
    }
    for(const members of groups.values()){
      if(members.length<2)continue;
      const {geometry:shape,material:finish}=members[0].source;
      const mesh=new THREE.InstancedMesh(shape,finish,members.length);
      for(const [index,member] of members.entries()){
        member.source.visible=false;mesh.setMatrixAt(index,member.matrix);
      }
      mesh.computeBoundingSphere();model.add(mesh);overviewBatches.push({mesh,members});
    }
    render();
  }
  function batchRails(){
    const groups=new Map<THREE.Object3D,typeof railViews>();
    for(const rail of railViews){
      const parent=rail.mesh.parent!;
      const group=groups.get(parent)??[];group.push(rail);groups.set(parent,group);
    }
    if(!detailedAssets)return;
    for(const [parent,rails] of groups){
      const batch=new THREE.InstancedMesh(geometry,batchMaterial,rails.length);
      for(const [index,rail] of rails.entries()){
        rail.mesh.updateMatrix();batch.setMatrixAt(index,rail.mesh.matrix);
        batch.setColorAt(index,railColor.setHex(rail.color));
        rail.batch=batch;rail.index=index;rail.shown=rail.color;
        rail.mesh.removeFromParent();
      }
      batch.computeBoundingSphere();parent.add(batch);railBatches.push(batch);
    }
  }
  function repaintRails(fault:boolean){
    for(const batch of railBatches)batch.material=focusedTool?batchGhost:batchMaterial;
    for(const rail of railViews){
      const intensity=rail.block===undefined?undefined:heat?.get(rail.block);
      const color=rail.fault&&fault?faultRed:intensity===undefined?rail.color:
        railColor.setHSL(.31*(1-Math.min(1,intensity)),.8,.48).getHex();
      if(rail.batch){
        if(rail.shown===color)continue;
        rail.batch.setColorAt(rail.index!,railColor.setHex(color));rail.batch.instanceColor!.needsUpdate=true;rail.shown=color;
      }else rail.mesh.material=focusedTool?railGhost:material(color);
    }
  }
  const stationViews=new Map<string,THREE.Group>();
  let focusedTool='';
  let focusedLine:FabSections|undefined;
  const chamberSlots:{lid:THREE.Mesh;wafer:THREE.Mesh;x:number;z:number}[]=[];
  const supportFans:THREE.Group[]=[];
  let handler:THREE.Group|undefined,carriedWafer:THREE.Mesh|undefined;
  const lineLabels:{node:HTMLElement;position:THREE.Vector3|(()=>THREE.Vector3);section?:FabSections;detail:boolean}[]=[];
  const labelLayer=document.createElement('div');
  labelLayer.className='campus-map-labels';
  labelLayer.setAttribute('aria-hidden','true');
  if(detailedAssets)host.append(labelLayer);
  const projection=new THREE.Vector3();
  const railHeight=()=>active?.campusFloor?4.4:railY;
  view();
  function piece(x:number,y:number,z:number,w:number,h:number,d:number,color:number){
    const mesh=box(w,h,d,color);
    mesh.position.set(x,y,z);detail.add(mesh);return mesh;
  }
  function drum(x:number,y:number,z:number,diameter:number,height:number,color:number){
    const mesh=piece(x,y,z,diameter,height,diameter,color);
    mesh.geometry=spoolGeometry;
    return mesh;
  }
  function duct(a:THREE.Vector3,b:THREE.Vector3,diameter:number,color:number){
    const axis=b.clone().sub(a),mid=a.clone().lerp(b,.5);
    const mesh=drum(mid.x,mid.y,mid.z,diameter,axis.length(),color);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),axis.normalize());
    return mesh;
  }
  function focusLine(section?:FabSections){
    focusedLine=section;
    const line=active?.campusFloor?.areas.find(area=>area.section===section);
    buildingDeck.visible=!line;
    for(const [district,group] of lineGroups)group.visible=!line||line.district===district;
    if(!line)return;
    controls.target.set(0,1.35,line.z);
    const side=line.z<0?-1:1;
    camera.position.set(10.5,24,line.z+side*32);
    controls.update();
    camera.updateMatrixWorld();
    let extent=0;
    const corner=new THREE.Vector3();
    for(const x of [-line.width/2,line.width/2])for(const z of [-line.depth/2,line.depth/2]){
      for(const y of [0,5]){
        corner.set(x,y,line.z+z).project(camera);
        extent=Math.max(extent,Math.abs(corner.x),Math.abs(corner.y));
      }
    }
    if(extent>.91){
      camera.position.sub(controls.target).multiplyScalar(extent/.88).add(controls.target);
      controls.update();
    }
  }
  function focus(points:readonly string[],section?:FabSections){
    if(!active||level!=='process')return;
    if(section)focusLine(section);
    const stations=active.stations.filter(station=>points.includes(station.point.id));
    if(section&&stations.length!==1)return;
    if(!stations.length){view();return;}
    const x=stations.reduce((sum,station)=>sum+station.point.x,0)/stations.length;
    const z=stations.reduce((sum,station)=>sum+station.point.z,0)/stations.length;
    controls.target.set(x,1,z);
    if(detailedAssets&&stations.length===1){
      const {point,hub,access}=stations[0],anchor=access??hubs[hub];
      const sight=new THREE.Vector2(anchor.x-x,anchor.z-z).normalize();
      focusedTool=point.id;
      for(const [id,node] of stationViews)node.visible=id===focusedTool;
      if(active.campusFloor)controls.target.set(x-sight.x,1.28,z-sight.y);
      if(fabEquipmentModel(point.id)==='track'){
        const shift=active.campusFloor?scannerOffset/2:.82;
        controls.target.x+=shift*sight.y;
        controls.target.z-=shift*sight.x;
      }
      const radius=active.campusFloor?7.6:6.2;
      camera.position.set(x+sight.x*radius-sight.y*3,active.campusFloor?5.9:4.5,z+sight.y*radius+sight.x*3);
    }else if(active.campusFloor){
      const width=Math.max(...stations.map(item=>item.point.x))-Math.min(...stations.map(item=>item.point.x));
      const depth=Math.max(...stations.map(item=>item.point.z))-Math.min(...stations.map(item=>item.point.z));
      const radius=Math.max(22,width*.8,depth*.9);
      camera.position.set(x+radius*.54,radius*.94,z+radius*.82);
    }else camera.position.set(x+11,15,z+13);
    controls.update();
  }
  function showLevel(next:FabFloor|'chambers',chambers=2,arms:1|2=1){
    level=next;model.visible=next==='process';detail.visible=!model.visible;
    focusedTool='';
    focusLine(undefined);
    for(const node of stationViews.values())node.visible=true;
    detail.clear();chamberSlots.length=0;supportFans.length=0;handler=undefined;carriedWafer=undefined;
    if(next==='process'){view();return;}
    if(next==='chambers'){
      piece(0,-.25,0,13,.45,10,steel);
      piece(0,.19,.35,8,.35,6.2,0x43566f);
      drum(0,.7,0,3.16,.95,0x8198ad);
      const hubRim=piece(0,1.193,0,3.22,.16,3.22,0x44667d);
      hubRim.geometry=ringGeometry;hubRim.scale.z=.74;hubRim.rotation.x=-Math.PI/2;
      piece(0,.84,3.28,2.25,1.3,1.56,0xc5d6e1);
      for(const x of [-.55,.55]){
        piece(x,.96,4.1,.96,1.02,.11,0x829aaa);
        piece(x,1.07,4.17,.65,.14,.026,0x527c91);
      }
      piece(0,1.47,3.45,2.23,.17,1.63,0x7595ac);
      drum(0,1.31,0,1.09,.32,steel);
      handler=new THREE.Group();
      handler.position.set(0,1.5,0);
      const beam=box(.25,.1,1.03,amber);beam.position.z=-.52;
      const forearm=box(.18,.086,.78,0xb9c6cc);forearm.position.z=-1.23;
      const joint=box(.29,.11,.28,steel);joint.geometry=spoolGeometry;joint.position.z=-.89;
      const fork=box(.54,.042,.28,0xb9c6cc);fork.position.z=-1.62;
      carriedWafer=new THREE.Mesh(waferGeometry,material(0x82d5e6));
      carriedWafer.position.set(0,.095,-1.66);carriedWafer.visible=false;
      handler.add(beam,forearm,joint,fork,carriedWafer);
      if(arms===2){
        const exchange=box(.18,.09,1.40,0x6d5692),exchangeFork=box(.54,.042,.28,0xc5abde);
        exchange.position.set(0,.145,-.79);exchangeFork.position.set(0,.145,-1.62);
        handler.add(exchange,exchangeFork);
      }
      detail.add(handler);
      for(let i=0;i<chambers;i++){
        const angle=chambers===1?0:(i-(chambers-1)/2)*1.22;
        const x=3.6*Math.sin(angle),z=-3.25*Math.cos(angle);
        piece(x,.18,z,2.45,.34,2.28,0x62798f);
        drum(x,.74,z,2.34,.97,0xa8bcd0);
        drum(x,1.22,z,2.45,.15,0x4f687b);
        drum(x,1.305,z,1.54,.11,0x536777);
        duct(new THREE.Vector3(x*.42,1,z*.45),new THREE.Vector3(x,1,z),.33,0x718c9e);
        for(let bolt=0;bolt<10;bolt++){
          const a=bolt*Math.PI/5;
          drum(x+Math.cos(a)*1.11,1.32,z+Math.sin(a)*1.11,.088,.074,0xd0e3ef);
        }
        duct(new THREE.Vector3(x,1.29,z-.84),new THREE.Vector3(x,1.86,z-1.29),.14,0xb58a60);
        const wafer=new THREE.Mesh(waferGeometry,material(0x82d5e6));
        wafer.position.set(x,1.414,z);wafer.visible=false;detail.add(wafer);
        const lid=piece(x,1.78,z-.4,2.08,.17,2.08,steel);
        lid.geometry=ringGeometry;
        lid.rotation.x=-Math.PI/2;
        lid.scale.z=1.39;
        chamberSlots.push({lid,wafer,x,z});
      }
      controls.target.set(0,.5,0);camera.position.set(8,9,9);controls.update();
      return;
    }
    piece(0,-.25,0,35,.45,24,steel);
    piece(0,.04,0,34,.12,23,0xb7c9da);
    supportFloor(next);
    view();
  }
  function supportFloor(floor:Exclude<FabFloor,'process'>){
    for(const z of [-5,4]){
      if(floor==='utility')for(const [i,color] of [0x358cbc,0x329983,0xc99955].entries()){
        duct(new THREE.Vector3(-14,2.32+i*.36,z-1.5),new THREE.Vector3(14,2.32+i*.36,z-1.5),.21,color);
      }
      if(floor==='subfab')duct(new THREE.Vector3(-14,2.8,z-1.25),new THREE.Vector3(14,2.8,z-1.25),.42,0x6d879c);
      for(const x of [-11,-5.5,0,5.5,11]){
        piece(x,.2,z,4,.31,3.26,steel);
        if(floor==='air'){
          piece(x,.55,z,3.3,.48,2.49,0xb5c8d4);
          piece(x,.89,z,3.3,.2,2.45,0x55718a);
          for(let i=0;i<13;i++)piece(x-1.44+i*.24,.94,z+.39,.063,.06,1.46,0xb7d7da);
          const rim=piece(x,1.164,z-.18,1.37,.15,1.37,0x7594a5);
          rim.geometry=ringGeometry;rim.rotation.x=-Math.PI/2;rim.scale.z=.74;
          const rotor=new THREE.Group();
          rotor.position.set(x,1.11,z-.18);
          const hub=box(.25,.13,.25,steel);hub.geometry=spoolGeometry;rotor.add(hub);
          for(let i=0;i<6;i++){
            const a=i*Math.PI/3,blade=box(.44,.07,.16,0xa3bfce);
            blade.position.set(Math.cos(a)*.29,0,Math.sin(a)*.29);blade.rotation.y=-a+.3;rotor.add(blade);
          }
          detail.add(rotor);supportFans.push(rotor);
        }else if(floor==='subfab'){
          piece(x,.83,z,2.41,.91,1.59,0xd1dce2);
          piece(x,.89,z+.83,2.31,.77,.09,0x9bacba);
          for(let i=0;i<7;i++)piece(x-.47+i*.13,.85,z+.90,.046,.32,.035,steel);
          piece(x+.72,1.0,z+.90,.42,.22,.052,0x406f80);
          for(const a of [-.8,.8]){
            drum(x+a,.16,z+.68,.18,.29,0x688294);
            duct(new THREE.Vector3(x+a,1.29,z-.41),new THREE.Vector3(x+a,2.8,z-1.25),.24,0x9eb7c5);
            drum(x+a,1.4,z-.48,.38,.15,0x71899d);
          }
          duct(new THREE.Vector3(x-.74,1.57,z-.43),new THREE.Vector3(x+.74,1.57,z-.43),.44,0x6e9caa);
        }else{
          for(const [i,color] of [0x358cbc,0x329983,0xc99955].entries()){
            const offset=(i-1)*.82;
            drum(x+offset,.91,z+.21,.51,1.17,0xb2c6d0);
            drum(x+offset,1.53,z+.21,.56,.12,color);
            duct(new THREE.Vector3(x+offset,1.54,z+.21),new THREE.Vector3(x+offset,2.32+i*.36,z-1.5),.127,color);
            drum(x+offset,1.86,z-.09,.22,.1,color);
          }
          piece(x+1.52,.93,z-.2,.64,1.47,.63,0x7596ac);
          piece(x+1.52,1.21,z+.135,.35,.29,.052,steel);
        }
      }
    }
  }
  function updateChambers(activities:readonly ChamberActivity[],time:number){
    const handling=activities.find(item=>item.kind!=='process');
    if(handler&&carriedWafer){
      handler.rotation.y=0;
      handler.scale.z=1;
      carriedWafer.visible=!!handling;
      if(handling){
        const slot=chamberSlots[handling.chamber-1];
        const progress=(time-handling.start)/(handling.end-handling.start);
        const extension=handling.kind==='load'?progress:1-progress;
        handler.rotation.y=Math.atan2(-slot.x,-slot.z);
        handler.scale.z=THREE.MathUtils.lerp(.63,Math.hypot(slot.x,slot.z)/1.66,extension);
        carriedWafer.scale.z=1/handler.scale.z;
      }
    }
    chamberSlots.forEach(({lid,wafer},i)=>{
      const item=activities.find(task=>task.chamber===i+1);
      const process=item?.kind==='process';
      const pulse=process ? .5+.5*Math.sin(time*10) : 0;
      wafer.visible=!!process;
      wafer.rotation.y=time*3;
      wafer.material=material(pulse>.5?mint:0x82d5e6);
      lid.position.y=process?1.62:1.78;
      lid.material=material(process?mint:item?amber:steel);
    });
    render();
  }
  function updateSupport(time:number,running:boolean){
    supportFans.forEach((rotor,i)=>{rotor.rotation.y=running?time*(2+(i%3)*.2):0;});
    render();
  }
  function railSegment(a:RailPoint,b:RailPoint,color:number,thin=false,kind?:RailEdge['kind']){
    const length=Math.hypot(a.x-b.x,a.z-b.z);
    const tight=kind==='bay'||kind==='siding';
    const thick=kind==='spine'?.19:tight?.26:.115;
    const width=kind==='spine'?.37:tight?.50:.21;
    const beam=box(length+.03,thin?(kind ? .17 : .065):thick,thin?(kind ? .32 : .06):width,color);
    beam.position.set((a.x+b.x)/2,railHeight()+((a.elevation??0)+(b.elevation??0))/2,(a.z+b.z)/2);
    beam.rotation.y=-Math.atan2(b.z-a.z,b.x-a.x);
    const group=a.district&&a.district===b.district?lineGroups.get(a.district):undefined;
    const parent=group??(active?.campusFloor?buildingDeck:model);
    parent.add(beam);
    if(tight){
      const cap=box(length+.045,.084,thin?.23:.41,0x8b9d9a);
      cap.position.copy(beam.position);cap.position.y+=thin?.119:.163;
      cap.rotation.copy(beam.rotation);
      railViews.push({mesh:cap,color:0x8b9d9a,fault:false});
      parent.add(cap);
    }
    if(length>5.8&&kind&&kind!=='siding'){
      const arrow=new THREE.Group();
      arrow.rotation.y=beam.rotation.y;
      arrow.position.copy(beam.position);
      arrow.position.y+=tight?.22:.128;
      for(const sign of [-1,1]){
        const wing=box(.55,.026,.082,0xeef5f7);
        wing.position.set(0,0,sign*.103);
        wing.rotation.y=sign*.5;
        arrow.add(wing);
      }
      pathArrows.push(arrow);
      parent.add(arrow);
    }
    return beam;
  }
  const pathArrows:THREE.Group[]=[];
  function slab(x:number,y:number,z:number,w:number,h:number,d:number,color:number,parent:THREE.Group=model){
    const tile=box(w,h,d,color);
    tile.position.set(x,y,z);
    parent.add(tile);
    return tile;
  }
  function label(text:string,position:THREE.Vector3|(()=>THREE.Vector3),section?:FabSections,detail=false){
    const node=document.createElement('span');
    node.className=detail?'campus-line-equipment-label':'campus-bay-label';
    node.textContent=text;labelLayer.append(node);
    lineLabels.push({node,position,section,detail});
    return node;
  }
  function buildLineDeck(line:CampusFabLine){
    const {width,depth,z}=line;
    const group=new THREE.Group();
    lineGroups.set(line.district,group);model.add(group);
    const pad=(x:number,y:number,localZ:number,w:number,h:number,d:number,color:number)=>
      slab(x,y,z+localZ,w,h,d,color,group);
    const accent=line.product==='npu'?0x256856:0x255476;
    pad(0,-.19,0,width+.26,.39,depth+.26,steel);
    pad(0,.026,0,width,.058,depth,0xc7d2d4);
    pad(0,.061,0,width-1.5,.024,7.4,0xaebec0);
    const postX=width/2-1.08;
    for(let x=-postX;x<=postX;x+=2)pad(x,.06,0,.028,.018,depth-.16,0x98abad);
    for(let offset=-8;offset<=8;offset+=2)pad(0,.064,offset,width-.14,.015,.04,0xa5b5b7);
    const ventLocations:THREE.Vector3[]=[];
    for(const side of [-1,1]){
      pad(0,.08,side*3.88,width-.55,.021,.052,0xe3b853);
      pad(0,.055,side*8.89,width-.1,.04,.066,accent);
      for(let x=-postX+.8;x<=postX-.8;x+=1.6){
        ventLocations.push(new THREE.Vector3(x,.079,z+side*7.84));
      }
      for(const x of [-postX,0,postX]){
        pad(x,2.45,side*8.22,.18,4.8,.18,steel);
        pad(x,.09,side*8.22,.44,.17,.44,steel);
        for(let stripe=0;stripe<3;stripe++)pad(x,.28+stripe*.16,side*8.22,.192,.068,.19,0xd9aa4d);
      }
    }
    const stencil=new THREE.Object3D();
    const vents=new THREE.InstancedMesh(geometry,material(0x587375),ventLocations.length);
    const slats=new THREE.InstancedMesh(geometry,material(0xa4b5b4),ventLocations.length*5);
    ventLocations.forEach((position,index)=>{
      stencil.position.copy(position);stencil.scale.set(.72,.025,.25);stencil.updateMatrix();
      vents.setMatrixAt(index,stencil.matrix);
      stencil.scale.set(.042,.012,.21);
      for(let slat=0;slat<5;slat++){
        stencil.position.set(position.x+(slat-2)*.106,.097,position.z);stencil.updateMatrix();
        slats.setMatrixAt(index*5+slat,stencil.matrix);
      }
    });
    group.add(vents,slats);
    deckDetails.push(vents,slats);
    for(const x of [-postX,0,postX]){
      pad(x,4.86,0,.20,.23,16.58,steel);
      for(const side of [-1,1])pad(x,4.62,side*2.32,.14,.4,.14,0x5e7274);
    }
    const panelSide=z<0?-1:1;
    const signX=-width/2+4;
    pad(signX,.61,8.31*panelSide,4.3,.85,.16,accent);
    for(const x of [signX-1.64,signX+1.64])pad(x,.22,8.31*panelSide,.125,.43,.125,steel);
    const title=sectionName(line.section)+' · '+line.product.toUpperCase();
    const aggregate=label(title,new THREE.Vector3(0,1.55,z-6.8*Math.sign(z)),line.section);
    aggregate.dataset.product=line.product;
    const signage=label(title,new THREE.Vector3(signX,1.10,z+8.31*panelSide),line.section,true);
    signage.classList.add('campus-line-name');
  }
  function buildFloor(layout:CampusFabFloor){
    const {width,depth}=layout;
    model.add(buildingDeck);
    slab(0,-.55,0,width+.5,.28,depth+.5,steel,buildingDeck);
    slab(0,-.38,0,width,.28,depth,0xb4c5d2,buildingDeck);
    for(const line of layout.areas)buildLineDeck(line);
    slab(0,-.20,0,61,.10,6.56,0x8da8ba,buildingDeck);
    for(const side of [-1,1]){
      slab(0,-.145,side*3.56,61,.03,.12,0xecf0e9,buildingDeck);
      slab(0,-.2,side*(depth/2-.25),width-.3,.24,.25,steel,buildingDeck);
    }
    for(const x of [-33.7,33.7])slab(x,-.16,0,5.5,.15,7.5,0x88adac,buildingDeck);
  }
  function load(result:ExperimentResult){
    active=result;
    clearOverviewBatches();
    model.clear();
    mountedModels.clear();
    delete renderer.domElement.dataset.equipmentModels;
    toolLights.clear();
    stationViews.clear();
    railViews.length=0;
    detailLevels.length=0;
    for(const batch of railBatches)batch.dispose();
    railBatches.length=0;
    heat=undefined;
    activeWork=intervalIndex(result.work);activeRelays=intervalIndex(result.relays);
    pathArrows.length=0;
    lineGroups.clear();
    for(const mesh of deckDetails)mesh.dispose();
    deckDetails.length=0;
    buildingDeck.clear();buildingDeck.visible=true;
    lineLabels.length=0;
    labelLayer.replaceChildren();
    const layout=result.campusFloor;
    renderer.domElement.dataset.fabLines=String(layout?.areas.length??0);
    renderer.domElement.dataset.topology=result.topology;
    if(layout)buildFloor(layout);
    else{
    const points=result.stations.map(station=>station.point);
    experimentWidth=Math.max(35,...points.map(point=>Math.abs(point.x)*2+4));
    experimentDepth=Math.max(27,...points.map(point=>Math.abs(point.z)*2+4));
    const frame=box(experimentWidth+.2,.18,experimentDepth+.2,steel);
    frame.position.y=-.32;
    const slab=box(experimentWidth,.24,experimentDepth,0xaabccc);
    slab.position.y=-.13;
    model.add(frame,slab);
    for(let i=-2*Math.floor(experimentWidth/4);i<experimentWidth/2;i+=2){
      const vertical=box(.023,.015,experimentDepth-1,0x819ab4);
      vertical.position.x=i;
      model.add(vertical);
    }
    for(let i=-2*Math.floor(experimentDepth/4);i<experimentDepth/2;i+=2){
      const horizontal=box(experimentWidth-1,.015,.023,0x819ab4);
      horizontal.position.z=i;
      model.add(horizontal);
    }
    }
    const relayPorts=result.stations.filter(station=>station.type==='relay');
    if(result.topology==='vertical'){
      const upper=result.stations.filter(station=>station.point.elevation);
      const xs=upper.map(station=>station.point.x),zs=upper.map(station=>station.point.z);
      const minX=Math.min(-13,...xs),maxX=Math.max(13,...xs),minZ=Math.min(-7,...zs),maxZ=Math.max(7,...zs);
      slab((minX+maxX)/2,3.15,(minZ+maxZ)/2,maxX-minX+2,.23,maxZ-minZ+2,0xa5b6c9).material=upperDeck;
      for(const x of [minX,maxX])for(const z of [minZ,maxZ])slab(x,1.55,z,.19,3.15,.19,steel);
    }
    for(let i=0;i<relayPorts.length;i+=2){
      const a=relayPorts[i].point,b=relayPorts[i+1].point;
      const height=b.elevation??0;
      const span=Math.hypot(a.x-b.x,a.z-b.z);
      const bridge=box(Math.hypot(span,height),.26,.52,0x6d5692);
      bridge.position.set((a.x+b.x)/2,1.55+height/2,(a.z+b.z)/2);
      bridge.rotation.order='YXZ';
      bridge.rotation.y=-Math.atan2(b.z-a.z,b.x-a.x);
      bridge.rotation.z=Math.atan2(height,span);
      model.add(bridge);
    }
    const rendered=new Set<string>();
    for(const edge of result.edges){
      if(rendered.has(edge.block))continue;
      if(edge.bypass&&layout&&!result.policy.bypass)continue;
      rendered.add(edge.block);
      const siding=edge.kind==='siding'||edge.from.id.startsWith('bay-')||edge.to.id.startsWith('bay-');
      const color=edge.bypass?mint:edge.kind==='secondary'||edge.kind==='switch'?0x6d5692:
        siding?(layout?0x8a6639:0x5f7da0):edge.kind==='bay'?0x284248:steel;
      const mesh=railSegment(edge.from,edge.to,color,siding,edge.kind);
      railViews.push({mesh,color,fault:edge.block===result.outageBlock,block:edge.block});
    }
    batchRails();
    for(const station of result.stations){
      const {x,z}=station.point;
      const color=station.type==='home'?0x5e7ea6:station.type==='buffer'?0x578478:station.type==='relay'?0x6d5692:0x9aaebf;
      const size=layout?(station.type==='buffer'?3.12:campusToolSize.width):station.type==='buffer'?1.06:1.48;
      const body=box(size,layout?2.55:1.4,layout?campusToolSize.depth:1.32,color);
      const center=layout?-campusToolSize.offset:0;
      body.position.set(0,layout?1.37:.72,center);
      const pedestal=box(size+.12,.17,layout?campusToolSize.depth+.09:1.52,steel);
      pedestal.position.set(0,floorY,center);
      const port=box(layout?.72:.94,.17,layout?.64:.68,0x3c5470);
      port.position.set(0,layout?1.51:1.48,0);
      const light=box(.48,.12,.15,steel);
      light.position.set(layout?-.56:0,layout?1.61:1.54,layout?.08:.46);
      toolLights.set(station.point.id,light);
      const base=new THREE.Group();
      base.position.set(x,station.point.elevation??0,z);
      if(detailedAssets){
        const hub=station.access??hubs[station.hub];
        base.rotation.y=Math.atan2(hub.x-x,hub.z-z);
      }
      base.add(pedestal,body,port,light);
      if(layout){
        const support=box(.49,1.44,.48,0x8aa5b7);
        support.position.y=.72;
        base.add(support);
      }
      const line=station.point.district&&lineGroups.get(station.point.district);
      (line||(layout?buildingDeck:model)).add(base);
      stationViews.set(station.point.id,base);
      if(station.section){
        const tag=station.recipeStation?machineCode({id:'cell-'+station.copy,kind:kindFor(station.recipeStation.split('/')[0]),
          x,z,facing:0}):'STK';
        const sign=station.access?Math.sign(station.access.z-z):1;
        label(tag,new THREE.Vector3(x,2.95,z-sign*campusToolSize.offset),station.section,true);
        if(station.recipeStation==='track')label('LTH-'+String(station.copy).padStart(2,'0'),
          new THREE.Vector3(x+sign*scannerOffset,2.96,z-sign*campusToolSize.offset),station.section,true);
      }
      const id=fabEquipmentModel(station.point.id);
      if(id){
        const wide=station.type==='home'||station.point.id==='stocker';
        const dimensions=layout?[wide?3.35:size,3.12,campusToolSize.depth] as const:
          wide?[2.43,1.58,1.48] as const:[station.type==='buffer'?1.08:1.75,1.46,1.55] as const;
        install(result,id,dimensions,base,body,wide?.12:.13)
          ?.then(asset=>{
            if(!asset)return;
            asset.position.z=center;
            if(layout&&station.type==='tool')addDetailLevels(station.point.id,body,asset,station.section);
            if(!layout){
              port.visible=false;
              const outline=box(.48,.075,.45,0x3c5470);
              outline.position.set(0,1.575,0);
              base.add(outline);
            }
            render();
          });
        if(detailedAssets&&id==='track'){
          // The simulation reserves exposure on the track station as a single lithography cell.
          const scanner=new THREE.Group();
          scanner.position.set(layout?scannerOffset:1.79,0,center);
          const scannerBase=box(layout?3.57:1.65,.14,layout?campusToolSize.depth:1.54,steel);
          scannerBase.position.y=.07;
          const standby=box(layout?2.8:1.56,layout?2.52:1.35,layout?2.52:1.24,0xb4c6d1);
          standby.position.y=layout?1.34:.79;
          scanner.add(scannerBase,standby);
          base.add(scanner);
          const link=box(layout?.61:.4,.21,.38,0x607d92);
          link.position.set(layout?scannerOffset/2:.9,layout?1.51:.86,center);
          base.add(link);
          void install(result,'scanner',layout?[3.48,2.98,3.20]:[1.62,1.46,1.42],scanner,standby,.13)?.then(asset=>{
            if(asset&&layout)addDetailLevels(station.point.id,standby,asset,station.section);
          });
        }
      }else if(detailedAssets&&station.type==='tool'){
        const head=box(.41,.295,.41,0xb9dce0);
        head.geometry=spoolGeometry;
        head.position.set(0,1.37,0);
        const motor=box(.72,.27,.66,0x426a80);
        motor.position.set(0,1.29,-.51);
        base.add(head,motor);
      }
    }
    vehicles=result.vehicles.map(car=>{
      const node=new THREE.Group(),fallback=box(.8,.34,.61,amber);
      node.add(fallback);model.add(node);
      const vehicle:VehicleView={node,fallback};
      if(detailedAssets){
        const hoist=box(.03,1,.034,0x364251);
        hoist.visible=false;
        model.add(hoist);vehicle.hoist=hoist;
        install(result,'oht',layout?[1.27,.77,1.02]:[.91,.55,.76],node,fallback,-.14,'centre')?.then(asset=>{
          const gripper=asset?.getObjectByName('gripper');
          if(gripper&&asset){
            vehicle.gripper=gripper;
            vehicle.gripperY=gripper.position.y;
            vehicle.scale=asset.scale.y;
          }
        });
      }
      if(car.section){
        const location=new THREE.Vector3();
        const tag=label('OHT-'+String(car.id).padStart(2,'0'),()=>{
          location.copy(node.position);
          location.y+=1.04;
          return location;
        },car.section,true);
        tag.classList.add('campus-line-oht-label');
      }
      return vehicle;
    });
    pods=result.lots.map(lot=>{
      const node=new THREE.Group(),color=lotColors[lot.product===result.input.primary?0:1];
      const fallback=box(.48,.37,.43,color);
      node.add(fallback);model.add(node);
      install(result,'foup',[.5,.381,.46],node,fallback,0,'centre')?.then(asset=>{
        if(!asset)return;
        const stripe=box(.23,.024,.03,color);
        stripe.position.set(0,.135,.225);node.add(stripe);
      });
      return node;
    });
    const priority=(node:HTMLElement)=>node.classList.contains('campus-line-oht-label')?0:1;
    lineLabels.sort((a,b)=>priority(a.node)-priority(b.node));
    update(0,'');
  }
  function install(result:ExperimentResult,id:string,size:readonly [number,number,number],node:THREE.Group,
    fallback:THREE.Mesh,y:number,origin:'floor'|'centre'='floor'){
    return models?.then(loader=>active===result?loader?.fit(id,size,origin):undefined).then(asset=>{
      if(!asset||active!==result)return;
      asset.position.y=y;
      node.add(asset);
      fallback.visible=false;
      mountedModels.add(id);
      renderer.domElement.dataset.equipmentModels=[...mountedModels].join(' ');
      render();
      return asset;
    });
  }
  function update(time:number,selected:string){
    if(!active)return;
    adjustRenderScale(time);
    const result=active;
    const movingPods=new Map<number,THREE.Vector3>();
    const fault=result.input.outageAt<=time&&time<result.input.outageAt+result.input.outageLength;
    const height=railHeight();
    for(const arrow of pathArrows)arrow.visible=!focusedTool;
    repaintRails(fault);
    result.vehicles.forEach((vehicle,i)=>{
      const past=vehicle.motion[upperBound(vehicle.motion,time,segment=>segment.start)-1];
      const active=past&&time<past.end?past:undefined;
      const fraction=active?(time-active.start)/(active.end-active.start):1;
      const from=active?.from??past?.to??vehicle.initial,to=active?.to??from;
      const x=THREE.MathUtils.lerp(from.x,to.x,fraction),z=THREE.MathUtils.lerp(from.z,to.z,fraction);
      const elevation=THREE.MathUtils.lerp(from.elevation??0,to.elevation??0,fraction);
      const {node,fallback,hoist,gripper,gripperY,scale}=vehicles[i];
      node.visible=!focusedLine||vehicle.section===focusedLine;
      node.position.set(x,height+elevation-.22,z);
      node.rotation.y=past?-Math.atan2(past.to.z-past.from.z,past.to.x-past.from.x):0;
      fallback.material=material(fault&&result.input.outage==='vehicle'&&i===0?faultRed:amber);
      if(hoist)hoist.visible=false;
      if(gripper&&gripperY!==undefined)gripper.position.y=gripperY;
      if(active?.lot!==undefined&&['pickup','loaded','drop'].includes(active.phase)){
        const y=elevation+(active.phase==='pickup'?THREE.MathUtils.lerp(1.8,height-.66,fraction):
          active.phase==='drop'?THREE.MathUtils.lerp(height-.66,1.8,fraction):height-.66);
        movingPods.set(active.lot,new THREE.Vector3(x,y,z));
        const top=height+elevation-.44,end=y+.18;
        if(gripper&&gripperY!==undefined&&scale)gripper.position.y=gripperY-Math.max(0,top-end)/scale;
        if(hoist){
          hoist.visible=node.visible&&top>end;
          hoist.position.set(x,(top+end)/2,z);
          hoist.scale.y=Math.max(.01,top-end);
        }
      }
    });
    for(const move of activeRelays(time)){
      const fraction=(time-move.start)/(move.end-move.start);
      movingPods.set(move.lot,new THREE.Vector3(THREE.MathUtils.lerp(move.from.x,move.to.x,fraction),
        1.8+THREE.MathUtils.lerp(move.from.elevation??0,move.to.elevation??0,fraction),
        THREE.MathUtils.lerp(move.from.z,move.to.z,fraction)));
    }
    const working=new Set(activeWork(time).map(run=>run.station));
    for(const [id,mesh] of toolLights){
      const failed=fault&&(result.input.outage==='port'&&id===result.outagePort||result.input.outage==='lift'&&id.startsWith('relay-0-'))||
        id===result.maintenanceStation&&result.downtime.some(item=>item.start<=time&&time<item.end);
      mesh.material=material(failed?faultRed:id===selected?amber:working.has(id)?mint:steel);
      mesh.scale.x=id===selected?.8:.48;
    }
    result.lots.forEach((lot,i)=>{
      const position=movingPods.get(lot.id);
      const current=lot.locations[upperBound(lot.locations,time,location=>location.time)-1];
      const mesh=pods[i];
      mesh.visible=(!focusedLine||lot.section===focusedLine)&&(!!position||(current!==undefined&&current.slot!==null));
      if(position)mesh.position.copy(position);
      else if(current&&current.slot!==null){
        const queued=current.point.id==='home'||current.point.id==='stocker'||!!result.campusFloor&&current.point.id.startsWith('buffer-');
        const offset=result.campusFloor?current.slot%4*.48:(current.slot%4-1.5)*.42;
        const x=queued?offset:0,z=queued?Math.floor(current.slot/4)*.39:0;
        const slotOffset=!result.campusFloor&&!queued?current.slot*.48:0;
        mesh.position.set(current.point.x+x+slotOffset,1.8+(current.point.elevation??0),current.point.z+z);
      }
    });
    render();
  }
  function dispose(){
    observer.disconnect();
    controls.dispose();
    geometry.dispose();
    waferGeometry.dispose();
    spoolGeometry.dispose();
    ringGeometry.dispose();
    railGhost.dispose();
    upperDeck.dispose();
    clearOverviewBatches();
    batchMaterial.dispose();batchGhost.dispose();
    void models?.then(loader=>loader?.dispose());
    active=undefined;
    materials.forEach(value=>value.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    labelLayer.remove();
    for(const mesh of deckDetails)mesh.dispose();
    for(const batch of railBatches)batch.dispose();
  }
  return {load,update,view,focus,showLevel,updateChambers,updateSupport,dispose,setRailHeat(values?:ReadonlyMap<string,number>){heat=values;}};
}
