import {bayFor,type FabBay} from './campus-layout';
import type {createRail,RailPoint} from './experiment-rail';
import type {ProductId} from './simulation';

export type FabSections=1|2;
export interface FabAreaAssignment {section:FabSections; product:ProductId}
interface FabAreaSetup extends FabAreaAssignment {tools:readonly string[]}
export interface CampusFabLine extends FabAreaAssignment {district:string; width:number; depth:number; z:number}
export interface CampusFabFloor {width:number; depth:number; areas:CampusFabLine[]}
export interface CampusRailEdit {
  west:number; east:number; westOpen:boolean; eastOpen:boolean;
  buffers:Partial<Record<FabSections,{offset:number;capacity:number}>>;
  ports:Record<string,{offset:number;open:boolean}>;
}
export const defaultRailEdit=():CampusRailEdit=>({west:-13,east:13,westOpen:true,eastOpen:true,buffers:{},ports:{}});
export const sectionName=(section:FabSections)=>section+'구역';
export const scannerOffset=3.67;
export const campusToolSize={width:3.65,depth:3.25,offset:1.91};

type Rail=ReturnType<typeof createRail>;
type PositionedTool={logical:string; point:RailPoint; access:RailPoint; hub:number; section:FabSections; bay:FabBay;
  product:ProductId; copy:number};
type LineParking={section:FabSections; hub:number; spots:RailPoint[]};
const point=(id:string,x:number,z:number,district?:string,siding=false):RailPoint=>({id,x,z,district,siding});

export function buildCampusFab(rail:Rail,areas:readonly FabAreaSetup[],fleet:number,edit=defaultRailEdit()){
  const floor:CampusFabFloor={width:73,depth:areas.length===1?42:52,areas:[]};
  const positioned:PositionedTool[]=[];
  const parking:LineParking[]=[];
  const near:{point:RailPoint;access:RailPoint;hub:number;section:FabSections;capacity:number}[]=[];
  const homeAccess=point('spine-west-load',-31,0);
  const centralAccess=point('spine-east-load',31,0);
  const home={point:point('home',-34,0,undefined,true),access:homeAccess,hub:-1};
  const central={point:point('stocker',34,0,undefined,true),access:centralAccess,hub:-1};
  for(const {point,access} of [home,central])rail.link(access,point,false,true,'siding');

  const spine=([-1,1] as const).map((sign,row)=>{
    const section=(row+1) as FabSections;
    const direction=-sign;
    const end=(phase:'in'|'out',x:number)=>point('spine-'+section+'-'+phase,x,sign*2.5);
    const entry=end('in',-direction*26.4),exit=end('out',direction*26.4);
    const points=[end('in',-direction*30),entry,exit,end('out',direction*30)];
    points[0].id+='-end';
    points[3].id+='-end';
    const area=areas.find(item=>item.section===section);
    if(!area)return {sign,points};

    const district='line-'+section;
    const {product,tools}=area;
    const spans=tools.map(tool=>tool==='track'?7.72:4.12);
    const used=spans.reduce((sum,width)=>sum+width,0);
    const rowEnd=used/2+3.9;
    const z=areas.length===1?-9.2:sign*14.25;
    const line:CampusFabLine={section,product,district,width:2*(rowEnd+2.2),depth:18,z};
    floor.areas.push(line);
    const make=(id:string,x:number,z:number,siding=false)=>point(district+'-'+id,x,z,district,siding);
    const innerZ=z-sign*2.32,outerZ=z+sign*2.32;
    const innerStart=make('entry',-direction*rowEnd,innerZ),innerEnd=make('east-in',direction*rowEnd,innerZ);
    const outerStart=make('east-out',direction*rowEnd,outerZ),outerEnd=make('return',-direction*rowEnd,outerZ);
    const hub=parking.length,spots:RailPoint[]=Array(fleet);
    parking.push({section,hub,spots});

    function rowRail(copy:number,from:RailPoint,to:RailPoint,travel:number,outside:number){
      let previous=from,position=-used/2;
      const indexes=Array.from({length:fleet},(_,i)=>i).filter(i=>i%2===copy-1);
      const parkingAt=new Map(indexes.map((id,i)=>[Math.floor((i+.5)*tools.length/indexes.length),id]));
      for(const [index,tool] of tools.entries()){
        const span=spans[index],mid=travel*(position+span/2);
        const x=tool==='track'?mid+outside*scannerOffset/2:mid;
        position+=span;
        const tag=tool+'-'+copy;
        const approach=make(tag+'-in',x-travel*1.18,from.z);
        const departure=make(tag+'-out',x+travel*1.18,from.z);
        const access=make(tag+'-access',x,from.z);
        const station=tool+(section===1?'':'/zone-2')+(copy===1?'':'/parallel-'+copy);
        const portEdit=edit.ports[station];
        const port=point(station,x+(portEdit?.offset??0),from.z+outside*1.16,district,true);
        rail.link(previous,approach,false,false,'bay');
        rail.link(approach,departure,false,false,'bay');
        if(portEdit?.open!==false){
          rail.link(approach,port,false,false,'siding');
          rail.link(port,departure,false,false,'siding');
        }
        const car=parkingAt.get(index);
        if(car!==undefined){
          const spot=point('bay-'+hub+'-'+car,x,from.z-outside*1.28,district,true);
          spots[car]=spot;
          rail.link(approach,spot,false,false,'siding');
          rail.link(spot,departure,false,false,'siding');
        }
        positioned.push({logical:tool,point:port,access,hub,section,bay:bayFor(tool)??'film',product,copy});
        previous=departure;
      }
      rail.link(previous,to,false,false,'bay');
    }
    function turn(from:RailPoint,to:RailPoint,x:number,id:string){
      const a=make(id+'-a',x,from.z+Math.sign(to.z-from.z)*.86);
      const b=make(id+'-b',x,to.z-Math.sign(to.z-from.z)*.86);
      for(const [start,end] of [[from,a],[a,b],[b,to]])rail.link(start,end,false,false,'bay');
    }
    rail.link(entry,innerStart,false,false,'bay');
    rowRail(1,innerStart,innerEnd,direction,-sign);
    turn(innerEnd,outerStart,direction*(rowEnd+1.4),'turn-end');
    rowRail(2,outerStart,outerEnd,-direction,sign);
    turn(outerEnd,innerStart,-direction*(rowEnd+1.4),'turn-start');
    rail.link(innerEnd,exit,false,false,'bay');

    const bufferEdit=edit.buffers[section];
    const buffer=point('buffer-'+district,outerEnd.x+(bufferEdit?.offset??0),outerZ+sign*1.35,district,true);
    rail.link(outerEnd,buffer,false,true,'siding');
    near.push({point:buffer,access:outerEnd,hub,section,capacity:bufferEdit?.capacity??2});
    return {sign,points};
  });
  for(const [index,x] of [edit.west,edit.east].entries()){
    const north=point('spine-cross-north-'+index,x,-2.5),south=point('spine-cross-south-'+index,x,2.5);
    spine[0].points.push(north);spine[1].points.push(south);
    if(index===0?edit.westOpen:edit.eastOpen)rail.link(index===0?south:north,index===0?north:south,true,false,'spine');
  }
  const [north,south]=spine.map(({points,sign})=>points.sort((a,b)=>(a.x-b.x)*-sign));
  for(const row of [north,south])for(let i=1;i<row.length;i++)rail.link(row[i-1],row[i],false,false,'spine');
  rail.link(north.at(-1)!,centralAccess,false,false,'spine');
  rail.link(centralAccess,south[0],false,false,'spine');
  rail.link(south.at(-1)!,homeAccess,false,false,'spine');
  rail.link(homeAccess,north[0],false,false,'spine');
  return {floor,positioned,parking,near,home,central};
}
