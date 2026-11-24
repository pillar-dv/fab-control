import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultLine,dockOf,issuesFor,newMachine} from '../src/line-layout';
import {FabSimulation,PRODUCTS} from '../src/simulation';

const baseline=()=>defaultLine(PRODUCTS.baseline.steps);
test('reference ports, handoff order and the six wafer sections agree with the project reference',()=>{
  const line=baseline(),sim=new FabSimulation('baseline',line);
  assert.deepEqual(line.machines.filter(m=>m.kind!=='scanner').map(m=>{
    const p=dockOf(m);return [m.id,m.facing,p.x,p.z];
  }),[['stocker',0,4,7.5],['deposition',0,14,7.5],['track',0,25,7.5],['etch_strip',180,14,10.5]]);
  const expected=[
    ['none',1,1],['coated',1,1],['exposed',1,1],['developed',1,1],['developed',0,1],['none',0,1]
  ];
  for(const lot of [0,1]){
    const visit:string[]=[];
    for(let time=0;time<sim.stepInterval(lot,0).start;time+=.1){
      sim.seek(time);const c=sim.snapshot.carriers[lot];
      if(c.station==='deposition'&&visit.at(-1)!==c.wafer.owner)visit.push(c.wafer.owner);
    }
    assert.deepEqual(visit,['slot','atmosphere_robot','load_lock','vacuum_robot']);
    expected.forEach((profile,index)=>{
      sim.seek(sim.stepInterval(lot,index).end);
      const m=sim.snapshot.carriers[lot].wafer.material;
      assert.deepEqual([m.resist,m.opening,m.protected],profile);
    });
  }
});
test('cloned etcher, replacement tool and moved stocker drive actual dock, chamber and return poses',()=>{
  const line=baseline(),etch=newMachine(line,'etch_strip');line.machines.push(etch);
  line.steps[4].station=etch.id;
  const dep=line.machines.find(m=>m.kind==='deposition')!;dep.id='deposition-2';line.steps[0].station=dep.id;
  const store=line.machines.find(m=>m.kind==='stocker')!;store.x+=1;
  assert.deepEqual(issuesFor(line,'baseline'),[]);
  const sim=new FabSimulation('baseline',line);
  for(const lot of [0,1]){
    const {start,end}=sim.stepInterval(lot,4);sim.seek((start+end)/2);
    const frame=sim.snapshot,c=frame.carriers[lot],dock=dockOf(etch);
    assert.equal(c.station,etch.id);assert.equal(c.wafer.owner,'chamber');
    assert.equal(frame.equipment[etch.id].status,'processing');assert.deepEqual(c.position,dock);
    assert.ok(Math.abs(c.wafer.position.x-etch.x)<=1.5);
    assert.ok(Math.abs(c.wafer.position.z-etch.z)<1);
  }
  sim.seek(sim.snapshot.duration);
  for(const [i,c] of sim.snapshot.carriers.entries()){
    assert.equal(c.done,true);assert.equal(c.completedSteps,6);assert.equal(c.station,store.id);
    assert.equal(c.position.x,dockOf(store).x+(i===0?-.75:.75));
    const events=sim.snapshot.events.filter(e=>e.carrierId===c.id);
    assert.deepEqual(events.filter(e=>e.kind==='delivery').map(e=>e.station),[dep.id,'track',etch.id,'etch_strip',store.id]);
    assert.deepEqual(events.filter(e=>e.kind==='process').map(e=>e.station),line.steps.map(s=>s.station));
  }
  sim.reset();sim.seek(sim.stepInterval(0,4).start);assert.equal(sim.snapshot.carriers[0].station,etch.id);
});
test('disconnected, overlapping or incompatible drafts cannot start; restoring them restores operation',()=>{
  for(const mutate of [
    (l:ReturnType<typeof baseline>)=>{l.machines=l.machines.filter(m=>m.id!=='stocker');},
    (l:ReturnType<typeof baseline>)=>{l.rails.east=false;},
    (l:ReturnType<typeof baseline>)=>{l.oht=false;},
    (l:ReturnType<typeof baseline>)=>{l.machines[0].x=l.machines[1].x;},
    (l:ReturnType<typeof baseline>)=>{l.machines[0].facing=180;},
    (l:ReturnType<typeof baseline>)=>{l.machines.find(m=>m.kind==='scanner')!.x+=.5;},
    (l:ReturnType<typeof baseline>)=>{l.steps[4].station='track';},
    (l:ReturnType<typeof baseline>)=>{l.steps.splice(2,1);},
    (l:ReturnType<typeof baseline>)=>{l.steps=[];},
  ]){
    const before=baseline(),after=structuredClone(before);mutate(after);
    assert.ok(issuesFor(after,'baseline').length);assert.throws(()=>new FabSimulation('baseline',after));
    assert.doesNotThrow(()=>new FabSimulation('baseline',before));
  }
});
test('rotated south track and scanner share the track port and stage in their moved bay',()=>{
  const l=baseline();
  l.machines.find(m=>m.id==='track')!.x=29;l.machines.find(m=>m.id==='scanner')!.x=22.5;
  for(const m of l.machines.filter(m=>m.kind==='track'||m.kind==='scanner')){m.z=13.5;m.facing=180;}
  assert.deepEqual(issuesFor(l,'baseline'),[]);
  const sim=new FabSimulation('baseline',l);sim.seek(sim.stepInterval(0,2).start+.1);
  const c=sim.snapshot.carriers[0];assert.equal(c.station,'track');assert.equal(c.wafer.owner,'scanner_stage');
  assert.equal(c.wafer.position.x,22.6);assert.equal(c.wafer.position.z,13.7);
});
