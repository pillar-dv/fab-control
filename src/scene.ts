import * as T from 'three';
import {createEquipmentHover} from './hover';
import reference from '../fab-model-reference.json';
import {defaultLine,dockOf,footprint,machineCode,parkedCount,parkingBays,type Machine} from './line-layout';
import {equipment,processTool} from './equipment';
import { createCamera, type CameraView } from './camera';
import type {VehicleFrame} from './simulation';

type Point = { x: number; y: number; z: number };
export interface SceneFrame {
  time?:number;
  vehicle: VehicleFrame;
  vehicles?:VehicleFrame[];
  carriers: ReadonlyArray<{
    id: string; station: string | null; position: Point; doorOpen: number; rotationY?: number;
    wafer: { position: Point; owner: string; slot: number };
  }>;
  productId?: string;
  equipment?: Partial<Record<string,{status:string}>>;
}

const layout = reference.project_assumptions;
const spec = reference.published_model_specs;
const portHeight = .90;
// The door first withdraws through the frame, then descends behind the docking table.
export function doorOffset(open:number):[number,number,number] {
  return [0,-.36*Math.max(0,(open-.25)/.75),-.115*Math.min(1,open/.25)];
}
export function createFabScene(host: HTMLElement, onSelect?: (id: string) => void, lineConfig=defaultLine([])) {
  const machines=Object.fromEntries(lineConfig.machines.map(m=>[m.id,m]));
  const names:Record<string,[string,string]>={};
  for(const machine of lineConfig.machines)names[machine.id]=[machineCode(machine),equipment[machine.kind].name];
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label','반도체 생산층 3D 뷰. 드래그로 회전하고 휠로 확대합니다.');
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none' });
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.append(canvas);
  const labels = document.createElement('div');
  Object.assign(labels.style, { position:'absolute', inset:'0', pointerEvents:'none', overflow:'hidden' });
  host.append(labels);
  const scene = new T.Scene();
  const backdrop='#e6eef7';
  scene.background = new T.Color(backdrop);
  scene.fog = new T.FogExp2(backdrop, .004);
  const cameraRig = createCamera(canvas, new T.Box3(new T.Vector3(-.8,-.8,-.8),new T.Vector3(36.8,5,18.8)));
  const {orbit} = cameraRig;
  scene.add(new T.HemisphereLight(0xe6f6ff, 0x4a5f64, 2.1));
  const sun = new T.DirectionalLight(0xffefcf, 3.2);
  sun.position.set(8,28,18);
  sun.target.position.set(18,0,9);
  sun.castShadow=true;
  Object.assign(sun.shadow.camera,{ left:-24,right:24,top:20,bottom:-20,near:1,far:70 });
  sun.shadow.mapSize.set(2048,2048);
  sun.shadow.normalBias=.025;
  sun.shadow.bias=-.0003;
  scene.add(sun,sun.target);
  const backLight = new T.DirectionalLight(0xa9e8ff,1.45);
  backLight.position.set(30,15,-18); scene.add(backLight);
  const V=(x:number,y:number,z:number)=>new T.Vector3(x,y,z);
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>();
  const textures = new Set<T.Texture>();
  function geo<TGeom extends T.BufferGeometry>(g:TGeom) {geometries.add(g);return g;}
  function material(color:string, metalness=.22, roughness=.46, glow=false) {
    const mat=new T.MeshStandardMaterial({color, metalness, roughness});
    if(glow) {mat.emissive.set(color);mat.emissiveIntensity=.65;}
    materials.add(mat);return mat;
  }
  const m = {
    shell:material('#cbd7d7'), white:material('#ecf0e8'), side:material('#9eafb3'), trim:material('#40565c'),
    shadow:material('#273a40'), glass:material('#203e45',.5,.21), darkGlass:material('#153238',.62,.12),
    metal:material('#829a9f',.67,.35), shiny:material('#c0d5d7',.76,.24), black:material('#1c3034'),
    teal:material('#228e87'), lamp:material('#49dfbd',.1,.3,true), amber:material('#e29840',.32,.31),
    orange:material('#f4ad4c',.28,.27), yellow:material('#d7be78'), floor:material('#9caeb0',.12,.72),
    grout:material('#71868b',.2,.68), base:material('#506970'), low:material('#344b52'),
    ink:material('#344d53'), light:material('#c1d0ce'), wafer:material('#7198b5',.78,.15),
    rubber:material('#28393a'), hose:material('#76999f'), deck:material('#acbec0',.38,.6),
    lane:material('#aab9a9',.1,.77), frame:material('#203a62',.36,.44), frameEdge:material('#42638b',.38,.43)
  };
  const cube=geo(new T.BoxGeometry(1,1,1)), cyl=geo(new T.CylinderGeometry(.5,.5,1,24));
  function shape(parent:T.Object3D,g:T.BufferGeometry,mat:T.Material,x:number,y:number,z:number,w:number,h:number,d:number){
    const obj=new T.Mesh(g,mat);
    obj.position.set(x,y,z);obj.scale.set(w,h,d);parent.add(obj);return obj;
  }
  function box(p:T.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,mat:T.Material){
    return shape(p,cube,mat,x,y,z,w,h,d);
  }
  function drum(p:T.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,mat:T.Material){
    return shape(p,cyl,mat,x,y,z,w,h,d);
  }
  function tube(p:T.Object3D,a:T.Vector3,b:T.Vector3,r:number,mat:T.Material){
    const delta=b.clone().sub(a), len=delta.length(),c=a.clone().lerp(b,.5);
    const part=drum(p,c.x,c.y,c.z,r*2,len,r*2,mat);
    part.quaternion.setFromUnitVectors(V(0,1,0),delta.normalize());return part;
  }
  function line(p:T.Object3D,points:T.Vector3[],color:string){
    const g=geo(new T.BufferGeometry().setFromPoints(points));
    const mat=new T.LineBasicMaterial({color});materials.add(mat);
    const l=new T.Line(g,mat);p.add(l);return l;
  }
  function group(p:T.Object3D,id?:string){
    const g=new T.Group();if(id)g.userData.stationId=id;p.add(g);return g;
  }
  // Combine repeated panels, fasteners, shelves and pipe segments while retaining a group per pickable machine.
  function batch(g:T.Group) {
    const buckets=new Map<string,T.Mesh[]>();
    for(const obj of [...g.children]){
      if(!(obj instanceof T.Mesh)||obj instanceof T.InstancedMesh||Array.isArray(obj.material))continue;
      const key=obj.geometry.uuid+obj.material.uuid;
      const members=buckets.get(key)??[];members.push(obj);buckets.set(key,members);
    }
    for(const list of buckets.values()){
      const first=list[0];
      if(list.length===1){first.castShadow=true;first.receiveShadow=true;continue;}
      const mesh=new T.InstancedMesh(first.geometry,first.material,list.length);
      list.forEach((item,i)=>{item.updateMatrix();mesh.setMatrixAt(i,item.matrix);g.remove(item);});
      mesh.computeBoundingSphere();mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);
    }
  }
  const plane=geo(new T.PlaneGeometry(1,1));
  function faceText(parent:T.Object3D,txt:string,w:number,h:number,x:number,y:number,z:number,color='#eaf5ed',background='#23484a'){
    const cv=document.createElement('canvas');cv.width=640;cv.height=128;
    const ctx=cv.getContext('2d')!;
    ctx.fillStyle=background;ctx.fillRect(0,0,cv.width,cv.height);
    ctx.fillStyle=color;ctx.font='bold 69px sans-serif';ctx.textBaseline='middle';
    ctx.fillText(txt,24,66,595);
    const map=new T.CanvasTexture(cv);map.colorSpace=T.SRGBColorSpace;textures.add(map);
    const mat=new T.MeshBasicMaterial({map});materials.add(mat);
    return shape(parent,plane,mat,x,y,z,w,h,1);
  }
  const grid=new T.GridHelper(144,144,'#a9bfd5','#cdd9e7');grid.position.set(18,-.82,9);
  geometries.add(grid.geometry);
  for(const mat of Array.isArray(grid.material)?grid.material:[grid.material])materials.add(mat);
  scene.add(grid);
  const foundation=group(scene), floorParts=group(foundation);
  box(floorParts,18,-.54,9,36.45,.45,18.45,m.frame);
  box(floorParts,18,-.25,9,36.38,.25,18.38,m.frameEdge);
  box(floorParts,18,-.07,9,36,.14,18,m.floor);
  for(let x=0;x<=36;x+=1.5)box(floorParts,x,.002,9,.023,.008,18,m.grout);
  for(let z=0;z<=18;z+=1.5)box(floorParts,18,.003,z,36,.008,.023,m.grout);
  for(const z of [7.1,10.9]){
    box(floorParts,18,.009,z,31.8,.012,.055,m.yellow);
    box(floorParts,18,.008,z+(z<9?-.1:.1),31.8,.01,.02,m.ink);
  }
  for(let x=1.5;x<36;x+=1.5){
    for(const z of [-.15,18.15])box(floorParts,x,-.285,z,.021,.35,.02,m.trim);
    for(const z of [.65,16.95]){
      box(floorParts,x,.018,z,.78,.024,.28,m.base);
      for(let k=0;k<5;k++)box(floorParts,x-.28+k*.14,.038,z,.048,.012,.23,m.rubber);
    }
  }
  for(let x=3;x<35;x+=2)box(floorParts,x,.014,9,.55,.012,.025,m.lane);
  for(const z of [.19,17.81])box(floorParts,18,.015,z,35.63,.018,.07,m.light);
  // A continuous warm stripe on the fascia marks the front of the cell.
  box(floorParts,18,-.26,18.208,34.8,.025,.02,m.teal);
  const reserved=layout.reserved_zones.find(s=>s.id==='future_metrology')!;
  const [rx,rz]=reserved.nw_corner_xz_m, [rw,rd]=reserved.reserved_width_depth_m;
  const reservedFree=!lineConfig.machines.some(m=>{
    const [w,d]=footprint(m.kind);return Math.abs(m.x-rx-rw/2)<(w+rw)/2&&Math.abs(m.z-rz-rd/2)<(d+rd)/2;
  });
  if(reservedFree){
    for(let x=rx;x<rx+rw;x+=.7){for(const z of [rz,rz+rd])box(floorParts,x+.19,.025,z,.38,.02,.05,m.light);}
    for(let z=rz;z<rz+rd;z+=.7){for(const x of [rx,rx+rw])box(floorParts,x,.025,z+.19,.05,.02,.38,m.light);}
    const future=faceText(floorParts,'RESERVED   /   QA',3.5,.46,rx+rw/2,.025,rz+rd/2,'#536c70','#a7b7b6');
    future.rotation.x=-Math.PI/2;
  }
  batch(floorParts);

  // Rails are supported by open portal frames; the high side is open to the overview camera.
  const gantry=group(scene), rail=group(scene);
  const railY=layout.rail.elevation_y_m;
  const [x0,x1]=layout.rail.loop_extents_x_m,[z0,z1]=layout.rail.loop_extents_z_m;
  for(const [x,z] of [[1.2,.9],[18.7,.9],[34.9,.9],[1.2,17.1],[34.9,17.1]]){
    box(gantry,x,.08,z,.49,.16,.49,m.frame);
    box(gantry,x,2.48,z,.17,4.88,.21,m.frame);
    box(gantry,x+.07,2.5,z,.04,4.9,.29,m.frameEdge);
    for(const y of [.5,.7,.9])box(gantry,x,y,z,.2,.08,.23,m.yellow);
  }
  for(const x of [1.2,34.9]){
    box(gantry,x,5,9,.15,.19,16.5,m.frame);
    for(const z of [z0,z1]){
      tube(gantry,V(x,4.95,z),V(x<10?x0:x1,railY+.13,z),.04,m.frameEdge);
    }
  }
  function railPiece(ax:number,az:number,bx:number,bz:number){
    const length=Math.hypot(ax-bx,az-bz),heading=-Math.atan2(bz-az,bx-ax);
    for(const [offset,h,w,mat] of [[.12,.18,.25,m.shadow],[.24,.075,.34,m.shiny],[.015,.055,.21,m.amber]] as const){
      const beam=box(rail,(ax+bx)/2,railY+offset,(az+bz)/2,length+.023,h,w,mat);
      beam.rotation.y=heading;
    }
  }
  const radius=.65;
  for(const [z,side] of [[z0,'north'],[z1,'south']] as const){
    if(!lineConfig.rails[side])continue;
    railPiece(x0+radius,z,x1-radius,z);
    for(let x=x0+.85;x<x1-radius;x+=1.35)box(rail,x,railY+.22,z,.065,.14,.38,m.trim);
  }
  if(lineConfig.rails.west)railPiece(x0,z0+radius,x0,z1-radius);
  if(lineConfig.rails.east)railPiece(x1,z0+radius,x1,z1-radius);
  const bays=parkingBays(parkedCount(lineConfig));
  for(const bay of lineConfig.rails.north?bays:[]){
    railPiece(bay.enterX,bay.mergeZ,bay.x,bay.z);
    railPiece(bay.x,bay.z,bay.exitX,bay.mergeZ);
    box(rail,bay.x,railY+.15,bay.z,.34,.09,.22,m.teal);
  }
  for(const [cx,cz,start] of [[x1-radius,z0+radius,-Math.PI/2],[x1-radius,z1-radius,0],[x0+radius,z1-radius,Math.PI/2],[x0+radius,z0+radius,Math.PI]]){
    for(let i=0;i<8;i++){
      const a=start+i*Math.PI/16,b=a+Math.PI/16;
      railPiece(cx+radius*Math.cos(a),cz+radius*Math.sin(a),cx+radius*Math.cos(b),cz+radius*Math.sin(b));
    }
  }
  batch(rail);batch(gantry);

  // The inside of the hall is visible at worker height. In overhead views the roof
  // and perimeter lift away together so the carrier route stays readable.
  const enclosure=group(scene);
  const [hallWidth,hallDepth]=layout.footprint_xz_m;
  const ceilingY=layout.vertical_zones_y_m.cleanroom[1];
  for(let x=1;x<hallWidth;x+=2) {
    for(const z of [0,hallDepth]) {
      box(enclosure,x,ceilingY/2,z,1.985,ceilingY,.1,m.shell);
      box(enclosure,x,.26,z===0?.06:z-.06,1.98,.07,.025,m.metal);
    }
  }
  for(let z=1;z<hallDepth;z+=2) {
    for(const x of [0,hallWidth]) {
      box(enclosure,x,ceilingY/2,z,.1,ceilingY,1.985,m.shell);
      box(enclosure,x===0?.06:x-.06,.26,z,.025,.07,1.98,m.metal);
    }
  }
  box(enclosure,hallWidth/2,ceilingY+.06,hallDepth/2,hallWidth,.12,hallDepth,m.white);
  for(let x=1;x<hallWidth;x+=3) {
    for(const z of [3,9,15]) {
      box(enclosure,x,ceilingY-.045,z,1.4,.08,.7,m.metal);
      for(let k=0;k<5;k++)box(enclosure,x,ceilingY-.092,z-.25+k*.12,1.27,.02,.047,m.trim);
      box(enclosure,x+1,ceilingY-.05,z,.13,.06,2.2,m.white);
    }
  }
  batch(enclosure);enclosure.visible=false;
  const utilities=group(scene),serviceEquipment:T.Group[]=[];
  const subfloor=layout.vertical_zones_y_m.subfab[0];
  const airTop=layout.vertical_zones_y_m.air_handling[1];
  box(utilities,18,subfloor+.08,9,36,.16,18,m.low);
  for(const z of [2,16])box(utilities,18,-.19,z,36,.38,.3,m.side);
  for(const machine of lineConfig.machines){
    const [w,d]=footprint(machine.kind);
    box(utilities,machine.x,-.1,machine.z,w,.2,d,m.floor);
  }
  for(const x of [2,10,18,26,34]){
    for(const z of [2,16])box(utilities,x,subfloor/2,z,.22,-subfloor,.22,m.base);
  }
  const pumpLabels:T.Vector3[]=[];
  for(const machine of lineConfig.machines.filter(m=>['deposition','etch_strip'].includes(m.kind)||processTool(m.kind)?.family==='vacuum')){
    const [w,d]=footprint(machine.kind),x=machine.x-w/2,z=machine.z-d/2;
    const pumpX=x+2, pumpZ=z+2, base=subfloor+.16;
    pumpLabels.push(V(pumpX,subfloor-.15,pumpZ));
    const pump=group(utilities);pump.userData.infoId='pump';serviceEquipment.push(pump);
    box(pump,pumpX,base+.13,pumpZ,1.7,.26,1.08,m.trim);
    box(pump,pumpX-.25,base+.57,pumpZ,1.04,.76,.83,m.teal);
    for(let i=0;i<6;i++)box(pump,pumpX-.68+i*.15,base+.58,pumpZ,.045,.81,.9,m.white);
    const motor=drum(pump,pumpX+.52,base+.53,pumpZ,.58,.67,.58,m.metal);
    motor.rotation.z=Math.PI/2;
    batch(pump);
    const chamberX=dockOf(machine).x-1.62;
    const chamberZ=machine.z+(machine.facing===180?1.2:-1.2);
    const a=V(pumpX,base+.93,pumpZ),b=V(pumpX,-1.45,pumpZ);
    const bend=V(chamberX,-1.45,pumpZ),riser=V(chamberX,-1.45,chamberZ);
    tube(utilities,a,b,.12,m.shiny);tube(utilities,b,bend,.12,m.shiny);
    tube(utilities,bend,riser,.12,m.shiny);tube(utilities,riser,V(chamberX,.43,chamberZ),.12,m.shiny);
    drum(utilities,b.x,-2.25,b.z,.33,.065,.33,m.teal);
    drum(utilities,riser.x,-.65,riser.z,.33,.065,.33,m.teal);
  }
  const ductY=airTop-.65;
  box(utilities,18,ductY,2,32,.54,.78,m.metal);
  for(const x of [4,14,25,31]){
    box(utilities,x,ductY-.08,3.35,.48,.38,2.7,m.side);
    box(utilities,x,(ductY+ceilingY)/2,4.6,.54,ductY-ceilingY,.54,m.side);
    const ffu=group(utilities);ffu.userData.infoId='ffu';serviceEquipment.push(ffu);
    box(ffu,x,ceilingY+.22,4.6,1.9,.44,1.36,m.white);
    drum(ffu,x,ceilingY+.46,4.6,.94,.09,.94,m.trim);
    for(let i=0;i<8;i++)box(ffu,x,ceilingY-.015,4.05+i*.15,1.72,.05,.07,m.teal);
    batch(ffu);
  }
  batch(utilities);utilities.visible=false;
  let viewMode:CameraView='iso';

  const centers=new Map<string,T.Vector3>(), roots:T.Group[]=[];
  const skins:T.Group[]=[];
  const tagAnchors=new Map<string,T.Vector3>();
  function toe(p:T.Object3D,x:number,z:number,w:number,d:number){
    box(p,x,.11,z,w+.08,.22,d+.08,m.trim);
    box(p,x,.24,z,w,.08,d,m.metal);
  }
  function module(p:T.Object3D,x:number,z:number,w:number,d:number,h:number,kind:'panel'|'hood'|'vent'='panel'){
    toe(p,x,z,w,d);
    box(p,x,h/2+.18,z,w,h-.16,d,m.side);
    box(p,x,h/2+.18,z+.026,w-.07,h-.18,d-.025,m.shell);
    box(p,x,h+.1,z,w+.025,.115,d+.035,m.white);
    const front=z+d/2+.018;
    const n=Math.max(1,Math.floor(w/.68));
    for(let i=0;i<n;i++){
      const px=x-w/2+(i+.5)*w/n;
      box(p,px,h*.53,front,w/n-.055,h*.84,.045,m.white);
      if(kind==='hood'){
        box(p,px,h*.65,front+.039,w/n-.13,h*.33,.04,m.trim);
        box(p,px,h*.65,front+.066,w/n-.21,h*.26,.023,m.darkGlass);
      }
      box(p,px+w/n*.27,h*.4,front+.055,.043,.18,.045,m.trim);
      if(kind==='vent'||i===0){
        for(let v=0;v<4;v++)box(p,px,h*.24+v*.065,front+.05,w/n*.62,.025,.028,m.trim);
      }
    }
    for(let i=0;i<Math.max(1,Math.floor(w/.9));i++){
      const px=x-w/2+.45+i*.9;
      box(p,px,h+.18,z,.69,.07,d*.55,m.side);
      for(let k=0;k<5;k++)box(p,px,h+.224,z-d*.19+k*d*.095,.52,.012,.035,m.trim);
    }
  }
  function tower(p:T.Object3D,x:number,y:number,z:number){
    drum(p,x,y+.18,z,.065,.36,.065,m.trim);
    for(const [j,mat] of [m.teal,m.lamp,m.amber].entries())drum(p,x,y+.39+j*.1,z,.12,.085,.12,mat);
  }
  function console(p:T.Object3D,x:number,z:number){
    box(p,x,.67,z,.16,1.25,.16,m.trim);
    box(p,x,1.3,z,.59,.44,.18,m.white);
    box(p,x,1.33,z+.095,.48,.29,.03,m.glass);
    box(p,x-.065,1.36,z+.116,.23,.022,.009,m.lamp);
    box(p,x,.99,z+.14,.5,.055,.34,m.side);
  }
  function processDrum(p:T.Object3D,x:number,z:number,w:number,h:number){
    box(p,x,.43,z,w+.12,.67,w+.08,m.side);
    drum(p,x,h*.64,z,w,h*.56,w,m.shell);
    drum(p,x,h*.9,z,w+.07,.13,w+.07,m.trim);
    drum(p,x,h*.96,z,w+.13,.1,w+.13,m.shiny);
    drum(p,x,h,z,w*.78,.08,w*.78,m.metal);
    drum(p,x,h+.055,z,w*.36,.06,w*.36,m.darkGlass);
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4;drum(p,x+Math.cos(a)*w*.44,h+.037,z+Math.sin(a)*w*.44,.07,.045,.07,m.trim);
    }
  }
  function rack(p:T.Object3D,w:number,d:number){
    toe(p,0,0,w,d);
    box(p,0,1.62,-d/2,w,3.1,.13,m.side);
    box(p,0,3.25,0,w+.11,.19,d+.08,m.white);
    for(const a of [-1,1])for(const b of [-1,1])box(p,a*(w/2-.065),1.68,b*(d/2-.065),.14,3.06,.14,m.metal);
    for(let c=0;c<=4;c++)box(p,-w/2+c*w/4,1.6,d/2,.09,2.87,.1,m.side);
    for(let row=0;row<4;row++){
      const y=.42+row*.68;box(p,0,y,0,w,.09,d,m.trim);
      for(let col=0;col<4;col++){
        if((col+row)%5===0)continue;
        const x=-w/2+(col+.5)*w/4;box(p,x,y+.22,0,.54,.36,.44,m.glass);
        box(p,x,y+.22,.22,.47,.26,.025,m.amber);
        box(p,x,y+.42,0,.22,.045,.22,m.metal);
      }
    }
  }

  const ports = new Map(lineConfig.machines.filter(m=>m.kind!=='scanner').map(m=>{const p=dockOf(m);return [m.id,V(p.x,p.y,p.z)];}));
  const movingArms=new Map<string,{group:T.Group; base:T.Vector3; elbow:T.Mesh; arm1:T.Mesh; arm2:T.Mesh; fork:T.Group}>();
  const indicators=new Map<string,T.Mesh>();
  function portAssembly(id:string,point:T.Vector3,frontSign:number) {
    const {full_width_m:w,full_height_m:h,depth_from_bolts_plane_m:d}=spec.load_port;
    // (x,z) is the FOUP's landing centre; the tall door plate stands behind it.
    const p=group(scene,id);roots.push(p);
    p.userData.infoId='port';
    p.position.set(point.x,0,point.z);
    if(frontSign<0)p.rotation.y=Math.PI;
    const faceZ=-d/2+.024;
    box(p,0,portHeight/2,.033,w,portHeight,d-.066,m.shell);
    box(p,0,portHeight-.028,.033,w,.056,d-.066,m.trim);
    for(const x of [-1,1])box(p,x*(w/2-.011),h/2,faceZ,.022,h,.048,m.white);
    box(p,0,h-.039,faceZ,w,.078,.048,m.white);
    box(p,0,.22,d/2-.006,.36,.22,.012,m.side);
    const pins=group(p);pins.name='locating_pins';
    for(const x of [-.14,.14])drum(pins,x,portHeight+.008,0,.025,.016,.025,m.metal);
    batch(p);
  }
  function supportArm(id:string,position:T.Vector3) {
    const arm=group(scene,id);arm.position.copy(position);roots.push(arm);
    arm.userData.infoId=id.endsWith(':vacuum')?'vacuum':machines[id.split(':')[0]].kind==='track'?'trackRobot':'efem';
    arm.name=arm.userData.infoId;
    const arm1=box(arm,0,0,0,.12,.065,1,m.metal);
    const arm2=box(arm,0,.035,0,.075,.047,1,m.shiny);
    const elbow=drum(arm,0,0,0,.17,.115,.17,m.teal);
    drum(arm,0,-.22,0,.33,.38,.33,m.metal);
    drum(arm,0,-.03,0,.22,.1,.22,m.trim);
    if(arm.userData.infoId==='trackRobot'){
      box(arm,0,-.25,0,.46,.11,.82,m.trim);
      for(const x of [-.16,.16])box(arm,x,-.18,0,.035,.07,.76,m.shiny);
    }else if(arm.userData.infoId==='vacuum'){
      drum(arm,0,-.35,0,.46,.13,.46,m.shiny);
    }
    const fork=group(arm);
    box(fork,0,0,-.085,.108,.009,.034,m.trim);
    for(const x of [-.046,.046])box(fork,x,0,0,.018,.009,.183,m.metal);
    arm1.name='upper_arm';arm2.name='forearm';elbow.name='elbow';fork.name='wafer_fork';
    movingArms.set(id,{group:arm,base:position,elbow,arm1,arm2,fork});
  }
  function buildMachine(machine:Machine){
    const {id,kind,x:cx,z:cz}=machine,[w,d]=footprint(kind);
    const body=group(scene,id);body.position.set(cx,0,cz);
    const south=machine.facing===180;
    if(south)body.rotation.y=Math.PI;
    roots.push(body);
    centers.set(id,V(cx,1.12,cz));
    const exposed=group(body), skin=group(body);
    exposed.name='process_modules';skin.name='outer_panels';
    skins.push(skin);
    const sign=south?-1:1, port=ports.get(id);
    const px=port ? (port.x-cx)*sign:0;
    let topHeight=2.55;
    if(kind==='stocker'){
      topHeight=3.65;
      // Open storage front, metal back enclosure and a vertical delivery mechanism.
      const r=group(exposed);
      r.position.set(0,0,-.48);rack(r,4.1,2.5);batch(r);
      module(skin,-1.75,1.52,.64,1.12,2.56,'vent');
      box(exposed,px,.6,2.0,.78,1.12,1.12,m.metal);
      box(exposed,px,.83,1.99,.84,.08,1.45,m.glass);
      for(let i=0;i<8;i++)box(exposed,px,.875,1.53+i*.14,.65,.045,.058,m.shiny);
      for(const side of [-1,1])box(exposed,side*2.07,1.75,-.46,.12,2.9,2.67,m.teal);
      if(port){
        const landingZ=(port.z-cz)*sign;
        box(exposed,px,.42,landingZ,.73,.84,.62,m.side);
        box(exposed,px,.87,landingZ,.82,.06,.72,m.trim);
      }
      faceText(exposed,'CARRIER STORAGE',2.06,.34,0,3.03,.859);
    } else if(kind==='deposition' || kind==='etch_strip'){
      const isEtch=kind==='etch_strip';
      // Cluster platform. The robot transfer corridor is visible between the modular shells.
      toe(exposed,0,-.1,w-.72,d-.62);
      box(exposed,px,.46,.8,1.36,.76,2.33,m.metal);
      box(exposed,px,.875,.49,1.11,.065,2.25,m.darkGlass);
      // The removable EFEM enclosure straddles the transfer corridor.
      for(const x of [px-.64,px+.64])box(skin,x,1.53,1.43,.08,1.25,2.18,m.shell);
      box(skin,px,2.17,1.43,1.36,.1,2.18,m.white);
      box(skin,px,1.81,2.49,1.28,.55,.07,m.glass);
      box(skin,px,1.41,2.49,1.28,.21,.07,m.shell);
      for(const offset of [-1,1]){
        const sideX=px+offset*1.62;
        module(skin,sideX,.23,1.51,2.12,1.53,'hood');
        processDrum(skin,sideX,-1.2,1.49,1.89);
        tube(skin,V(sideX,1.55,-.73),V(sideX,1.55,.24),.09,m.shiny);
        tube(skin,V(sideX,1.55,.24),V(sideX,1.83,.24),.09,m.shiny);
      }
      if(isEtch){
        processDrum(skin,px+1.75,1.47,1.12,1.69);
        processDrum(skin,px-1.71,1.47,1.12,1.69);
      }
      module(skin,-w/2+.9,-.65,1.2,2.72,2.1,'vent');
      module(skin,w/2-.85,-.65,1.13,2.55,2.28,'vent');
      if(!isEtch){
        faceText(skin,'PLASMA  /  CVD',1.18,.22,-w/2+.9,1.84,.739);
        box(skin,w/2-.84,2.53,-.73,.65,.42,1.28,m.metal);
        drum(skin,w/2-.84,2.83,-.73,.49,.18,.49,m.shiny);
      } else {
        faceText(skin,'PLASMA  /  ETCH',1.15,.22,w/2-.85,1.99,.664);
      }
      // Actual wafer passage has discrete low-profile open chamber stations in cutaway view.
      for(const [offset,length,dx] of (isEtch?[[1.65,.45,0],[3.55,.93,-1.45],[3.55,.93,0],[3.55,.93,1.45],[2.45,.93,1.65]]:[[1.65,.45,0],[3.55,.93,0]])){
        const insideZ=d/2+.5-offset;
        box(exposed,px-dx,.81,insideZ,.92,.29,length,m.side);
        drum(exposed,px-dx,.97,insideZ,.49,.035,.49,m.metal);
      }
      console(exposed,-w/2+.64,1.64);
      tower(skin,w/2-.8,2.39,-1.41);
      if(port){
        supportArm(id+':efem',V(port.x,1.01,port.z-sign*.95));
        supportArm(id+':vacuum',V(port.x,1.015,port.z-sign*2.45));
      }
    } else if(kind==='track'){
      topHeight=2.72;
      module(skin,-1.69,-.29,2.66,3.51,2.4,'hood');
      module(skin,1.55,-.29,2.88,3.51,2.4,'hood');
      for(const [ax,az] of [[px-.75,.75],[px+.85,.75],[-1.87,-.68]]){
        drum(exposed,ax,.83,az,.91,.15,.91,m.shiny);
        drum(exposed,ax,.936,az,.61,.07,.61,m.wafer);
        box(exposed,ax,.42,az,1.15,.75,1.54,m.side);
      }
      box(exposed,0,.74,1.8,w-.8,.13,.35,m.darkGlass);
      faceText(skin,'COAT   /   DEVELOP',1.77,.25,-1.62,2.10,1.515);
      console(exposed,2.73,1.78);
      tower(skin,-2.61,2.53,-1.66);
      if(port)supportArm(id+':efem',V(port.x,1.01,port.z-sign*.95));
    } else if(kind==='scanner') {
      topHeight=3.42;
      module(skin,-.58,-.19,3.24,3.7,2.98,'hood');
      module(skin,1.63,-.24,1.08,3.25,2.36,'vent');
      module(skin,-2.2,-.31,.58,2.77,2.48,'panel');
      box(skin,-.55,3.21,-.37,2.15,.31,1.97,m.shell);
      box(skin,-.48,3.4,-.4,1.61,.12,1.38,m.metal);
      faceText(skin,'IMMERSION SCANNER',2.50,.24,-.55,2.62,1.715);
      box(exposed,0,.48,-.2,2.86,.80,2.72,m.trim);
      drum(exposed,-.1,.91,-.2,1.21,.06,1.21,m.metal);
      drum(exposed,-.1,.96,-.2,.58,.04,.58,m.darkGlass);
      tower(skin,1.68,2.51,-1.5);
      // Short enclosed bridge mates the scanner with the track; no FOUP traffic runs through here.
      box(exposed,-2.93,.73,-.2,1.78,.24,.76,m.trim);
      box(skin,-2.93,1.36,-.2,1.78,.12,.84,m.side);
    }else{
      const tool=processTool(kind)!;
      const accent=tool.family==='wet'?m.teal:tool.family==='optics'?m.glass:tool.family==='polish'?m.amber:m.side;
      const height=tool.family==='thermal'?2.85:tool.family==='beam'?2.6:2.12;
      topHeight=height+.12;
      toe(exposed,0,0,w-.55,d-.65);
      box(exposed,px,.62,.96,1.25,.40,2.32,m.metal);
      for(const x of [-w/2+.65,w/2-.65])module(skin,x,-.25,1.04,3.57,height,'vent');
      box(skin,0,height-.08,-.85,w-1.5,.19,2.40,m.white);
      box(skin,0,height-.29,1.30,w-1.55,.36,.08,accent);
      box(skin,0,height-.31,-2.04,w-1.48,.28,.075,accent);
      box(skin,0,1.46,1.31,w-1.6,.61,.06,m.glass);
      box(exposed,0,.79,-.55,w-1.35,.25,1.66,m.shadow);
      if(tool.family==='wet'||tool.family==='polish'){
        topHeight=height+.35;
        for(const x of [-.81,.81]){
          drum(exposed,x,.97,-.65,1.15,.24,1.15,accent);
          drum(exposed,x,1.10,-.65,.67,.05,.67,m.shiny);
          tube(exposed,V(x,.99,-1.15),V(x,1.56,-1.15),.06,m.teal);
          if(tool.family==='polish'){
            drum(skin,x,height+.11,-.83,1.39,.23,1.39,m.trim);
            drum(skin,x,height+.25,-.83,1.03,.12,1.03,accent);
          }else{
            box(skin,x,height+.12,-.82,1.44,.25,1.52,m.teal);
            box(skin,x,height+.26,-.82,1.1,.06,1.24,m.glass);
          }
        }
      }else if(tool.family==='vacuum'){
        for(const x of [-.86,.86])processDrum(exposed,x,-.86,1.36,1.8);
        drum(exposed,0,.94,.85,.66,.2,.66,m.shiny);
        if(kind==='deep_etch'||kind==='pvd'){
          const tall=kind==='deep_etch'?.76:.38;
          topHeight=height+tall+.28;
          for(const x of [-.88,.88]){
            drum(skin,x,height+tall/2,-.95,1.56,tall,1.56,kind==='pvd'?m.shiny:m.trim);
            drum(skin,x,height+tall+.08,-.95,1.19,.16,1.19,m.metal);
            drum(skin,x,height+tall+.22,-.95,.58,.12,.58,kind==='pvd'?m.teal:m.amber);
          }
        }else if(kind==='ald'){
          topHeight=height+.45;
          box(skin,0,height+.15,-1.12,2.32,.36,.80,m.glass);
          for(const x of [-.78,-.26,.26,.78]){
            drum(skin,x,height+.34,-1.11,.27,.22,.27,m.shiny);
            tube(skin,V(x,height+.28,-.47),V(x,height+.27,-.98),.04,m.amber);
          }
        }else{
          topHeight=height+.40;
          box(skin,0,height+.2,-.91,1.68,.42,1.38,m.trim);
          for(let x=-.64;x<=.64;x+=.16)box(skin,x,height+.42,-.91,.038,.055,1.08,m.shiny);
        }
      }else if(tool.family==='thermal'||tool.family==='beam'){
        box(exposed,0,1.41,-.77,w-1.52,.62,.92,m.trim);
        for(const x of [-.75,0,.75])box(exposed,x,1.43,-.29,.50,.30,.034,m.orange);
        if(tool.family==='thermal')drum(exposed,0,2.31,-.8,1.42,.88,1.42,m.shiny);
        else tube(exposed,V(-1.64,1.32,-.8),V(1.64,1.32,-.8),.18,m.shiny);
      }else{
        for(const x of [-.91,.91])box(exposed,x,1.34,-.9,.18,1.12,1.35,m.metal);
        box(exposed,0,1.87,-.56,2.02,.22,.54,m.trim);
        drum(exposed,0,1.48,-.56,.49,.61,.49,m.shiny);
        if(kind==='probe'){
          drum(skin,0,height+.17,-.84,1.34,.34,1.34,m.trim);
          drum(skin,0,height+.37,-.84,.84,.12,.84,m.shiny);
          topHeight=height+.44;
        }else{
          const coupled=kind==='bond';
          for(const x of coupled?[-.65,.65]:[0]){
            box(skin,x,height+.24,-.8,1.06,.5,1.33,coupled?m.side:m.glass);
            box(skin,x,height+.56,-.8,.77,.14,1.04,coupled?m.metal:m.teal);
          }
          topHeight=height+.64;
        }
      }
      drum(exposed,0,.94,-.55,.52,.022,.52,m.wafer);
      faceText(skin,tool.label,w-1.57,.23,0,height-.28,1.346);
      console(exposed,-w/2+.65,1.47);
      tower(skin,w/2-.65,height-.12,-1.28);
      if(port){
        supportArm(id+':efem',V(port.x,1.01,port.z-sign*.95));
        if(tool.family==='vacuum')supportArm(id+':vacuum',V(port.x,1.015,port.z-sign*2.45));
      }
    }
    const front=d/2+.08, lampX=kind==='stocker'?1.73:Math.min(w/2-.56,1.54);
    box(exposed,lampX,1.26,front-.15,.25,.2,.24,m.trim);
    const led=box(body,lampX,1.27,front,.19,.058,.055,m.lamp);
    indicators.set(id,led);
    tagAnchors.set(id,V(cx,topHeight+.47,cz));
    if(port&&kind!=='stocker')portAssembly(id,port,sign);
    batch(exposed);batch(skin);
  }
  lineConfig.machines.forEach(buildMachine);

  function buildVehicle(bay:typeof bays[number],index:number){
  const id=index===0?'oht':'oht-'+(index+1);
  names[id]=['OHT-'+String(index+1).padStart(2,'0'),'천장 운송차'];
  const vehicle=group(scene,id);roots.push(vehicle);
  vehicle.position.set(bay.x,railY,bay.z);
  const cart=group(vehicle);
  box(cart,0,-.08,0,.86,.2,.47,m.trim);
  for(const x of [-.3,.3])for(const z of [-.23,.23]){
    const wheel=drum(cart,x,.04,z,.17,.1,.17,m.black);wheel.rotation.x=Math.PI/2;
  }
  box(cart,0,-.24,0,.92,.22,.63,m.orange);
  box(cart,0,-.36,0,.77,.07,.59,m.shadow);
  for(const x of [-.41,.41]){
    box(cart,x,-.53,0,.12,.35,.61,m.amber);
    box(cart,x,-.68,0,.13,.045,.56,m.trim);
  }
  for(const z of [-.32,.32]){
    box(cart,0,-.23,z,.46,.11,.018,m.ink);
    box(cart,-.22,-.23,z+.003,.09,.049,.021,m.lamp);
  }
  batch(cart);
  const hoist=group(vehicle);
  for(const x of [-.13,.13])box(hoist,x,-.5,0,.021,1,.035,m.trim);
  const claw=box(vehicle,0,-.54,0,.33,.08,.25,m.metal);
  cart.name='carriage';hoist.name='hoist_belts';claw.name='gripper';
  tagAnchors.set(id,V(bay.x,railY+.38,bay.z));
  return {id,vehicle,hoist,claw};
  }
  const vehicles=bays.map(buildVehicle);
  const podGeos=new Map<string,{root:T.Group;door:T.Group;wafer:T.Mesh}>();
  function pod(id:string){
    const root=group(scene),shell=group(root),door=group(root);
    shell.name='carrier_shell';door.name='front_door';
    root.userData.infoId='foup';roots.push(root);
    const s=spec.carrier,w=s.width_m,d=s.depth_m,h=s.height_m;
    box(shell,0,.025,0,w,.05,d,m.black);
    box(shell,0,h*.5,d*.45,w*.98,h*.81,d*.1,m.amber);
    for(const sign of [-1,1]){
      box(shell,sign*w*.46,h*.53,0,w*.08,h*.83,d*.93,m.amber);
      for(let i=0;i<8;i++)box(shell,sign*(w/2-.0095),.063+i*.028,0,.019,.009,d*.75,m.shadow);
    }
    box(shell,0,h-.032,0,w*.96,.036,d*.95,m.amber);
    box(shell,0,h-.0095,0,w*.56,.019,d*.54,m.trim);
    box(door,0,h*.51,-d/2+.021,w*.96,h*.85,.025,m.amber);
    box(door,0,h*.51,-d/2+.006,w*.72,h*.61,.012,m.glass);
    // The full-size slot tray uses the specified 10 mm pitch; the featured wafer is an independent mesh.
    const slotHeights:number[]=[];
    for(let i=0;i<s.capacity_wafers;i++){
      const support=box(shell,-.159,.045+i*s.slot_pitch_m,0,.018,.003,.22,m.metal);
      slotHeights.push(support.position.y);
      box(shell,.159,.045+i*s.slot_pitch_m,0,.018,.003,.22,m.metal);
    }
    batch(shell);batch(door);
    const wafer=drum(scene,0,1,0,s.wafer_diameter_m,.003,s.wafer_diameter_m,m.wafer);
    if(podGeos.size===0){
      const diameter=new T.Box3().setFromObject(wafer).getSize(new T.Vector3()).x;
      const pitch=slotHeights[1]-slotHeights[0];
      const firstPort=ports.get(lineConfig.machines.find(m=>m.kind==='deposition')?.id??lineConfig.home)!;
      annotation(`웨이퍼 Ø${Math.round(diameter*1000)} mm · 슬롯 ${Math.round(pitch*1000)} mm`,firstPort.clone().add(V(0,.48,0)));
    }
    const result={root,door,wafer};podGeos.set(id,result);return result;
  }
  const selectedRing=group(scene);
  const ringGeom=geo(new T.RingGeometry(.33,.35,40));
  const ringMat=new T.MeshBasicMaterial({color:'#37dfbc',side:T.DoubleSide});
  materials.add(ringMat);
  const ring=new T.Mesh(ringGeom,ringMat);ring.rotation.x=-Math.PI/2;selectedRing.add(ring);
  selectedRing.visible=false;

  const signRoot=group(scene);
  signRoot.position.z=1.12;
  box(signRoot,3.25,.39,17.34,.1,.78,.11,m.metal);
  box(signRoot,6.14,.39,17.34,.1,.78,.11,m.metal);
  box(signRoot,4.7,1.09,17.34,3.41,.83,.135,m.trim);
  let productLabel='';let signFace:T.Mesh|undefined;
  function setProduct(name:string) {
    if(productLabel===name)return;
    productLabel=name;
    if(signFace){
      const mat=signFace.material as T.MeshBasicMaterial;
      if(mat.map){textures.delete(mat.map);mat.map.dispose();}
      materials.delete(mat);mat.dispose();signRoot.remove(signFace);
    }
    signFace=faceText(signRoot,name,3.19,.64,4.7,1.11,17.414,'#d8f5e9','#224844');
  }
  setProduct('패터닝 기준 라인');

  const markers=new Map<string,HTMLDivElement>();
  let selected:string|null=null,hovered:string|null=null,labelsOn=true,dimensionsOn=false,cutaway=false;
  let dirty=true,latest:SceneFrame|undefined;
  const dimensionsLayer=group(scene);dimensionsLayer.visible=false;
  type Annotation={element:HTMLDivElement;position:T.Vector3};
  const dimensionLabels:Annotation[]=[];
  function label(text:string){
    const el=document.createElement('div');el.textContent=text;
    Object.assign(el.style,{position:'absolute',padding:'3px 6px',background:'var(--navy-overlay)',color:'var(--on-navy)',
      border:'1px solid var(--navy-line)',borderRadius:'3px',font:'600 9px/1.2 "Segoe UI",sans-serif',
      letterSpacing:'.06em',whiteSpace:'nowrap',willChange:'transform',boxSizing:'border-box'});
    labels.append(el);return el;
  }
  for(const id of tagAnchors.keys())markers.set(id,label(names[id][0]));
  function annotation(txt:string,pos:T.Vector3){
    const el=label(txt);el.style.color='#ffdfab';el.style.borderColor='#d6a05e';el.style.display='none';
    dimensionLabels.push({element:el,position:pos});
  }
  const utilityLabels=[
    {element:label('공조층 · 급기 덕트 / 팬필터'),position:V(25,ductY+.4,3)},
    {element:label('생산층 · OHT 레일'),position:V(34,railY+.25,10.5)},
    ...pumpLabels.slice(-1).map(position=>({element:label('서브팹 · 진공 펌프 / 진공 배관'),position}))
  ];
  function dimension(a:T.Vector3,b:T.Vector3,end:T.Vector3,caption:string){
    line(dimensionsLayer,[a,b],'#926224');
    for (const point of [a,b])line(dimensionsLayer,[point.clone().sub(end),point.clone().add(end)],'#926224');
    annotation(caption,a.clone().lerp(b,.5));
  }
  dimension(V(0,.14,18.9),V(36,.14,18.9),V(0,0,.16),'36.0 m');
  dimension(V(36.8,.14,0),V(36.8,.14,18),V(.16,0,0),'18.0 m');
  dimension(V(1.55,.03,7.5),V(1.55,railY,7.5),V(.16,0,0),'레일 4.00 m');
  for(const [id,pos] of ports){
    line(dimensionsLayer,[V(pos.x,.03,pos.z),V(pos.x,railY,pos.z)],'#926224');
  }
  let width=0,height=0;
  const projection=new T.Vector3();
  function place(el:HTMLElement,world:T.Vector3) {
    projection.copy(world).project(cameraRig.camera);
    const visible=projection.z>-1&&projection.z<1&&Math.abs(projection.x)<1.05&&Math.abs(projection.y)<1.05;
    el.style.display=visible?'block':'none';
    if(visible)el.style.transform=`translate(${(projection.x+1)*width/2}px,${(1-projection.y)*height/2}px) translate(-50%, -100%)`;
  }
  const assigned=new Set(lineConfig.steps.map(s=>s.station));
  function isDisabled(id:string){return assigned.size>0&&!!machines[id]&&machines[id].kind!=='stocker'&&!assigned.has(id);}
  const previousTagStyle=new Map<string,string>();
  function updateMarkers() {
    for(const [id,el] of markers){
      const active=hovered===id||selected===id, muted=isDisabled(id);
      const parked=id.startsWith('oht')&&!latest?.vehicles?.[id==='oht'?0:Number(id.split('-')[1])-1]?.busy;
      if(viewMode==='entry'||!labelsOn||dimensionsOn||(!active&&(cameraRig.camera.zoom>3.5||width<490&&(muted||parked)))){
        el.style.display='none';continue;
      }
      const state=latest?.equipment?.[id]?.status??'idle';
      const style=[active,muted,state].join('|');
      if(previousTagStyle.get(id)!==style){
        const desc=muted?' · 미사용':state==='processing'?' · 가동':'';
        el.textContent=names[id][0]+(active?'  '+names[id][1]:'')+desc;
        el.style.color=active?'var(--navy)':muted?'var(--navy-muted)':'var(--on-navy)';
        el.style.background=active?'var(--active)':'var(--navy-overlay)';
        el.style.borderColor=active?'var(--accent)':state==='processing'?'#78dfbe':'var(--navy-line)';
        el.style.opacity=muted?'.72':'1';el.style.zIndex=active?'2':'1';
        previousTagStyle.set(id,style);
      }
      place(el,tagAnchors.get(id)!);
    }
    for(const d of dimensionLabels){
      if(dimensionsOn)place(d.element,d.position);else d.element.style.display='none';
    }
    for(const entry of utilityLabels){
      if(viewMode==='services')place(entry.element,entry.position);else entry.element.style.display='none';
    }
  }
  function setSelection(id:string|null){selected=id;dirty=true;}
  const editorOrigins=roots.filter(root=>machines[root.userData.stationId?.split(':')[0]]).map(root=>({
    root,position:root.position.clone(),rotation:root.rotation.y,machine:machines[root.userData.stationId.split(':')[0]],
  }));
  function setDraftPositions(draft:Machine[]){
    const poses=new Map(draft.map(machine=>[machine.id,machine]));
    for(const {root,position,rotation,machine} of editorOrigins){
      const pose=poses.get(machine.id);if(!pose)continue;
      const reverse=pose.facing===machine.facing?1:-1;
      root.position.set(pose.x+(position.x-machine.x)*reverse,position.y,pose.z+(position.z-machine.z)*reverse);
      root.rotation.y=rotation+(reverse===1?0:Math.PI);
    }
    for(const {id,x,z} of draft){
      const center=centers.get(id),anchor=tagAnchors.get(id);
      if(center)center.set(x,center.y,z);
      if(anchor)anchor.set(x,anchor.y,z);
    }
    renderer.shadowMap.needsUpdate=true;
    dirty=true;
  }
  function setCutaway(enabled:boolean){
    cutaway=enabled;
    enclosure.visible=viewMode==='entry'||(viewMode==='floor'&&!enabled);
    for(const skin of skins)skin.visible=!enabled;
    floorParts.visible=viewMode!=='services'&&(!enabled||cameraRig.camera.position.y>=0);
    gantry.visible=!enabled;
    renderer.shadowMap.needsUpdate=true;dirty=true;
  }
  function setDimensions(enabled:boolean){
    dimensionsOn=enabled;dimensionsLayer.visible=enabled;dirty=true;
  }
  function linkArm(part:T.Mesh,a:T.Vector3,b:T.Vector3){
    const d=b.clone().sub(a);
    part.scale.z=d.length();
    part.position.copy(a).lerp(b,.5);
    part.quaternion.setFromUnitVectors(V(0,0,1),d.normalize());
  }
  function setArm(arm:ReturnType<typeof movingArms.get>,world?:Point){
    if(!arm)return;
    const origin=arm.group.position.copy(arm.base);
    if(world&&arm.group.userData.infoId==='trackRobot'){
      // The track shuttle accompanies the wafer between modules and the scanner interface.
      const dx=world.x-origin.x,dz=world.z-origin.z;
      const ratio=Math.max(0,1-.83/Math.max(.83,Math.hypot(dx,dz)));
      origin.x+=dx*ratio;origin.z+=dz*ratio;
    }
    const target=world?V(world.x-origin.x,world.y-origin.y-.009,world.z-origin.z):V(.28,-.015,.24);
    const reach=Math.max(.31,Math.hypot(target.x,target.z)),offset=Math.min(.32,reach*.35);
    const mid=V(target.x*.5+target.z*offset/reach,0,target.z*.5-target.x*offset/reach);
    linkArm(arm.arm1,V(0,0,0),mid);linkArm(arm.arm2,mid,target);
    arm.elbow.position.copy(mid);
    arm.fork.position.copy(target);arm.fork.rotation.y=Math.atan2(target.x-mid.x,target.z-mid.z);
  }
  // Assemble catalogue objects from the same station, port and robot nodes used during playback.
  function copyEquipmentModel(id:string) {
    const component:Record<string,string>={load_port:'port',efem_robot:'efem',vacuum_robot:'vacuum',track_robot:'trackRobot',foup:'foup'};
    const info=component[id];
    const origin=roots.find(r=>info?r.userData.infoId===info:r.userData.stationId===id&&!r.userData.infoId);
    if(!origin)throw new Error('장비 모델 없음: '+id);
    scene.updateMatrixWorld(true);
    const local=origin.matrixWorld.clone().invert();
    if(id==='foup')local.premultiply(new T.Matrix4().makeRotationY(Math.PI));
    const result=new T.Group();result.name=id;
    for(const part of roots){
      const parentId=part.userData.stationId?.split(':')[0];
      if(part!==origin&&(info||parentId!==id))continue;
      const clone=part.clone(true);
      new T.Matrix4().multiplyMatrices(local,part.matrixWorld).decompose(clone.position,clone.quaternion,clone.scale);
      clone.name=part.userData.infoId??'assembly';
      result.add(clone);
    }
    return result;
  }
  const dimMaterials=new Map<T.Material,T.Material>();
  for(const root of roots.filter(root=>isDisabled(root.userData.stationId?.split(':')[0]))){
    root.traverse(obj=>{
      if(!(obj instanceof T.Mesh)||Array.isArray(obj.material))return;
      const original=obj.material as T.Material;
      let muted=dimMaterials.get(original);
      if(!muted){
        muted=original.clone();
        if(muted instanceof T.MeshStandardMaterial||muted instanceof T.MeshBasicMaterial)muted.color.multiplyScalar(.39);
        materials.add(muted);dimMaterials.set(original,muted);
      }
      obj.material=muted;
    });
  }
  let followedId: string | null = null;
  function update(state:SceneFrame, trackedCarrierId=state.carriers[0]?.id, follow=false){
    latest=state;trackedId=trackedCarrierId;dirty=true;
    const positions=state.vehicles??[state.vehicle];
    for(const [i,v] of positions.entries()){
      const item=vehicles[i];if(!item)continue;
      const {id,vehicle,hoist,claw}=item;
      vehicle.position.set(v.position.x,v.position.y,v.position.z);
      vehicle.rotation.y=v.rotationY;
      tagAnchors.get(id)!.copy(vehicle.position).y+=.38;
      const localY=v.hoistY-v.position.y,rootY=-.37;
      hoist.position.y=rootY;hoist.scale.y=Math.max(.025,rootY-localY);
      claw.position.y=localY+.04;
    }
    for(const arm of movingArms.values())setArm(arm);
    selectedRing.visible=false;
    for(const carrier of state.carriers){
      const item=podGeos.get(carrier.id)??pod(carrier.id);
      const {position:p,wafer}=carrier;
      item.root.position.set(p.x,p.y,p.z);
      item.root.rotation.y=carrier.rotationY??(carrier.station==='etch_strip'?Math.PI:0);
      item.door.position.set(...doorOffset(carrier.doorOpen));
      item.wafer.position.set(wafer.position.x,wafer.position.y,wafer.position.z);
      if(follow && carrier.id === trackedCarrierId) {
        if(followedId !== carrier.id)cameraRig.focus(item.wafer.position, 3.5);
        cameraRig.follow(item.wafer.position);
      }
      item.wafer.visible=(wafer.owner!=='slot'||cutaway||carrier.doorOpen>.8);
      if(carrier.station && wafer.owner!=='slot'){
        const suffix=wafer.owner==='vacuum_robot'?':vacuum':':efem';
        if(['atmosphere_robot','vacuum_robot','track_robot'].includes(wafer.owner)){
          setArm(movingArms.get(carrier.station+suffix),wafer.position);
        }
        if(cutaway&&carrier.id===trackedCarrierId){
          selectedRing.visible=true;selectedRing.position.copy(item.wafer.position);selectedRing.position.y+=.007;
        }
      }
    }
    followedId = follow ? trackedCarrierId : null;
    for(const [id,led] of indicators){
      const status=state.equipment?.[id]?.status;
      led.material=isDisabled(id)?m.shadow:status==='processing'?m.amber:status==='reserved'?m.yellow:m.lamp;
    }
  }
  const ray=new T.Raycaster(),pointer=new T.Vector2();
  const hoverTip=createEquipmentHover(host,scene);
  let cursor:{clientX:number;clientY:number}|null=null;
  function pick(e:{clientX:number;clientY:number}){
    const bounds=canvas.getBoundingClientRect();
    pointer.set(2*(e.clientX-bounds.left)/bounds.width-1,1-2*(e.clientY-bounds.top)/bounds.height);
    ray.setFromCamera(pointer,cameraRig.camera);
    for(const hit of ray.intersectObjects([...roots,...(utilities.visible?serviceEquipment:[]),gantry,rail,enclosure,floorParts],true)){
      if(renderer.clippingPlanes.some(plane=>plane.distanceToPoint(hit.point)<0))continue;
      let obj:T.Object3D|null=hit.object,target:T.Object3D|null=null,shown=true;
      while(obj){
        shown=shown&&obj.visible;
        if(obj.userData.stationId||obj.userData.infoId)target=obj;
        obj=obj.parent;
      }
      if(shown)return target;
    }
    return null;
  }
  let downX=0,downY=0;
  function refreshHover(){
    const target=cursor?pick(cursor):null;
    hovered=target?.userData.stationId?.split(':')[0]??null;
    canvas.style.cursor=target?'pointer':'grab';
    if(!target||!cursor){hoverTip.hide();return;}
    const rect=host.getBoundingClientRect();
    const kind=hovered?.startsWith('oht')?'oht':machines[hovered??'']?.kind??hovered;
    hoverTip.show(target,target.userData.infoId??kind,cursor.clientX-rect.left,cursor.clientY-rect.top);
  }
  function pointerDown(e:PointerEvent){downX=e.clientX;downY=e.clientY;pointerLeave();}
  function pointerUp(e:PointerEvent){
    if(e.button!==0||Math.hypot(e.clientX-downX,e.clientY-downY)>4)return;
    cursor=e.pointerType==='mouse'?{clientX:e.clientX,clientY:e.clientY}:null;
    dirty=true;
    const id=pick(e)?.userData.stationId?.split(':')[0];if(id){setSelection(id);onSelect?.(id);}
  }
  function pointerMove(e:PointerEvent){
    if(e.buttons||e.pointerType==='touch'){pointerLeave();return;}
    cursor={clientX:e.clientX,clientY:e.clientY};dirty=true;
  }
  function pointerLeave(){cursor=null;hovered=null;hoverTip.hide();dirty=true;}
  canvas.addEventListener('pointerdown',pointerDown);
  canvas.addEventListener('pointerup',pointerUp);
  canvas.addEventListener('pointermove',pointerMove);
  canvas.addEventListener('pointerleave',pointerLeave);
  function resize(){
    width=Math.max(1,host.clientWidth);height=Math.max(1,host.clientHeight);
    renderer.setSize(width,height,false);cameraRig.resize(width,height);dirty=true;
  }
  const observer=new ResizeObserver(resize);
  observer.observe(host);resize();
  function change(){dirty=true;}
  orbit.addEventListener('change',change);
  const diagnostics=new URLSearchParams(location.search).has('diagnostics');
  let trackedId:string|undefined;
  const undersidePlane=new T.Plane(new T.Vector3(0,1,0),-.85);
  const undersideClipping=[undersidePlane],noClipping:T.Plane[]=[];
  const undersideLight=new T.DirectionalLight(0xc8e5ed,1.25);
  undersideLight.position.set(9,-24,10);
  undersideLight.visible=false;
  scene.add(undersideLight);
  function render(){
    orbit.update();
    if(!dirty)return;
    const below=cameraRig.camera.position.y<0;
    const underside=cutaway&&below&&viewMode!=='services';
    if(cutaway&&viewMode!=='services')floorParts.visible=!below;
    const tracked=underside||diagnostics?latest?.carriers.find(c=>c.id===trackedId):undefined;
    // Section the chassis below the active transfer plane so the wafer is visible from underneath.
    undersidePlane.constant=followedId&&tracked?-(tracked.wafer.position.y-.025):-.85;
    renderer.clippingPlanes=underside?undersideClipping:noClipping;
    undersideLight.visible=underside;
    if(cursor){scene.updateMatrixWorld(true);cameraRig.camera.updateMatrixWorld();refreshHover();}
    renderer.render(scene,cameraRig.camera);updateMarkers();dirty=false;
    if(diagnostics){
      canvas.dispatchEvent(new CustomEvent('fab:frame',{bubbles:true,detail:{
        time:latest?.time??0,vehicle:latest?.vehicle.position,carrier:tracked?.id,wafer:tracked?.wafer.position,owner:tracked?.wafer.owner,
        target:orbit.target.toArray(),azimuth:orbit.getAzimuthalAngle(),elevation:Math.PI/2-orbit.getPolarAngle(),
        cutaway,floorVisible:floorParts.visible,clippedBelowY:underside?-undersidePlane.constant:null,
        view:viewMode,product:productLabel,drawCalls:renderer.info.render.calls,
        vehicles:latest?.vehicles,machines:Object.fromEntries(centers)
      }}));
    }
  }
  renderer.shadowMap.needsUpdate=true;
  renderer.setAnimationLoop(render);
  function setView(mode:CameraView){
    viewMode=mode;
    followedId=null;
    enclosure.visible=mode==='entry'||(mode==='floor'&&!cutaway);
    utilities.visible=mode==='services';
    floorParts.visible=mode!=='services'&&(!cutaway||cameraRig.camera.position.y>=0);
    grid.position.y=mode==='services'?subfloor-.02:-.82;
    cameraRig.view(mode);
    dirty=true;
  }
  function focus(id:string){
    const at=vehicles.find(v=>v.id===id)?.vehicle.position??centers.get(id);
    if(at)cameraRig.focus(at,id.startsWith('oht')?4.5:9);
    else if(id==='future_metrology')cameraRig.focus(V(rx+rw/2,1,rz+rd/2),11);
    dirty=true;
  }
  function dispose(){
    renderer.setAnimationLoop(null);observer.disconnect();orbit.dispose();hoverTip.dispose();
    canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointerup',pointerUp);
    canvas.removeEventListener('pointermove',pointerMove);canvas.removeEventListener('pointerleave',pointerLeave);
    scene.traverse(obj=>{if(obj instanceof T.InstancedMesh)obj.dispose();});
    geometries.forEach(g=>g.dispose());materials.forEach(mat=>mat.dispose());textures.forEach(tex=>tex.dispose());
    sun.shadow.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();labels.remove();
  }
  return { update,setView,focus,setCutaway,setSelection,setDimensions,setDraftPositions,setProduct,copyEquipmentModel,
    zoom(factor:number){cameraRig.zoom(factor);dirty=true;},
    setLabels(enabled:boolean){labelsOn=enabled;dirty=true;},dispose };
}
