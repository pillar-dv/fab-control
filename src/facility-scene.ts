import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {createEquipmentModels} from './equipment-models';
import type {FacilityClip,FacilityMachine,MachineKind} from './facility-playback';

const navy=0x203c60,steel=0x7699b5,white=0xe8eff5,glass=0x70cadb,amber=0xe69937;
const teal=0x37bca5,red=0xc75769,purple=0xa389d4,carton=0xc69158,dark=0x344e68;
const rubber=0x25313b,aluminium=0xb2bdc8,painted=0x526977;
const section=(progress:number,start:number,end:number)=>THREE.MathUtils.smoothstep(progress,start,end);
type Position=[number,number,number];
type Animate=(progress:number,active:readonly FacilityClip[])=>void;

export function createFacilityScene(host:HTMLElement,name:string,machines:readonly FacilityMachine[]){
  const renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.18;
  const surface=renderer.domElement;
  surface.setAttribute('role','img');
  surface.setAttribute('aria-label',name+' 3D 운전 단면. 드래그로 회전하고 휠로 확대합니다.');
  host.append(surface);
  const scene=new THREE.Scene();
  scene.background=new THREE.Color(0xd4e1ec);
  scene.add(new THREE.HemisphereLight(0xf0f8ff,0x54718b,2.1));
  const light=new THREE.DirectionalLight(0xfff5e0,3.1);
  light.position.set(-7,15,10);
  scene.add(light);
  const camera=new THREE.PerspectiveCamera(39,1,.1,100);
  const controls=new OrbitControls(camera,surface);
  controls.target.set(0,.5,0);
  controls.minDistance=5;
  controls.maxDistance=54;
  controls.maxPolarAngle=Math.PI/2-.07;
  const distance=machines.length>2?22:machines.length===2?17.5:12.5;
  camera.position.set(distance*.43,distance*.62,distance*.76);
  controls.update();

  const cube=new THREE.BoxGeometry();
  const rounded=new RoundedBoxGeometry(1,1,1,2,.047);
  const cylinder=new THREE.CylinderGeometry(.5,.5,1,24);
  const ring=new THREE.TorusGeometry(.424,.076,10,30);
  const materials=new Map<number,THREE.MeshStandardMaterial>();
  function material(color:number){
    let current=materials.get(color);
    if(!current){
      const metal=color===aluminium||color===steel;
      current=new THREE.MeshStandardMaterial({color,roughness:metal?.41:.57,metalness:metal?.43:.08});
      materials.set(color,current);
    }
    return current;
  }
  function part(parent:THREE.Object3D,position:Position,size:Position,color:number,round=false):THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>{
    const mesh=new THREE.Mesh(round?cylinder:cube,material(color));
    mesh.position.set(...position);
    mesh.scale.set(...size);
    parent.add(mesh);
    return mesh;
  }
  function group(parent:THREE.Object3D,position:Position){
    const node=new THREE.Group();
    node.position.set(...position);
    parent.add(node);
    return node;
  }
  function enclosure(parent:THREE.Object3D,position:Position,size:Position,color:number){
    const mesh=part(parent,position,size,color);
    mesh.geometry=rounded;
    return mesh;
  }
  function pipe(parent:THREE.Object3D,from:Position,to:Position,diameter:number,color:number){
    const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),axis=b.clone().sub(a);
    const midpoint=a.clone().lerp(b,.5);
    const mesh=part(parent,[midpoint.x,midpoint.y,midpoint.z],[diameter,axis.length(),diameter],color,true);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),axis.normalize());
    return mesh;
  }
  function collar(parent:THREE.Object3D,position:Position,size:number,color:number){
    const flange=part(parent,position,[size,size,size],color);
    flange.geometry=ring;
    return flange;
  }
  function controlBox(parent:THREE.Object3D,x:number,y:number,z:number){
    enclosure(parent,[x,y,z],[.45,.53,.16],painted);
    enclosure(parent,[x,y+.1,z+.093],[.34,.19,.045],rubber);
    part(parent,[x,y+.109,z+.119],[.27,.12,.015],glass);
    for(const [i,color] of [red,teal,amber].entries())part(parent,[x-.12+i*.11,y-.13,z+.103],[.063,.063,.042],color);
  }
  function pallet(parent:THREE.Object3D,position:Position,color=carton){
    const load=group(parent,position);
    for(const x of [-.38,0,.38])part(load,[x,.045,0],[.14,.09,.85],carton);
    for(const z of [-.35,-.18,0,.18,.35])part(load,[0,.104,z],[.93,.043,.118],carton);
    enclosure(load,[0,.37,0],[.76,.49,.67],color);
    part(load,[0,.62,0],[.105,.012,.677],0xe1c19a);
    part(load,[0,.38,.34],[.24,.15,.015],white);
    for(let i=0;i<8;i++)part(load,[-.087+i*.018,.397,.351],[i%3===0?.012:.008,.064,.008],rubber);
    return load;
  }
  function conveyor(parent:THREE.Object3D,length=4.6){
    for(const x of [-length*.4,length*.4])for(const z of [-.55,.55]){
      enclosure(parent,[x,.38,z],[.145,.73,.145],painted);
      part(parent,[x,.055,z],[.28,.09,.25],rubber);
    }
    part(parent,[0,.46,0],[length*.82,.075,.085],steel);
    part(parent,[0,.75,0],[length,.13,1.19],rubber);
    for(let x=-length/2+.14;x<length/2;x+=.22)pipe(parent,[x,.824,-.56],[x,.824,.56],.113,aluminium);
    for(const z of [-.68,.68]){
      enclosure(parent,[0,.81,z],[length,.17,.16],navy);
      part(parent,[0,.868,z+.061],[length-.1,.024,.017],aluminium);
    }
    enclosure(parent,[length*.32,.46,.52],[.44,.31,.32],painted);
  }
  function truck(parent:THREE.Object3D,x:number,z:number){
    const model=group(parent,[x,0,z]);
    enclosure(model,[0,.65,-.44],[.96,.81,1.82],white);
    enclosure(model,[0,.52,.83],[.95,.58,.72],navy);
    enclosure(model,[0,.78,.76],[.87,.48,.55],steel);
    enclosure(model,[0,.83,1.035],[.75,.25,.067],rubber);
    part(model,[0,.84,1.067],[.66,.19,.017],glass);
    part(model,[0,.44,1.189],[.63,.14,.038],rubber);
    for(const x of [-.32,.32])part(model,[x,.35,1.208],[.18,.078,.04],white);
    for(const x of [-.47,.47])part(model,[x,.82,.75],[.052,.22,.3],glass);
    for(const x of [-.35,.35])part(model,[x,.39,-1.37],[.15,.092,.039],red);
    for(let i=0;i<11;i++)part(model,[.485,.65,-1.25+i*.16],[.013,.69,.025],aluminium);
    for(const offset of [-.7,.77])for(const side of [-.47,.47]){
      const wheel=part(model,[side,.24,offset],[.47,.18,.47],navy,true);
      wheel.rotation.z=Math.PI/2;
      pipe(model,[side*.98,.24,offset],[side*1.21,.24,offset],.22,aluminium);
    }
    return model;
  }
  function barrier(parent:THREE.Group):Animate{
    part(parent,[-1.55,.68,0],[1.04,1.35,1.2],white);
    part(parent,[-1.55,1.07,.61],[.72,.42,.045],glass);
    const car=truck(parent,.68,1.35);
    const pivot=group(parent,[-.7,.7,.18]);
    part(pivot,[1,0,0],[2,.09,.12],red);
    for(const x of [.5,1.2,1.8])part(pivot,[x,.005,.008],[.17,.1,.13],white);
    return (p,active)=>{
      car.visible=active.length>0;
      car.position.z=1.38-2.3*section(p,.36,.88);
      pivot.rotation.z=1.42*(section(p,.18,.42)-section(p,.84,1));
    };
  }
  function yard(parent:THREE.Group):Animate{
    for(const x of [-2.34,-.78,.78,2.34])part(parent,[x,.015,0],[.037,.029,5.1],white);
    const vehicles=Array.from({length:6},(_,i)=>{
      const model=truck(parent,(i%3-1)*1.56,i<3?-1.2:1.3);
      model.scale.setScalar(.87);
      if(i<3)model.rotation.y=Math.PI;
      return model;
    });
    return (_,active)=>vehicles.forEach((vehicle,i)=>{vehicle.visible=i<active.length;});
  }
  function dock(parent:THREE.Group):Animate{
    enclosure(parent,[0,.39,-1.85],[4.7,.78,1.32],painted);
    enclosure(parent,[0,2.55,-2.14],[4.71,.4,.38],steel);
    for(const x of [-1.24,1.24]){
      enclosure(parent,[x,1.62,-2.08],[.27,1.7,.36],rubber);
      enclosure(parent,[x,.69,-1.59],[.29,.26,.22],rubber);
      for(let i=0;i<3;i++)part(parent,[x,.65+i*.04,-1.465],[.24,.017,.015],aluminium);
    }
    const door=group(parent,[0,1.55,-2.17]);
    for(let i=0;i<9;i++)enclosure(door,[0,(i-4)*.179,0],[2.17,.171,.12],white);
    part(door,[0,.086,.076],[.81,.14,.043],rubber);
    controlBox(parent,1.88,1.32,-1.97);
    const hinge=group(parent,[0,.78,-1.98]);
    enclosure(hinge,[0,0,.68],[1.41,.09,1.36],steel);
    for(const x of [-.65,.65])part(hinge,[x,.047,.68],[.084,.012,1.3],amber);
    for(let i=0;i<9;i++)part(hinge,[0,.049,.1+i*.143],[1.24,.014,.02],aluminium);
    const lip=group(hinge,[0,0,1.34]);
    enclosure(lip,[0,0,.17],[1.35,.075,.37],aluminium);
    const restraint=group(parent,[.13,.15,-1.31]);
    enclosure(restraint,[0,0,.07],[.23,.17,.28],painted);
    const hook=collar(restraint,[0,.12,.17],.29,red);hook.rotation.y=Math.PI/2;
    const vehicle=truck(parent,0,.45);
    const load=pallet(parent,[0,.8,-.51]);
    return (p,active)=>{
      const working=active.length>0;
      vehicle.visible=working;
      const held=section(p,0,.1)-section(p,.92,1);
      restraint.position.y=.15+.33*held;
      hook.rotation.z=1.3*held;
      door.position.y=1.55+1.41*(section(p,.12,.27)-section(p,.82,.92));
      hinge.rotation.x=-1.39*(1-section(p,.29,.42)+section(p,.72,.82));
      lip.rotation.x=.94*(1-section(p,.34,.45)+section(p,.70,.80));
      load.visible=working&&p>=.42&&p<.74;
      load.position.z= -.42-2*section(p,.43,.72);
    };
  }
  function scan(parent:THREE.Group):Animate{
    conveyor(parent);
    for(const x of [-.63,.63])for(const z of [-.82,.82]){
      enclosure(parent,[x,1.42,z],[.09,1.2,.09],aluminium);
      part(parent,[x,1.43,z+.05],[.021,1.06,.014],painted);
    }
    enclosure(parent,[0,2,0],[1.37,.14,1.86],steel);
    for(const [x,z,y] of [[0,0,1.83],[.09,.78,1.42],[-.11,-.78,1.46]]){
      const camera=group(parent,[x,y,z]);
      camera.rotation.x=z===0?Math.PI/2:z>0?Math.PI:0;
      enclosure(camera,[0,0,0],[.39,.23,.29],rubber);
      const lens=part(camera,[0,0,.15],[.13,.067,.13],glass,true);lens.rotation.x=Math.PI/2;
      part(camera,[.102,.046,.155],[.027,.027,.012],teal);
    }
    controlBox(parent,1.32,1.32,-.65);
    const beam=part(parent,[0,1.53,0],[.028,.54,1.1],teal);
    const load=pallet(parent,[-1.84,.91,0]);
    return (p,active)=>{
      load.visible=active.length>0;
      beam.visible=load.visible&&p>.3&&p<.68;
      load.position.x=-1.82+3.64*p;
    };
  }
  function rack(parent:THREE.Group):Animate{
    const rackZ=-1.23;
    for(const x of [-2.3,-.78,.78,2.3]){
      for(const z of [rackZ-.44,rackZ+.44]){
        enclosure(parent,[x,1.62,z],[.09,3.23,.085],painted);
        enclosure(parent,[x,.043,z],[.23,.08,.22],navy);
        for(let i=0;i<15;i++)part(parent,[x,.22+i*.186,z+.046],[.027,.027,.013],rubber);
      }
      for(let row=0;row<3;row++){
        pipe(parent,[x,.24+row*.93,rackZ-.44],[x,1.1+row*.93,rackZ+.44],.052,aluminium);
      }
    }
    for(const y of [.43,1.36,2.29]){
      for(const z of [rackZ-.42,rackZ+.42])enclosure(parent,[0,y,z],[4.6,.1,.095],amber);
      for(let i=-7;i<=7;i++)part(parent,[i*.30,y+.058,rackZ],[.062,.073,.89],steel);
    }
    pallet(parent,[-1.55,.49,rackZ],glass);
    pallet(parent,[1.52,1.42,rackZ],amber);
    pallet(parent,[-1.53,2.35,rackZ]);
    part(parent,[0,.055,.27],[4.9,.12,.13],navy);
    part(parent,[0,.055,1.11],[4.9,.12,.13],navy);
    const mast=group(parent,[-2.08,0,.66]);
    for(const x of [-.11,.11])enclosure(mast,[x,1.62,0],[.116,3.1,.235],aluminium);
    part(mast,[0,1.57,.119],[.085,2.96,.038],rubber);
    enclosure(mast,[0,.17,0],[.89,.28,.77],navy);
    enclosure(mast,[.34,.39,.08],[.29,.34,.41],steel);
    for(const x of [-.31,.31])for(const z of [-.29,.29]){
      pipe(mast,[x,.123,z-.06],[x,.123,z+.06],.17,rubber);
    }
    enclosure(mast,[0,3.15,0],[.39,.18,.37],painted);
    controlBox(parent,-2.4,.64,1.96);
    const carriage=group(mast,[0,.4,0]);
    part(carriage,[0,0,-.14],[.78,.13,.35],amber);
    const fork=group(carriage,[0,0,0]);
    for(const x of [-.23,.23]){
      enclosure(fork,[x,-.015,-.37],[.13,.075,.82],painted);
      enclosure(fork,[x,.026,-.48],[.082,.026,.61],aluminium);
    }
    for(let i=0;i<4;i++)pipe(parent,[-2.33+i*.29,.45,1.47],[-2.33+i*.29,.45,2.4],.13,aluminium);
    const load=pallet(fork,[0,.07,-.47],glass);
    const slot=pallet(parent,[.02,2.35,rackZ],glass);
    return (progress,active)=>{
      const working=active.length>0;
      const p=working&&active[0].direction==='out'?1-progress:progress;
      mast.position.x=-2.06+2.08*section(p,.05,.47);
      carriage.position.y=.42+1.94*section(p,.15,.51);
      fork.position.z=-1.4*(section(p,.54,.73)-section(p,.8,1));
      load.visible=working&&p<.76;
      slot.visible=working&&p>=.76;
    };
  }
  function workstation(parent:THREE.Group,kind:'probe'|'dicer'|'bonder'|'tester'):Animate{
    const width=kind==='tester'?4.75:3.55;
    enclosure(parent,[0,.43,.2],[width,.77,2.52],white);
    enclosure(parent,[0,.84,.2],[width,.23,2.51],steel);
    for(const x of [-1.2,0,1.2]){
      enclosure(parent,[x,.4,1.481],[1.1,.64,.087],white);
      enclosure(parent,[x+.37,.44,1.54],[.06,.22,.075],rubber);
      for(let i=0;i<4;i++)part(parent,[x,.23+i*.05,1.534],[.48,.02,.021],painted);
    }
    for(const x of [-1.58,1.58])for(const z of [-.79,1.19])part(parent,[x,.053,z],[.21,.11,.21],steel,true);
    controlBox(parent,-1.24,1.34,1.18);
    enclosure(parent,[0,2.26,-.55],[3.54,.23,.59],white);
    const bridge=group(parent,[0,0,-.13]);
    for(const x of [-1.39,1.39])part(bridge,[x,1.48,-.54],[.14,1.32,.18],white);
    part(bridge,[0,2.16,-.54],[2.94,.21,.34],steel);
    const crossbar=group(bridge,[0,0,0]);
    part(crossbar,[0,2.13,-.19],[.23,.19,.85],dark);
    const head=group(crossbar,[0,1.44,.14]);
    part(head,[0,.28,0],[.39,.52,.36],amber);
    const indicator=part(head,[0,-.016,0],[.25,.1,.25],purple,true);
    for(const x of [-.114,.114])part(head,[x,.095,.018],[.061,.31,.061],aluminium,true);
    const table=group(parent,[0,1,.34]);
    part(table,[0,.035,0],[1.32,.15,1.16],white);
    const item=part(table,[0,.145,0],[.94,.06,.94],kind==='tester'?purple:glass,kind==='probe'||kind==='dicer');
    const substrate=kind==='bonder'?part(table,[0,.2,0],[.39,.045,.35],purple):undefined;
    if(substrate)for(let i=0;i<5;i++)for(const z of [-.12,.12])part(table,[-.14+i*.07,.224,z],[.029,.016,.044],amber);
    const flip=kind==='bonder'?group(parent,[-1.04,1.16,.38]):undefined;
    if(flip){
      for(const z of [.17,.61])enclosure(parent,[-1.04,1.036,z],[.61,.125,.13],painted);
      pipe(flip,[-.29,0,0],[.32,0,0],.16,steel);
      enclosure(flip,[.05,0,0],[.40,.095,.52],navy);
      part(flip,[.05,.081,0],[.197,.045,.171],amber);
      controlBox(parent,1.29,1.84,-.59);
      enclosure(parent,[1.28,1.15,.34],[.65,.29,.75],white);
      part(parent,[1.28,1.306,.34],[.36,.032,.39],0x5b8f8c);
    }
    const input=kind==='tester'?part(parent,[-1.85,1,.35],[.75,.11,.85],teal):undefined;
    const output=kind==='tester'?part(parent,[1.85,1,.35],[.75,.11,.85],purple):undefined;
    if(kind==='dicer')for(const x of [-.29,-.1,.1,.29])part(table,[x,.182,0],[.014,.016,.71],white);
    return (progress,active)=>{
      const running=active.length>0;
      const stage=running?(progress*4)%1:0;
      const row=running?Math.floor(progress*4):0;
      const strike=section(stage,.17,.46)-section(stage,.61,.89);
      head.position.y=1.46-.22*strike;
      crossbar.position.x=kind==='tester'?1.83*(section(progress,.54,.89)-1+section(progress,.05,.33)):
        kind==='bonder'?-1.12*(1-section(stage,.14,.51)):0;
      table.position.z=.34+(kind==='dicer'?.66*(stage-.5):kind==='probe'?.23*(row-1.5):0);
      table.position.x=kind==='probe'?.73*(stage-.5):kind==='dicer'?.14*(row-1.5):0;
      item.visible=running;
      if(substrate)substrate.visible=running&&stage>.47;
      if(flip)flip.rotation.x=Math.PI*section(stage,.04,.36);
      if(input)input.position.x=-1.85+.18*section(progress,.02,.25);
      if(output)output.material=material(running&&progress>.79?teal:purple);
      indicator.material=material(running&&strike>.53?teal:purple);
    };
  }
  function animateEquipment(root:THREE.Group,kind:MachineKind):Animate{
    const sign=(name:string)=>root.getObjectByName(name);
    const movingNames=kind==='probe'||kind==='tester'?['test_head','probe_card_interface']:
      kind==='dicer'?['dicing_blade']:['pickup_head'];
    const moving=movingNames.flatMap(name=>{
      const node=sign(name);
      return node?[{node,x:node.position.x,y:node.position.y,rotation:node.quaternion.clone()}]:[];
    });
    const wafer=sign('wafer'),waferOrigin=wafer?.position.clone();
    const assembly=kind==='bonder',test=kind==='tester';
    const withCarrier=assembly||test;
    if(wafer&&withCarrier)wafer.visible=false;
    const machine=root.children[0];
    const carrier=group(machine,[0,1.107,.13]);
    if(withCarrier){
      enclosure(carrier,[0,0,0],[.69,.07,.64],test?painted:0x40847c);
      for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){
        part(carrier,[i*.19,.049,j*.17],[.122,.048,.115],i===0&&j===0?teal:rubber);
      }
    }
    if(test){
      for(const x of [-.64,.64])enclosure(machine,[x,1.075,.19],[.27,.094,.58],navy);
    }
    return (progress,active)=>{
      const running=active.length>0;
      const stage=progress*4%1,pass=Math.floor(progress*4);
      const down=running?section(stage,.16,.43)-section(stage,.65,.94):0;
      for(const {node,x,y,rotation} of moving){
        node.position.y=y-down*(kind==='dicer'?.11:assembly?.23:.19);
        node.position.x=x-(assembly&&running?.63*(1-section(stage,.2,.51)):0);
        if(kind==='dicer'){
          node.quaternion.copy(rotation);
          node.rotateY(progress*Math.PI*9);
        }
      }
      if(wafer&&waferOrigin&&!withCarrier){
        wafer.visible=running;
        wafer.position.copy(waferOrigin);
        if(running){
          wafer.position.x+=(pass-1.5)*.065;
          wafer.position.z+=(stage-.5)*(kind==='dicer'?.48:.33);
        }
      }
      if(test)carrier.position.x=running?.47*(section(progress,.6,.92)+section(progress,.02,.31)-1):0;
    };
  }
  function mountBoard(parent:THREE.Group):Animate{
    conveyor(parent);
    const pcb=group(parent,[-1.7,.93,0]);
    enclosure(pcb,[0,0,0],[.78,.052,.64],0x357a69);
    for(let i=-4;i<=4;i++){
      part(pcb,[i*.076,.033,0],[.018,.012,.52],amber);
      part(pcb,[i*.076,.037,-.225],[.05,.012,.043],aluminium);
    }
    const packageMesh=enclosure(pcb,[0,.066,0],[.34,.091,.33],rubber);
    for(const x of [-1.16,1.16]){
      enclosure(parent,[x,1.34,-.74],[.18,1.24,.2],painted);
      enclosure(parent,[x,1.34,.72],[.16,1.24,.21],steel);
      enclosure(parent,[x,1.99,0],[.18,.19,1.63],white);
    }
    enclosure(parent,[0,2.03,-.63],[2.45,.29,.36],white);
    part(parent,[0,1.83,-.54],[2.35,.09,.13],aluminium);
    const gantry=group(parent,[0,1.56,-.28]);
    enclosure(gantry,[0,.12,0],[.42,.34,.55],navy);
    const nozzle=group(gantry,[0,-.12,0]);
    part(nozzle,[0,0,0],[.29,.24,.29],steel,true);
    for(let i=0;i<5;i++){
      const a=i*Math.PI*2/5;
      part(nozzle,[Math.cos(a)*.095,-.13,Math.sin(a)*.095],[.038,.14,.038],rubber,true);
    }
    for(let i=0;i<6;i++){
      const x=-.94+i*.21;
      const spool=part(parent,[x,.99,-1.03],[.39,.075,.39],i%2?steel:purple,true);spool.rotation.z=Math.PI/2;
      part(parent,[x,.97,-.71],[.12,.055,.51],aluminium);
    }
    controlBox(parent,1.38,1.52,-.88);
    return (p,active)=>{
      const motion=active.length>0;
      pcb.visible=motion;
      pcb.position.x=-1.87+1.87*(section(p,.02,.24)+section(p,.73,.99));
      gantry.position.set(-.52+.52*section(p,.36,.59),1.56-.27*(section(p,.47,.62)-section(p,.66,.76)),-.55+.55*section(p,.39,.58));
      nozzle.rotation.y=2*Math.PI*section(p,.29,.65);
      packageMesh.visible=p>.61;
    };
  }
  function failureBench(parent:THREE.Group):Animate{
    for(const x of [-1.82,1.82])for(const z of [-.75,.75])enclosure(parent,[x,.51,z],[.14,1.01,.14],painted);
    enclosure(parent,[0,1,0],[4.04,.16,1.82],aluminium);
    part(parent,[.4,1.09,0],[2.19,.023,1.34],0x4d8079);
    enclosure(parent,[-.58,1.17,-.28],[1.0,.17,.78],painted);
    pipe(parent,[-.57,1.2,-.59],[-.57,2.17,-.59],.12,steel);
    enclosure(parent,[-.57,2.1,-.31],[.37,.30,.74],white);
    const lens=group(parent,[-.57,1.84,-.06]);
    part(lens,[0,.09,0],[.24,.22,.24],rubber,true);
    part(lens,[0,-.05,0],[.12,.105,.12],aluminium,true);
    const specimen=enclosure(parent,[-.55,1.25,-.05],[.29,.055,.26],purple);
    const monitor=group(parent,[1.25,1.48,-.64]);
    pipe(monitor,[0,-.39,0],[0,.15,0],.076,painted);
    enclosure(monitor,[0,.23,0],[.76,.48,.135],rubber);
    const display=part(monitor,[0,.23,.079],[.67,.388,.028],glass);
    return (p,active)=>{
      lens.position.y=1.84-.1*section(p,.2,.43)+.1*section(p,.69,.93);
      specimen.position.x=-.55+.24*Math.sin(p*Math.PI*2);
      specimen.visible=active.length>0;
      display.material=material(active.length?teal:steel);
    };
  }
  function reel(parent:THREE.Group):Animate{
    enclosure(parent,[0,.45,-.1],[4.49,.79,2.21],white);
    enclosure(parent,[0,.89,-.1],[4.53,.19,2.24],painted);
    for(const x of [-1.48,0,1.48]){
      enclosure(parent,[x,.42,1.016],[1.38,.66,.12],white);
      enclosure(parent,[x+.47,.44,1.085],[.065,.22,.1],rubber);
    }
    enclosure(parent,[0,1.01,.42],[3.51,.055,.37],aluminium);
    part(parent,[0,1.045,.42],[2.95,.037,.25],rubber);
    for(const z of [.28,.56])part(parent,[0,1.06,z],[3.22,.037,.035],steel);
    const reels=[-1.53,1.53].map(x=>{
      enclosure(parent,[x,1.25,-.51],[.29,.61,.31],steel);
      const spool=group(parent,[x,1.72,-.35]);
      part(spool,[0,0,0],[.88,.18,.88],rubber,true).rotation.x=Math.PI/2;
      for(const z of [-.107,.107]) {
        collar(spool,[0,0,z],1.17,aluminium);
        for(let i=0;i<3;i++)part(spool,[0,0,z],[1.02,.10,.047],steel).rotation.z=i*Math.PI/3;
      }
      part(spool,[0,0,.15],[.27,.09,.27],amber,true).rotation.x=Math.PI/2;
      pipe(parent,[x,1.19,-.02],[x,1.19,.28],.19,aluminium);
      return spool;
    });
    enclosure(parent,[0,1.52,-.43],[1.29,1.05,1.02],white);
    enclosure(parent,[0,1.54,.097],[1.03,.73,.073],glass);
    controlBox(parent,.92,1.63,-.1);
    pipe(parent,[0,1.32,.28],[0,1.32,.55],.23,steel);
    const items=Array.from({length:8},(_,i)=>part(parent,[i*.4-1,1.1,.42],[.146,.066,.18],purple));
    return (p,active)=>{
      reels.forEach((item,i)=>{item.rotation.z=(i===0?-1:1)*Math.PI*p*4;});
      items.forEach((item,i)=>{item.visible=active.length>0;item.position.x=((p*2.5+i*.4)%2.65)-1.31;});
    };
  }
  function transport(parent:THREE.Group,cartonLoad:boolean):Animate{
    conveyor(parent);
    const load=cartonLoad?pallet(parent,[0,.93,0]):group(parent,[0,.9,0]);
    if(!cartonLoad){
      enclosure(load,[0,.03,0],[.89,.068,.72],rubber);
      for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){
        part(load,[i*.24,.08,j*.18],[.179,.052,.13],purple);
      }
      for(const x of [-.61,.61])enclosure(parent,[x,1.29,-.67],[.18,.76,.21],steel);
      enclosure(parent,[0,1.71,-.41],[1.5,.20,.73],navy);
      enclosure(parent,[0,1.62,-.01],[.79,.125,.14],white);
      for(let i=0;i<4;i++)enclosure(parent,[1.35,1+i*.11,-.7],[.83,.081,.5],painted);
      controlBox(parent,-.88,1.46,-.55);
    }
    return (p,active)=>{
      load.visible=active.length>0;
      load.position.x=(active[0]?.direction==='out'?-1:1)*(-1.81+3.63*p);
    };
  }
  function cooling(parent:THREE.Group):Animate{
    for(const x of [-1.88,-.69])enclosure(parent,[x,.1,-.72],[.16,.2,1.68],painted);
    for(const [y,z,r,color] of [[.57,-.68,.61,0x527f99],[1.17,-.93,.53,0x60918b]]){
      pipe(parent,[-2.32,y,z],[-.38,y,z],r,color);
      for(const x of [-2.32,-.38]){
        pipe(parent,[x-.046,y,z],[x+.046,y,z],r+.14,aluminium);
        for(let i=0;i<8;i++){
          const a=i*Math.PI/4;
          pipe(parent,[x-.06,y+Math.cos(a)*r*.52,z+Math.sin(a)*r*.52],[x+.06,y+Math.cos(a)*r*.52,z+Math.sin(a)*r*.52],.04,painted);
        }
      }
    }
    pipe(parent,[-1.92,1.59,-.93],[-.85,1.59,-.93],.43,steel);
    pipe(parent,[-1.51,1.57,-.93],[-1.51,1.22,-.57],.18,painted);
    controlBox(parent,-1.25,.88,-.25);
    const tower=group(parent,[1.28,0,-.82]);
    enclosure(tower,[0,.16,0],[2.04,.31,1.73],painted);
    enclosure(tower,[0,1.62,0],[2.04,.20,1.73],aluminium);
    for(const x of [-.96,.96])for(const z of [-.78,.78])enclosure(tower,[x,.9,z],[.131,1.53,.132],steel);
    part(tower,[0,.89,-.03],[1.87,1.21,1.44],rubber);
    for(let i=0;i<10;i++){
      enclosure(tower,[0,.37+i*.103,.75],[1.86,.07,.18],painted).rotation.x=.28;
      for(const x of [-.92,.92])enclosure(tower,[x,.37+i*.103,0],[.17,.07,1.47],steel).rotation.z=.28;
    }
    const cowl=collar(tower,[0,1.79,0],1.48,painted);cowl.rotation.x=-Math.PI/2;cowl.scale.z=2.25;
    const fan=group(tower,[0,1.79,0]);
    part(fan,[0,0,0],[.27,.15,.27],navy,true);
    for(let i=0;i<7;i++){
      const a=i*Math.PI*2/7;
      const blade=enclosure(fan,[Math.cos(a)*.33,0,Math.sin(a)*.33],[.52,.061,.17],aluminium);
      blade.rotation.y=-a+.31;
    }
    for(const [i,z] of [-.15,.31].entries()){
      const color=i===0?glass:teal;
      pipe(parent,[-2.48,.57+i*.6,i===0?-.68:-.93],[-2.48,.57+i*.6,z],.148,color);
      pipe(parent,[-2.48,.57+i*.6,z],[-2.48,.47,z+.4],.148,color);
      pipe(parent,[2.1,.46,z+.4],[2.1,.46,-.56],.15,color);
    }
    const loops=[glass,teal].map((color,i)=>{
      const z=i*.51+.26;
      pipe(parent,[-2.48,.46,z],[2.1,.46,z],.145,color);
      for(const x of [-1.74,.02,1.57]){
        pipe(parent,[x-.065,.46,z],[x+.065,.46,z],.243,aluminium);
        const wheel=collar(parent,[x,.69,z],.235,amber);wheel.rotation.x=Math.PI/2;
        pipe(parent,[x,.49,z],[x,.67,z],.04,steel);
      }
      return [0,1,2].map(()=>part(parent,[0,.49,z],[.135,.198,.204],white,true));
    });
    return (p,active)=>{
      fan.rotation.y=p*12*Math.PI;
      loops.forEach((loop,i)=>loop.forEach((pulse,j)=>{
        pulse.visible=active.length>0;
        pulse.position.x=-2.41+4.48*((p*6+j/3)%1)*(i===0?1:-1)+(i===0?0:4.48);
      }));
    };
  }
  const createMachine:Record<MachineKind,(node:THREE.Group)=>Animate>={
    barrier,yard,dock,scan,rack,reel,chiller:cooling,
    probe:node=>workstation(node,'probe'),dicer:node=>workstation(node,'dicer'),
    bonder:node=>workstation(node,'bonder'),tester:node=>workstation(node,'tester'),
    tray:node=>transport(node,false),cargo:node=>transport(node,true),smt:mountBoard,analysis:failureBench,
  };
  const cols=Math.max(1,Math.min(machines.length,3));
  const floorWidth=6.3*cols;
  part(scene,[0,-.21,0],[floorWidth,.4,7.6],navy);
  part(scene,[0,-.022,0],[floorWidth-.2,.06,7.4],0xaebfc9);
  for(let i=0;i<=cols;i++)part(scene,[i*6.3-floorWidth/2,.016,0],[.05,.024,6.72],white);
  const indoor=!machines.some(spec=>spec.kind==='yard'||spec.kind==='barrier'||spec.kind==='dock');
  if(indoor){
    part(scene,[0,.83,-3.63],[floorWidth-.14,1.66,.17],0xbcccd7);
    part(scene,[0,.08,-3.51],[floorWidth-.17,.14,.15],painted);
    part(scene,[0,1.7,-3.6],[floorWidth-.15,.095,.17],steel);
    for(let x=-floorWidth/2+.65;x<floorWidth/2;x+=1.26){
      part(scene,[x,1,-3.521],[.027,1.31,.032],painted);
      part(scene,[x,1.57,-3.516],[.86,.051,.027],white);
    }
  }
  part(scene,[0,.016,3.17],[floorWidth-.18,.024,.06],white);
  part(scene,[0,.016,2.76],[floorWidth-.18,.024,.045],white);
  for(let x=-floorWidth/2+.38;x<floorWidth/2-.2;x+=.57){
    part(scene,[x,.026,2.965],[.04,.013,.41],0x9aabb7).rotation.y=-.5;
  }
  const models=createEquipmentModels();
  const mounted=new Set<string>();
  let disposed=false;
  const units=machines.map((spec,i)=>{
    const node=group(scene,[(i-(cols-1)/2)*6.3,.02,.21]);
    const fallback=group(node,[0,0,0]);
    const signal=part(node,[-2.52,.84,2.35],[.15,.16,.15],steel,true);
    pipe(node,[-2.52,.07,2.35],[-2.52,.81,2.35],.075,aluminium);
    part(node,[-2.52,.07,2.35],[.24,.088,.24],navy,true);
    const unit={id:spec.id,motion:createMachine[spec.kind](fallback),signal,progress:0,active:[] as readonly FacilityClip[]};
    if(spec.modelId)void models.fit(spec.modelId,[4.92,3.16,4.36]).then(model=>{
      if(!model||disposed)return;
      fallback.removeFromParent();
      node.add(model);
      unit.motion=animateEquipment(model,spec.kind);
      unit.motion(unit.progress,unit.active);
      mounted.add(spec.modelId!);
      surface.dataset.equipmentModels=[...mounted].join(' ');
      render();
    });
    return unit;
  });
  function render(){if(!disposed&&host.clientWidth)renderer.render(scene,camera);}
  function fit(){
    const {clientWidth:width,clientHeight:height}=host;
    if(!width||!height)return;
    camera.aspect=width/height;
    camera.fov=camera.aspect<1.35?53:39;
    camera.updateProjectionMatrix();
    renderer.setSize(width,height,false);
    render();
  }
  controls.addEventListener('change',render);
  const observer=new ResizeObserver(fit);
  observer.observe(host);
  fit();
  return {
    update(time:number,clips:readonly FacilityClip[]){
      for(const unit of units){
        const active=clips.filter(item=>item.unit===unit.id);
        const clip=active[0];
        const progress=clip?(time-clip.start)/(clip.end-clip.start):0;
        unit.progress=progress;
        unit.active=active;
        unit.motion(progress,active);
        unit.signal.material=material(clip?clip.label==='하역 도크 대기'?amber:teal:steel);
      }
      render();
    },
    dispose(){
      disposed=true;
      observer.disconnect();
      controls.dispose();
      cube.dispose();
      rounded.dispose();
      cylinder.dispose();
      ring.dispose();
      materials.forEach(item=>item.dispose());
      models.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      surface.remove();
    },
  };
}
