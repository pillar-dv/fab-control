import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import type {CampusLoad,CampusMove} from './campus';
import {campusSize,campusZones,isExternal,isFabSite,type CampusZone} from './campus-layout';

const zones=Object.keys(campusZones) as CampusZone[];
const navy=0x1c3659,street=0x879bb0,ground=0xb9cddd;
const colors:Record<CampusLoad,number>={truck:0x286ba6,cart:0x3a8c74,foup:0xed993c,tray:0x8360bb,box:0xbb7540};
const crossRoads=[-174,-49,39,145,172],serviceRoads=[-286,-188,-8,115,280];
export type CampusView='map'|'top'|'network'|'facility';

function connect(from:CampusZone,to:CampusZone){
  function dock(id:CampusZone){
    const [x,z]=campusZones[id].position;
    const apron=z+campusZones[id].size[1]/2+6;
    return {x,z:apron,lane:crossRoads.find(road=>road>=apron)??crossRoads.at(-1)!};
  }
  const a=dock(from),b=dock(to),midpoint=(a.x+b.x)/2;
  const junction=serviceRoads.reduce((best,road)=>Math.abs(road-midpoint)<Math.abs(best-midpoint)?road:best);
  const turns=a.lane===b.lane?[]:[{x:junction,z:a.lane},{x:junction,z:b.lane}];
  const points=[a,{x:a.x,z:a.lane},...turns,{x:b.x,z:b.lane},b];
  const route=new THREE.CurvePath<THREE.Vector3>();
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(a.x!==b.x||a.z!==b.z)route.add(new THREE.LineCurve3(new THREE.Vector3(a.x,0,a.z),new THREE.Vector3(b.x,0,b.z)));
  }
  return route;
}

export function createCampusScene(host:HTMLElement,select:(zone:CampusZone)=>void){
  const renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  const canvas=renderer.domElement;
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label','반도체 캠퍼스 건물과 이송 경로');
  host.append(canvas);
  const labels=document.createElement('div');
  labels.className='campus-map-labels';
  host.append(labels);
  const scene=new THREE.Scene();
  scene.background=new THREE.Color(0xe7eff8);
  scene.add(new THREE.HemisphereLight(0xf2f7ff,0x8495a9,2.2));
  const sun=new THREE.DirectionalLight(0xfff6e8,2.2);
  sun.position.set(-320,480,420);scene.add(sun);
  const camera=new THREE.PerspectiveCamera(37,1,1,2400);
  const controls=new OrbitControls(camera,canvas);
  controls.minDistance=43;controls.maxDistance=1450;controls.maxPolarAngle=Math.PI/2-.09;
  const geometry=new THREE.BoxGeometry(1,1,1);
  const round=new THREE.CylinderGeometry(.5,.5,1,16);
  const paints=new Map<number,THREE.MeshStandardMaterial>();
  function paint(color:number){
    let mat=paints.get(color);
    if(!mat){mat=new THREE.MeshStandardMaterial({color,roughness:.82});paints.set(color,mat);}
    return mat;
  }
  function box(parent:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:number){
    const mesh=new THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>(geometry,paint(color));
    mesh.scale.set(w,h,d);mesh.position.set(x,y,z);parent.add(mesh);return mesh;
  }
  function drum(parent:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,color:number){
    const mesh=box(parent,x,y,z,w,h,w,color);mesh.geometry=round;return mesh;
  }
  function rooftopModule(parent:THREE.Group,x:number,y:number,z:number,w:number,d:number){
    box(parent,x,y+.15,z,w+1,.35,d+1,0x9aaebc);
    box(parent,x,y+1.08,z,w,1.86,d,0xa4b8c6);
    box(parent,x,y+2.02,z,w+.28,.23,d+.28,0xdae5eb);
    for(let j=-2;j<=2;j++)box(parent,x,y+1.18+j*.22,z+d/2+.06,w*.83,.1,.1,0x537289);
    for(const offset of [-.24,.24]){
      const px=x+offset*w;
      drum(parent,px,y+2.17,z,Math.min(w*.39,d*.7),.19,0x526f82);
      box(parent,px,y+2.31,z,Math.min(w*.37,d*.65),.11,.2,0xadbdc8).rotation.y=.5;
    }
  }
  function facade(parent:THREE.Group,w:number,d:number,h:number,industrial:boolean){
    const bays=Math.max(3,Math.floor(w/11));
    const spacing=w/bays;
    box(parent,0,h*.18,d/2+.058,w-.3,.18,.14,0xa9bccd);
    for(let i=0;i<bays;i++){
      const x=-w/2+(i+.5)*spacing;
      box(parent,x,h*.58,d/2+.07,spacing*.65,h*(industrial?.11:.2),.16,0xa9bfd0);
      box(parent,x,h*.58,d/2+.17,spacing*.59,h*(industrial?.085:.157),.07,0x6a91a7);
      box(parent,x,h*.58,d/2+.215,.18,h*(industrial?.085:.157),.08,0xb3c6d6);
      if(i>0)box(parent,x-spacing*.5,h*.51,d/2+.08,.12,h-.5,.13,0xa2b5c4);
    }
    for(const side of [-1,1]){
      box(parent,side*(w/2+.065),h-.66,0,.13,.19,d-.29,0xb2c6d6);
      for(let z=-d*.39;z<d*.44;z+=6.5)box(parent,side*(w/2+.07),h*.57,z,.18,h*.73,.13,0xb3c5d3);
    }
  }
  const decorBatches:THREE.InstancedMesh[]=[];
  function batchDecor(parent:THREE.Group,keep:readonly THREE.Mesh[]=[]){
    const byStyle=new Map<string,THREE.Mesh[]>();
    for(const item of parent.children){
      if(!(item instanceof THREE.Mesh)||keep.includes(item)||Array.isArray(item.material))continue;
      const key=item.geometry.id+'/'+item.material.id;
      const items=byStyle.get(key);
      if(items)items.push(item);
      else byStyle.set(key,[item]);
    }
    for(const items of byStyle.values()){
      if(items.length<3)continue;
      const batch=new THREE.InstancedMesh(items[0].geometry,items[0].material,items.length);
      items.forEach((item,index)=>{
        item.updateMatrix();
        batch.setMatrixAt(index,item.matrix);
        item.removeFromParent();
      });
      parent.add(batch);
      decorBatches.push(batch);
    }
  }
  const {width,depth}=campusSize;
  box(scene,0,-4,0,width+2,6,depth+2,navy);
  box(scene,0,-1,0,width,1,depth,ground);
  const grid=new THREE.GridHelper(depth,24,0xa0b6cd,0xabc0d5);
  grid.scale.x=width/depth;grid.position.y=-.42;scene.add(grid);
  for(const z of crossRoads){
    box(scene,0,-.22,z,width-18,.25,12,street);
    for(let x=-278;x<288;x+=21)box(scene,x,.01,z,8,.06,.18,0xe7eff7);
  }
  for(const x of serviceRoads)box(scene,x,-.22,0,10,.25,depth-22,street);
  for(const x of [-291,291])box(scene,x,1,-4,1.3,2.4,382,0x6b85a1);
  box(scene,0,1,-197,580,2.4,1.3,0x6b85a1);
  for(const x of [-154,134])box(scene,x,1,197,x<0?268:313,2.4,1.3,0x6b85a1);
  // Enclosed campus handoff bridges between the fabrication and preparation blocks.
  for(const [x,z,length] of [[-94,-48,37],[67,-49,41],[12,-48,196]]){
    const cross=length>100;
    box(scene,x,6,z,cross?length:6,2.6,cross?5.5:length,0x6a94b0);
    box(scene,x,7.4,z,cross?length:6.3,.5,cross?5.8:length,navy);
  }
  const buildings=new Map<CampusZone,{block:THREE.Group;rim:THREE.Mesh;tag:HTMLSpanElement;height:number}>();
  const targets:THREE.Mesh[]=[];
  for(const id of zones){
    const zone=campusZones[id],[x,z]=zone.position,[w,d,h]=zone.size;
    const block=new THREE.Group(),roof=new THREE.Group();
    block.position.set(x,0,z);scene.add(block);block.add(roof);
    box(block,0,-.19,0,w+7,.9,d+7,navy);
    const low=id==='yard'||id==='reserve';
    const face=box(roof,0,h/2,0,w,h,d,low?zone.color:0xc9d7e4);
    const rim=box(roof,0,h+.3,0,w+.9,.65,d+.9,zone.color);
    for(const target of [face,rim]){target.userData.zone=id;targets.push(target);}
    if(id==='reserve'){
      for(const px of [-w*.42,w*.42])for(let pz=-d*.38;pz<=d*.4;pz+=d*.19)drum(roof,px,h+.8,pz,1.23,1.3,0xc6955e);
      for(const pz of [-d*.39,d*.39])box(roof,0,h+.66,pz,w*.84,.045,.26,0xe5edf1);
    }else if(id==='yard'){
      for(let i=0;i<8;i++)for(const pz of [-d*.25,d*.26]){
        box(roof,(i-3.5)*w/8.6,h+.67,pz,.34,.09,d*.36,0xd9e5f1);
      }
      for(const px of [-w*.42,w*.42]){
        drum(roof,px,h+3.8,-d*.4,.32,7.3,0x60778c);
        box(roof,px,h+7.38,-d*.4,1.4,.28,.48,0xd7e2e8);
      }
    }else{
      const fab=isFabSite(id),utility=id==='utilities';
      const warehouse=['receiving','materials','quarantine','finished','distribution','supplier'].includes(id);
      facade(roof,w,d,h,fab||warehouse||utility);
      if(fab){
        box(roof,0,h+1.73,-d*.14,w*.73,2.6,d*.43,0xdde8ee);
        for(const pz of [-d*.31,-d*.05])for(let i=-3;i<=3;i++)rooftopModule(roof,i*w/9,h+3.05,pz,6.4,5.8);
        for(const px of [-w*.41,w*.41])for(const pz of [-d*.24,d*.04])drum(roof,px,h+2.9,pz,1.21,4.5,0x66899b);
        for(const px of [-w*.25,w*.25])box(block,px,3.1,d/2+2.2,w*.28,5.9,4.4,0x759fb5);
      }else if(utility){
        for(let i=-2;i<=2;i++){
          const px=i*w*.155,pz=-d*.16;
          box(roof,px,h+2.08,pz,8.2,3.5,7.0,0x8da7b7);
          for(let j=0;j<5;j++)box(roof,px,h+.95+j*.49,pz+3.58,7.75,.22,.22,0x526d7c);
          drum(roof,px,h+4.01,pz,5.7,.61,0x476478);
          drum(roof,px,h+4.37,pz,1.08,.23,0xb6ccd2);
          for(let j=0;j<3;j++)box(roof,px,h+4.37,pz,5.2,.14,.32,0xaac0cc).rotation.y=j*Math.PI/3;
        }
        for(const pz of [-d*.32,d*.24])box(roof,0,h+1.12,pz,w*.85,.45,.8,0x5b8f9b);
      }else if(warehouse){
        for(let i=-2;i<=2;i++)box(roof,i*w*.17,h+.97,-d*.1,w*.08,.62,d*.57,0xafc5ce);
        for(const pz of [-d*.29,d*.17])rooftopModule(roof,w*.38,h+.6,pz,4.0,3.3);
      }else{
        const count=id==='gate'?1:2;
        for(let i=0;i<count;i++)rooftopModule(roof,(i-(count-1)/2)*w*.26,h+.6,-d*.14,Math.min(7,w*.23),Math.min(d*.38,6.8));
        box(roof,0,h*.85,d*.49,w*.45,h*.28,.28,zone.color);
        box(roof,0,h*.29,d*.53,w*.32,.34,3.5,0x62859b);
      }
      for(let i=0;i<(warehouse?5:2);i++){
        const marked=warehouse;
        const x=(i-(marked?2:.5))*w/(marked?7:3);
        const opening=marked?4.4:3.0;
        box(roof,x,2,d/2+.4,opening,4,.72,0x4c687e);
        box(roof,x,2,d/2+.8,opening-.42,3.26,.14,marked?0x879fb2:0x6d99ac);
        if(marked)for(let k=-2;k<=2;k++)box(roof,x,2+k*.53,d/2+.89,opening-.49,.09,.15,0xafc2d0);
        for(const side of [-1,1]){
          box(block,x+side*(opening/2+.23),.07,d/2+5,.14,.12,8,0xf1e2ad);
          drum(block,x+side*(opening/2+.35),.63,d/2+1.45,.34,1.20,0xc69b57);
        }
      }
    }
    if(isExternal(id))box(block,0,-1.5,0,w+38,2,d+43,ground);
    const tag=document.createElement('span');
    tag.textContent=zone.name;tag.dataset.zone=id;labels.append(tag);
    batchDecor(roof,[face,rim]);
    batchDecor(block);
    buildings.set(id,{block,rim,tag,height:h});
  }
  const routeCache=new Map<string,ReturnType<typeof connect>>();
  const trucks=Array.from({length:40},()=>{
    const body=new THREE.Group();
    const bed=box(body,0,1.1,0,7.4,1.5,3.6,navy);
    const payload=box(body,-.4,2.7,0,5.7,2.3,3.1,colors.truck);
    box(body,3.1,2.1,0,2.2,2.1,3.3,0xe9f1f7);
    box(body,4.25,2.62,0,.13,.74,2.59,0x557f95);
    for(const z of [-1.5,1.5])for(const x of [-2.72,2.65]){
      const wheel=drum(body,x,.69,z,1.2,.48,0x24364c);wheel.rotation.x=Math.PI/2;
    }
    body.visible=false;scene.add(body);return {body,bed,payload};
  });
  let view:CampusView='map',selected:CampusZone='fab',focus:CampusZone|undefined;
  const point=new THREE.Vector3();
  function render(){
    const {clientWidth:width,clientHeight:height}=host;
    if(!width||!height)return;
    renderer.render(scene,camera);
    for(const [id,{tag,block,height:roofHeight}] of buildings){
      const [x,z]=campusZones[id].position;
      point.set(x,view==='facility'&&id===focus?11:roofHeight+7,z).project(camera);
      tag.hidden=!block.visible||point.z>1||Math.abs(point.x)>1||Math.abs(point.y)>1||
        (width<620&&id!==selected&&id!=='fab'&&id!=='fabB'&&view==='map');
      tag.style.transform=`translate(${(point.x+1)*width/2}px,${(1-point.y)*height/2}px) translate(-50%,-100%)`;
    }
  }
  function setView(next:CampusView,zone?:CampusZone){
    view=next;focus=zone;
    for(const [id,building] of buildings){
      building.block.visible=view==='network'||(view==='facility'?id===focus:!isExternal(id));
    }
    const narrow=host.clientWidth<610;
    const [x,z]=zone&&view==='facility'?campusZones[zone].position:[0,view==='map'?39:0];
    controls.target.set(x,0,z);
    if(view==='top')camera.position.set(.12,narrow?980:790,.7);
    else if(view==='network')camera.position.set(narrow?105:315,narrow?1140:840,narrow?705:670);
    else if(view==='facility')camera.position.set(x+85,102,z+118);
    else camera.position.set(narrow?120:216,narrow?730:586,narrow?485:544);
    controls.update();render();
  }
  function fit(){
    const {clientWidth:width,clientHeight:height}=host;
    if(!width||!height)return;
    camera.aspect=width/height;camera.fov=width<610?47:38;camera.updateProjectionMatrix();
    renderer.setSize(width,height,false);render();
  }
  controls.addEventListener('change',render);
  const observer=new ResizeObserver(fit);observer.observe(host);
  setView('map');
  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let down:[number,number]=[0,0];
  canvas.addEventListener('pointerdown',event=>{down=[event.clientX,event.clientY];});
  canvas.addEventListener('pointerup',event=>{
    if(Math.hypot(event.clientX-down[0],event.clientY-down[1])>5)return;
    const bounds=canvas.getBoundingClientRect();
    pointer.set((event.clientX-bounds.left)/bounds.width*2-1,1-(event.clientY-bounds.top)/bounds.height*2);
    ray.setFromCamera(pointer,camera);
    const hit=ray.intersectObjects(targets.filter(mesh=>mesh.parent?.visible&&mesh.parent.parent?.visible),false)[0];
    if(hit)select(hit.object.userData.zone as CampusZone);
  });
  function update(time:number,moves:readonly CampusMove[],active:readonly CampusZone[],zone:CampusZone,fabCount:number){
    selected=zone;
    for(const [id,{tag,rim}] of buildings){
      const standby=id==='reserve'||(id==='fabB'&&fabCount===1);
      tag.dataset.state=id===zone?'selected':active.includes(id)?'active':standby?'standby':'idle';
      rim.material=paint(id===zone?0x22538a:active.includes(id)?0x37897a:standby?0x97adc2:campusZones[id].color);
      tag.textContent=campusZones[id].name+(id==='fabB'&&fabCount===1?' · 대기':'');
    }
    const moving=moves.filter(move=>move.start<=time&&time<move.end);
    let parking=0;
    trucks.forEach(({body,bed,payload},index)=>{
      const move=moving[index];
      body.visible=!!move;
      if(!move)return;
      if(move.from===move.to){
        const [x,z]=campusZones[move.from].position;
        body.position.set(x-29+parking%7*9,1,z-11+Math.floor(parking/7)*12);
        body.rotation.y=0;parking++;
      }else{
        const key=move.from+'/'+move.to;
        let route=routeCache.get(key);
        if(!route){route=connect(move.from,move.to);routeCache.set(key,route);}
        const phase=(time-move.start)/(move.end-move.start);
        const at=route.getPoint(phase),ahead=route.getPoint(Math.min(1,phase+.01));
        if(!at||!ahead){body.visible=false;return;}
        body.position.set(at.x,.14,at.z);body.rotation.y=-Math.atan2(ahead.z-at.z,ahead.x-at.x);
      }
      body.scale.setScalar(move.load==='truck'?1.2:.74);
      bed.material=paint(navy);payload.material=paint(colors[move.load]);
    });
    render();
  }
  return {setView,update,dispose(){
    observer.disconnect();controls.dispose();geometry.dispose();round.dispose();paints.forEach(mat=>mat.dispose());
    decorBatches.forEach(batch=>batch.dispose());
    grid.geometry.dispose();grid.material.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();labels.remove();
  }};
}
