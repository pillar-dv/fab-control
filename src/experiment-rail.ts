export type RailTopology='loop'|'bypass'|'dual'|'relay'|'vertical';
export interface RailPoint {id:string; x:number; z:number; elevation?:number; lane?:number; district?:string; siding?:boolean}
export interface RailEdge {from:RailPoint; to:RailPoint; block:string; seconds:number; bypass:boolean; kind?:'spine'|'bay'|'siding'|'secondary'|'switch'}
export interface Reservation {resource:string; start:number; end:number; vehicle?:number}
export interface RailMotion {from:RailPoint; to:RailPoint; start:number; end:number; phase:'empty'|'loaded'|'pickup'|'drop'|'stage'}
export const closedBlock = 'rail:1-2';
export const secondaryBlock = 'rail:reverse-2-reverse-1';
export const hubs:RailPoint[] = [[-9,-5],[0,-5],[9,-5],[9,5],[0,5],[-9,5]]
  .map(([x,z],i)=>({id:String(i),x,z}));

export function reservationConflicts(bookings:Reservation[]){
  const resourceBookings=new Map<string,Reservation[]>();
  for(const booking of bookings){
    const slots=resourceBookings.get(booking.resource)??[];
    slots.push(booking);resourceBookings.set(booking.resource,slots);
  }
  const conflicts:number[]=[];
  for(const slots of resourceBookings.values()){
    slots.sort((a,b)=>a.start-b.start);
    for(const [i,slot] of slots.entries()){
      for(let j=i+1;j<slots.length&&slots[j].start<slot.end-1e-7;j++){
        if(slot.vehicle===undefined||slot.vehicle!==slots[j].vehicle)conflicts.push(slots[j].start);
      }
    }
  }
  return conflicts;
}

export function createRail(layout:'experiment'|'campus'='experiment',topology:RailTopology='bypass') {
  const edges:RailEdge[]=[];
  const blocks=new Map<string,Reservation[]>();
  const paths=new Map<string,RailEdge[][]>();
  const connections=new Map<string,RailEdge[]>();
  const secondary=layout==='experiment'&&['dual','relay','vertical'].includes(topology)?hubs.map((point,i)=>({
    x:point.x*1.23,z:point.z*(topology==='vertical'?1.12:1.52),lane:1,id:'reverse-'+i,elevation:topology==='vertical'?3.3:0,
  })):[];
  function link(from:RailPoint,to:RailPoint,bypass=false,twoWay=false,kind?:RailEdge['kind']) {
    const block='rail:'+from.id+'-'+to.id;
    const seconds=Math.max(.6,Math.hypot(from.x-to.x,from.z-to.z)/2.6);
    function connect(a:RailPoint,b:RailPoint) {
      const edge={from:a,to:b,block,seconds,bypass,kind};
      edges.push(edge);
      const adjacent=connections.get(a.id)??[];
      adjacent.push(edge);
      connections.set(a.id,adjacent);
    }
    connect(from,to);
    if(twoWay)connect(to,from);
  }
  if(layout==='experiment'){
    hubs.forEach((hub,i)=>link(hub,hubs[(i+1)%hubs.length],false,false,'spine'));
    if(topology==='bypass'){
      link(hubs[1],hubs[4],true,true);
      const detour={id:'detour',x:4.5,z:-8};
      link(hubs[1],detour,true);
      link(detour,hubs[2],true);
    }
    secondary.forEach((hub,i)=>link(hub,secondary[(i+secondary.length-1)%secondary.length],false,false,'secondary'));
    if(topology==='dual')for(const i of [0,3])link(hubs[i],secondary[i],false,true,'switch');
  }

  function routes(from:RailPoint,to:RailPoint,bypass:boolean):RailEdge[][] {
    const key=[from.id,to.id,bypass].join('/');
    const existing=paths.get(key);
    if(existing)return existing;
    const found:RailEdge[][]=[];
    function visit(node:string,visited:Set<string>,path:RailEdge[]) {
      if(node===to.id){found.push(path);return;}
      for(const edge of connections.get(node)??[]){
        if((!bypass&&edge.bypass)||visited.has(edge.to.id))continue;
        const district=edge.to.district;
        if(district&&district!==from.district&&district!==to.district)continue;
        if(edge.to.siding&&edge.to.id!==to.id)continue;
        visit(edge.to.id,new Set([...visited,edge.to.id]),[...path,edge]);
      }
    }
    visit(from.id,new Set([from.id]),[]);
    paths.set(key,found);
    return found;
  }

  function firstEndingAfter(history:Reservation[],time:number){
    let first=0,end=history.length;
    while(first<end){
      const middle=(first+end)>>>1;
      if(history[middle].end<=time)first=middle+1;
      else end=middle;
    }
    return first;
  }
  function commit(reservations:Reservation[]) {
    for(const entry of reservations){
      const history=blocks.get(entry.resource)??[];
      const first=firstEndingAfter(history,entry.start);
      let last=first,end=entry.end;
      while(last<history.length&&history[last].start<end){end=Math.max(end,history[last].end);last++;}
      history.splice(first,last-first,{...entry,start:Math.min(entry.start,first<last?history[first].start:entry.start),end});
      blocks.set(entry.resource,history);
    }
  }
  function freeTime(slots:Reservation[],now:number){
    let depart=now,mergeWait=0;
    while(true){
      let next=depart,resource='';
      for(const slot of slots){
        const history=blocks.get(slot.resource);
        if(!history)continue;
        for(let i=firstEndingAfter(history,depart+slot.start+1e-7);i<history.length&&history[i].start<depart+slot.end-1e-7;i++){
          const booked=history[i];
          if(booked.end-slot.start>next){
            next=booked.end-slot.start;
            resource=slot.resource;
          }
        }
      }
      if(next<=depart+1e-7)return {depart,mergeWait};
      if(resource.startsWith('merge:'))mergeWait+=next-depart;
      depart=next;
    }
  }
  function schedule(resources:string[],now:number,seconds:number){
    const {depart}=freeTime(resources.map(resource=>({resource,start:0,end:seconds})),now);
    return {start:depart,end:depart+seconds,reservations:resources.map(resource=>({resource,start:depart,end:depart+seconds}))};
  }
  function plan(now:number, legs:{edges:RailEdge[]; phase:RailMotion['phase']}[],
    source?:RailPoint,target?:RailPoint,available=0,car?:number) {
    const slots:Reservation[]=[];
    const motion:RailMotion[]=[];
    let time=0,pickup=0,delivery=0,dropStart=0;
    function occupy(resource:string,start:number,end:number){slots.push({resource,start,end,vehicle:car});}
    function hoist(point:RailPoint,phase:'pickup'|'drop'){
      occupy('dock:'+point.id,time,time+2.5);
      motion.push({from:point,to:point,start:time,end:time+2.5,phase});
      time+=2.5;
    }
    legs.forEach(({edges,phase},index)=>{
      for(const edge of edges){
        occupy(edge.block,time,time+edge.seconds);
        occupy('merge:'+edge.from.id,time-.2,time+.35);
        motion.push({from:edge.from,to:edge.to,start:time,end:time+edge.seconds,phase});
        time+=edge.seconds;
        occupy('merge:'+edge.to.id,time-.2,time+.35);
      }
      if(index===0&&source){hoist(source,'pickup');pickup=time;}
      if(index===1&&target){dropStart=time;hoist(target,'drop');delivery=time;}
    });
    if(car!==undefined)occupy('vehicle:'+car,0,time);
    const {depart,mergeWait}=freeTime(slots,Math.max(now,available-dropStart));
    const shift=<T extends {start:number;end:number}>(entry:T):T=>({...entry,start:entry.start+depart,end:entry.end+depart});
    return {depart,end:depart+time,pickup:depart+pickup,delivery:depart+delivery,mergeWait,
      get reservations(){return slots.map(shift);},get motion(){return motion.map(shift);}};
  }
  return {edges,secondary,link,routes,commit,plan,schedule};
}
export type RailPlan=ReturnType<ReturnType<typeof createRail>['plan']>;
