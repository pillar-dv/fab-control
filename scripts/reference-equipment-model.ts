import * as T from 'three';
import type {ReferenceEquipment} from './equipment-definitions';

// Build modular concept geometry around the published equipment function.
export function referenceEquipmentModel(asset:ReferenceEquipment){
  const [w,h,d]=asset.layout,front=d/2;
  const root=new T.Group();root.name=asset.id;
  const cube=new T.BoxGeometry(1,1,1),cylinder=new T.CylinderGeometry(.5,.5,1,28),plane=new T.PlaneGeometry(1,1);
  const paint=(color:string,metalness=.23)=>new T.MeshStandardMaterial({color,metalness,roughness:.49});
  const shell=paint('#dce4e6'),side=paint('#b1c2c7'),dark=paint('#253943'),steel=paint('#8da4ad',.65),
    screen=paint('#143944'),accent=paint(asset.accent),light=paint('#7fe2cc'),wafer=paint('#8eb8e3',.65);
  const label=document.createElement('canvas');label.width=768;label.height=100;
  const ink=label.getContext('2d')!;
  ink.fillStyle='#17343c';ink.fillRect(0,0,label.width,label.height);
  ink.fillStyle='#f4faf9';ink.font='600 55px sans-serif';ink.textBaseline='middle';
  ink.fillText(asset.model,22,53,724);
  const texture=new T.CanvasTexture(label);texture.colorSpace=T.SRGBColorSpace;
  const badge=new T.MeshBasicMaterial({map:texture});
  const box=(x:number,y:number,z:number,width:number,height:number,depth:number,mat:T.Material,name='')=>{
    const mesh=new T.Mesh(cube,mat);mesh.position.set(x,y,z);mesh.scale.set(width,height,depth);mesh.name=name;root.add(mesh);return mesh;
  };
  const drum=(x:number,y:number,z:number,dia:number,height:number,mat:T.Material,name='')=>{
    const mesh=new T.Mesh(cylinder,mat);mesh.position.set(x,y,z);mesh.scale.set(dia,height,dia);mesh.name=name;root.add(mesh);return mesh;
  };
  const pipe=(a:T.Vector3,b:T.Vector3,r:number,mat=steel)=>{
    const axis=b.clone().sub(a),p=a.clone().lerp(b,.5);
    const mesh=drum(p.x,p.y,p.z,r*2,axis.length(),mat);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),axis.normalize());
  };
  const p=(x:number,y:number,z:number)=>new T.Vector3(x,y,z);
  const port=(x:number,z:number)=>{
    box(x,.49,z,.49,.98,.38,side,'load_port');
    box(x,.97,z,.53,.055,.45,steel);
    box(x,1.13,z-.237,.49,.38,.055,dark);
    for(const dx of [-.15,.15])drum(x+dx,1.01,z,.035,.026,steel);
  };
  const monitor=(x:number,y:number,z:number)=>{
    box(x,(y-.18)/2,z,.073,y-.18,.075,steel,'operator_stand');
    box(x,.1,z,.23,.06,.20,side);
    box(x,y,z,.39,.29,.11,dark,'operator_panel');box(x,y+.023,z+.058,.32,.17,.019,screen);
    for(let i=0;i<3;i++)box(x-.08+i*.08,y-.087,z+.07,.032,.024,.012,i?steel:light);
  };
  const grille=(x:number,y:number,z:number,width:number)=>{
    for(let i=0;i<5;i++)box(x,y+i*.044,z,width,.019,.022,dark);
  };
  const nameplate=(x:number,y:number,z:number,width:number)=>{
    box(x,y,z,width+.018,.218,.03,dark);
    const mesh=new T.Mesh(plane,badge);mesh.position.set(x,y,z+.016);mesh.scale.set(width,.21,1);root.add(mesh);
  };
  function feet(){
    box(0,.16,0,w*.99,.22,d*.98,dark,'chassis');
    for(const x of [-w*.43,w*.43])for(const z of [-d*.4,d*.4])box(x,.05,z,.26,.095,.26,steel);
  }
  function cabinet(x:number,z:number,width:number,height:number,depth:number,doors=2,window=false){
    box(x,height/2+.23,z,width,height,depth,side,'cabinet');
    box(x,height+.245,z,width+.018,.066,depth+.025,shell);
    for(let i=0;i<doors;i++){
      const dx=x-width/2+(i+.5)*width/doors,q=width/doors;
      box(dx,height*.52+.22,z+depth/2+.02,q-.037,height*.94,.042,shell,'access_panel');
      if(window)box(dx,height*.65+.2,z+depth/2+.045,q*.72,height*.27,.035,screen);
      box(dx+q*.33,height*.44+.22,z+depth/2+.056,.025,.16,.055,dark);
      if(window||i%2===0)grille(dx,.42,z+depth/2+.05,q*.63);
    }
    box(x,height*.88+.23,z+depth/2+.052,width*.94,.092,.025,accent);
    for(const dx of [-width*.27,width*.27])grille(x+dx,.39,z-depth/2-.014,width*.27);
  }
  function chamber(x:number,y:number,z:number,width:number,height:number){
    drum(x,y+height*.5,z,width,height,shell,'process_chamber');
    drum(x,y+height,z,width*1.025,.12,steel);
    drum(x,y+height+.085,z,width*.42,.087,screen);
    for(let i=0;i<8;i++){
      const t=i*Math.PI/4;drum(x+width*.42*Math.cos(t),y+height+.066,z+width*.42*Math.sin(t),.055,.029,dark);
    }
  }
  function station(x:number,y:number,z:number,dia:number,pad:T.Material){
    drum(x,y,z,dia,.11,pad);
    drum(x,y+.062,z,dia*.65,.022,wafer,'wafer');
  }

  switch(asset.shape){
    case 'oht': {
      box(0,h*.9,0,w*.91,.15,d*.68,dark,'vehicle');
      for(const x of [-w*.33,w*.33])for(const z of [-d*.31,d*.31]){
        const wheel=drum(x,h*.95,z,.16,.071,steel);wheel.rotation.x=Math.PI/2;
      }
      box(0,h*.75,0,w,.22,d*.86,accent);
      for(const x of [-w*.43,w*.43])box(x,h*.55,0,.14,.27,d*.76,accent);
      for(const x of [-.16,.16])box(x,h*.37,0,.019,h*.5,.027,dark,'hoist_belt');
      box(0,.13,0,.34,.088,.28,steel,'gripper');box(0,.036,0,.24,.07,.19,dark);
      nameplate(0,h*.74,d*.435,w*.64);
      break;
    }
    case 'stocker': {
      feet();
      const left=-w*.44,right=w*.43,shelfW=w*.15;
      box(0,h*.92,-d*.04,w*.88,.22,d*.87,shell);
      box(0,h*.54,-d*.45,w*.88,h*.77,.10,side);
      for(let column=0;column<=asset.modules;column++)box(left+column*(right-left)/asset.modules,h*.56,front-.27,.068,h*.73,.13,steel);
      for(let row=0;row<4;row++){
        const y=.55+row*h*.173;
        box(0,y,-.12,w*.88,.09,d*.75,dark);
        for(let col=0;col<asset.modules;col++)if((row+col)%3!==0){
          const x=left+(col+.5)*(right-left)/asset.modules;
          box(x,y+.15,.21,shelfW*.74,.237,.43,accent,'carrier');box(x,y+.15,.44,shelfW*.6,.16,.034,screen);
        }
      }
      box(w*.26,1.18,front-.03,.2,2.2,.22,steel,'lift_mast');
      box(w*.26,.63,front+.11,.57,.11,.51,accent,'handoff_platform');
      nameplate(0,h*.92,d*.395,w*.53);monitor(-w*.39,.86,front+.025);
      break;
    }
    case 'cluster':
    case 'strip': {
      feet();
      const trim=asset.shape==='strip',hubW=w*.29;
      chamber(0,.33,-d*.07,hubW,h*.53);
      cabinet(w*.39,-d*.2,w*.174,h*.84,d*.52,2);
      cabinet(-w*.39,-d*.2,w*.17,h*(trim?.83:.65),d*.51,2);
      for(let i=0;i<asset.modules;i++){
        const angle=(i-(asset.modules-1)/2)*2.8/Math.max(1,asset.modules-1);
        const x=Math.sin(angle)*w*.325,z=-Math.cos(angle)*d*.34;
        const size=w*(asset.modules>4?.137:.18);
        box(x,.45,z,size+.08,.69,size+.15,side);
        chamber(x,.79,z,size,h*(trim?.36:.56)+i*.014);
        if(asset.id==='amec-primo-d-rie'){
          drum(x-size*.19,2.31,z,size*.25,.09,accent);drum(x+size*.19,2.31,z,size*.25,.09,accent);
        }
        pipe(p(x,1.05,z+.04),p(x*.45,1.05,z*.38),.068);
      }
      cabinet(0,d*.265,w*.48,h*.61,d*.36,2,true);
      nameplate(0,h*.71,d*.445+.056,w*.40);
      port(-w*.12,front-.015);port(w*.08,front-.015);monitor(w*.22,1.28,front-.025);
      break;
    }
    case 'euv':
    case 'immersion':
    case 'krf': {
      feet();
      const euv=asset.shape==='euv',compact=asset.shape==='krf';
      cabinet(-w*.1,-d*.035,w*.57,h*.86,d*.79,compact?2:3);
      cabinet(w*.33,-d*.11,w*.283,h*(euv?.79:.63),d*.68,2);
      box(-w*.13,h*.9,-d*.05,w*.37,h*.19,d*.48,side,'projection_housing');
      if(euv){
        box(-w*.31,h*.51,-d*.47,w*.27,h*.52,d*.42,steel,'source_module');
        pipe(p(-w*.22,h*.71,-d*.77),p(w*.13,h*.71,-d*.51),.135,accent);
      }else if(!compact){
        box(w*.43,.81,-d*.23,w*.17,1.17,d*.4,steel,'auxiliary_module');
      }
      box(-w*.23,1.03,front-.025,w*.34,.61,.42,dark,'track_interface');
      box(-w*.23,1.08,front+.19,w*.26,.16,.029,screen);
      monitor(w*.19,1.3,front-.05);
      nameplate(-w*.095,h*.75,d*.36+.055,w*.46);
      break;
    }
    case 'clean':
    case 'track':
    case 'plate':
    case 'cmp': {
      feet();
      const wet=asset.shape==='clean'||asset.shape==='plate',polish=asset.shape==='cmp',n=asset.modules;
      const stacked=asset.id==='screen-su-3400';
      const bayW=w*.62/n,start=-w*.29;
      cabinet(w*.371,-d*.07,w*.25,h*.86,d*.82,2,wet);
      cabinet(-w*.365,-d*.20,w*.24,h*.88,d*.57,1);
      box(-w*.015,.63,0,w*.67,.78,d*.77,side);
      box(-w*.015,h*.75,-d*.25,w*.66,h*.22,d*.43,shell);
      const panelY=polish?h*.72:h*.84;
      box(-w*.015,panelY,d*.24,w*.65,.235,d*.2,accent);
      for(let i=0;i<n;i++){
        const x=start+(i+.5)*bayW, z=d*.16;
        if(polish){
          station(x,1.04,z,bayW*.87,dark);
          pipe(p(x,1.6,z),p(x,1.6,-d*.26),.045);
          drum(x,1.44,z,bayW*.55,.16,steel,'polish_head');
        }else if(stacked){
          box(x,1.44,z+.1,bayW*.88,.92,.35,side,'stacked_cleaning_tower');
          for(let level=0;level<6;level++){
            const y=1.07+level*.147;
            box(x,y,z+.287,bayW*.76,.112,.04,screen);
            drum(x,y-.058,z+.37,bayW*.49,.025,steel,'cleaning_chamber');
          }
        }else if(wet){
          drum(x,1.02,z,bayW*.75,.16,asset.shape==='plate'?accent:steel,'wet_cell');
          station(x,1.125,z,bayW*.57,screen);
          pipe(p(x-.11,1.25,z),p(x-.11,1.52,-d*.27),.026);
        }else {
          cabinet(x,-d*.02,bayW-.016,h*.52,d*.46,1,true);
          station(x,1.25,d*.29,bayW*.64,dark);
        }
        if(i>0)box(x-bayW*.49,1.52,d*.22,.038,1.1,.15,steel);
      }
      box(-w*.015,.49,front-.03,w*.65,.34,.1,shell);
      nameplate(-w*.01,panelY,d*.34+.015,w*.49);
      for(const x of [w*.29,w*.43])port(x,front-.035);
      monitor(-w*.40,1.33,front-.13);break;
    }
    case 'furnace': {
      feet();
      cabinet(w*.31,-d*.035,w*.37,h*.86,d*.78,2);
      for(const x of [-w*.23,w*.02]){
        drum(x,h*.56,-d*.1,w*.22,h*.62,shell,'vertical_reactor');
        for(const y of [1.78,2.3,2.84])drum(x,y,-d*.1,w*.229,.08,accent);
        for(let i=0;i<11;i++)drum(x,.66+i*.082,d*.25,w*.143,.017,i%3?steel:wafer,'boat_slot');
        for(const dx of [-.29,.29])drum(x+dx,1.04,d*.25,.035,.95,steel);
      }
      nameplate(w*.3,h*.7,d*.355+.055,w*.29);port(w*.3,front-.02);monitor(w*.42,1.27,front);
      break;
    }
    case 'implant': {
      feet();
      const z=-d*.12;
      cabinet(-w*.32,z,w*.315,h*.84,d*.74,2);
      cabinet(w*.325,z,w*.30,h*.74,d*.72,2,true);
      pipe(p(-w*.19,1.37,z),p(w*.235,1.37,z),.14);
      for(let i=0;i<asset.modules;i++){
        const x=-w*.17+i*w*.106;
        box(x,1.36,z,.26,.71,.69,accent,'beamline_station');
        box(x,.74,z,.16,.61,.17,steel);
      }
      port(w*.31,front-.03);monitor(-w*.09,1.33,front-.14);
      nameplate(-w*.28,h*.71,d*.25+.055,w*.28);break;
    }
    case 'rtp': {
      feet();
      cabinet(w*.28,-d*.08,w*.39,h*.84,d*.8,2,true);
      cabinet(-w*.28,-d*.11,w*.385,h*.69,d*.66,2);
      chamber(-w*.115,1.21,d*.19,w*.25,.64);
      for(let ix=-2;ix<=2;ix++)for(let iz=-1;iz<=1;iz++)
        drum(-w*.115+ix*.14,1.99,d*.19+iz*.17,.078,.075,accent,'lamp_array');
      port(w*.26,front-.015);monitor(w*.14,1.35,front-.053);nameplate(-w*.27,h*.65,d*.22+.055,w*.36);break;
    }
    default: {
      // Inspection, probe, cutting and assembly all need an accessible work envelope.
      feet();
      const probe=asset.shape==='prober',test=asset.shape==='tester',bond=asset.shape==='bond',
        assembly=asset.shape==='assembly',dice=asset.shape==='dice';
      cabinet(-w*.33,-d*.125,w*.28,h*.82,d*.70,1,probe);
      cabinet(w*.32,-d*.13,w*.29,h*.85,d*.65,test?asset.modules:2);
      box(0,.62,-d*.045,w*.43,.81,d*.86,side,'work_base');
      box(0,h*.86,-d*.10,w*.46,.12,d*.73,shell,'gantry');
      for(const sign of [-1,1])box(sign*w*.196,h*.55,d*.19,.085,h*.53,.092,accent);
      station(0,1.03,.13,w*(bond?.27:.24),dark);
      if(probe||test){
        box(0,1.67,.11,w*.37,.24,d*.37,accent,'test_head');
        pipe(p(w*.164,1.67,.11),p(w*.3,2.02,-.23),.065);
        drum(0,1.45,.11,w*.19,.08,steel,'probe_card_interface');
      }else if(bond){
        station(-w*.15,1.05,d*.22,w*.18,accent);station(w*.15,1.05,d*.22,w*.18,accent);
        drum(0,1.50,.12,w*.19,.17,steel,'bond_head');
      }else if(dice){
        pipe(p(-w*.16,1.58,.16),p(w*.16,1.58,.16),.082);
        const blade=drum(0,1.43,.16,.38,.025,steel,'dicing_blade');blade.rotation.z=Math.PI/2;
      }else if(assembly){
        box(-w*.13,1.08,d*.16,.38,.05,.61,steel,'die_tray');
        for(let i=0;i<6;i++)box(-w*.13+(i%2-.5)*.115,1.113,d*.16+(Math.floor(i/2)-1)*.14,.09,.024,.10,wafer);
        pipe(p(-w*.15,1.64,.11),p(w*.15,1.64,.11),.048);
        drum(w*.04,1.47,.11,.14,.25,steel,'pickup_head');
      }else{
        drum(0,1.60,.10,w*.18,.40,screen,'optical_head');drum(0,1.34,.10,w*.08,.13,steel,'objective');
        box(0,1.91,-d*.07,w*.29,.14,d*.29,accent);
      }
      if(!test&&!assembly)port(w*.35,front-.13);
      monitor(-w*.32,1.35,front-.08);nameplate(0,h*.86,d*.265+.012,w*.42);
    }
  }
  if(asset.shape!=='oht'&&asset.shape!=='stocker'){
    const x=w*.36,z=-d*.24;
    root.updateMatrixWorld(true);
    const ray=new T.Raycaster(p(x,h+3,z),p(0,-1,0));
    const top=ray.intersectObjects(root.children)[0]?.point.y;
    if(top!==undefined&&top>1){
      drum(x,top+.11,z,.041,.22,steel);
      for(const [i,mat] of [accent,light,accent].entries())drum(x,top+.217+i*.055,z,.096,.052,mat);
    }
  }
  root.traverse(o=>{if(o instanceof T.Mesh){o.castShadow=true;o.receiveShadow=true;}});
  return root;
}
