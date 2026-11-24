import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FabSimulation, PRODUCTS } from '../src/simulation';
import type { Action, Point, ProductId } from '../src/simulation';
import {defaultLine,dockOf} from '../src/line-layout';
import {measureMetrics,validateMeasurement,type Measurement} from '../src/fab-metrics';

const productIds=Object.keys(PRODUCTS) as ProductId[];
const near=(a:number,b:number)=>Math.abs(a-b)<1e-7;
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function complete(id:ProductId){
  const sim=new FabSimulation(id);
  sim.seek(sim.snapshot.duration);
  return sim.snapshot;
}

for(const productId of productIds){
  test(productId+' processes both carriers and preserves original slots',()=>{
    const end=complete(productId);
    assert.ok(end.finished);
    for(const lot of end.carriers){
      assert.ok(lot.done);
      assert.equal(lot.station,'stocker');
      assert.equal(lot.wafer.owner,'slot');
      assert.equal(lot.doorOpen,0);
      const itinerary=end.events.filter(e=>e.carrierId===lot.id);
      assert.deepEqual(itinerary.filter(e=>e.kind==='process').map(e=>e.label),
        PRODUCTS[productId].steps.map(s=>s.label+' 완료'));
      assert.equal(itinerary.filter(e=>e.kind==='delivery').length,lot.completedTransfers);
      assert.equal(itinerary.filter(e=>e.kind==='delivery'&&e.station==='scanner').length,0);
      assert.equal(lot.wafer.slot,lot.id==='FOUP-01'?13:8);
    }
  });
}
test('baseline has exactly four distinct external transfers and all six processes per carrier',()=>{
  const {events,carriers}=complete('baseline');
  for(const c of carriers){
    assert.equal(c.completedTransfers,4);
    assert.equal(c.completedSteps,6);
    assert.deepEqual(events.filter(e=>e.carrierId===c.id&&e.kind==='delivery').map(e=>e.station),
      ['deposition','track','etch_strip','stocker']);
  }
});
test('resource exclusivity, aligned handoffs, and continuity during ten round trips',()=>{
  const sim=new FabSimulation();
  for(let round=0;round<10;round++){
    sim.reset(productIds[round%productIds.length]);
    const duration=sim.snapshot.duration;
    const docks=defaultLine(PRODUCTS[sim.snapshot.productId].steps).machines.filter(m=>m.kind!=='scanner').map(dockOf);
    let previous=sim.snapshot;
    const dt=0.24;
    for(let t=dt;t<=duration+dt;t+=dt){
      sim.seek(t);
      const state=sim.snapshot;
      const places=state.carriers.map(lot=>lot.station).filter(s=>s&&s!=='stocker');
      assert.equal(new Set(places).size,places.length);
      for(const [i,v] of state.vehicles.entries()){
        assert.ok(distance(previous.vehicles[i].position,v.position)<=dt*2.02);
        for(const other of state.vehicles.slice(i+1))assert.ok(distance(v.position,other.position)>.92,'OHT 차간 거리');
        if(v.hoistY<3.51)assert.ok(docks.some(({x,z})=>near(x,v.position.x)&&near(z,v.position.z)));
      }
      for(const [i,c] of state.carriers.entries()){
        assert.ok(distance(previous.carriers[i].position,c.position)<=dt*2.3);
        if(c.station===null){
          const v=state.vehicles.find(vehicle=>vehicle.carrierId===c.id);
          assert.ok(v);
          assert.ok(near(c.position.x,v.position.x)&&near(c.position.z,v.position.z));
          assert.ok(near(c.position.y+0.338,v.hoistY));
          assert.equal(c.doorOpen,0);
          assert.equal(c.wafer.owner,'slot');
        }
        if(c.wafer.owner!=='slot'){
          assert.equal(c.doorOpen,1);
          assert.ok(c.station && c.station!=='stocker');
        }
      }
      previous=state;
    }
  }
});
test('seek reconstructs the same frame and changing product clears all prior operations',()=>{
  const sim=new FabSimulation();
  sim.advance(22);const frame=sim.snapshot;
  sim.advance(36);sim.seek(22);
  assert.deepEqual(sim.snapshot,frame);
  assert.ok(sim.nextEventTime()>22);
  sim.reset('mcu');
  assert.equal(sim.snapshot.time,0);
  assert.equal(sim.snapshot.stepsCompleted,0);
  assert.equal(sim.snapshot.carriers[0].wafer.material.layers,1);
  assert.ok(Object.values(sim.snapshot.equipment).every(tool=>tool.status==='idle'||tool.status==='reserved'));
  sim.seek(-500);assert.equal(sim.snapshot.time,0);
  sim.seek(Number.MAX_VALUE);assert.ok(sim.snapshot.finished);
  assert.equal(sim.nextEventTime(),sim.snapshot.duration);
});
test('available vehicles are dispatched concurrently and continuous playback returns both lots to the next cycle',()=>{
  const line=defaultLine(PRODUCTS.baseline.steps);line.fleetSize=6;
  const sim=new FabSimulation('baseline',line),initial=sim.snapshot;
  assert.equal(initial.vehicles.length,6);
  let dispatchTogether=false;
  for(let t=0;t<initial.duration;t+=.2){
    sim.seek(t);
    if(sim.snapshot.vehicles.filter(v=>v.busy).length>=2)dispatchTogether=true;
  }
  assert.ok(dispatchTogether);
  sim.seek(initial.duration);
  assert.deepEqual(sim.snapshot.vehicles.map(v=>v.position),initial.vehicles.map(v=>v.position));
  assert.ok(sim.snapshot.vehicles.every(v=>!v.busy));
  assert.deepEqual(sim.snapshot.carriers.map(c=>c.position),initial.carriers.map(c=>c.position));
  sim.advanceContinuous(initial.duration+.25);
  assert.equal(sim.snapshot.cycle,3);
  assert.ok(near(sim.time,.25));
  assert.equal(sim.snapshot.stepsCompleted,0);
  assert.equal(sim.finished,false);
});

test('production metrics count finished wafers once across cycles and use simulated time',()=>{
  const sim=new FabSimulation(),period=sim.snapshot.duration;
  const initial=measureMetrics(sim.metricsTimeline);
  assert.deepEqual([initial.starts,initial.wip,initial.completed,initial.wph],[2,2,0,null]);
  sim.seek(period);
  const completed=measureMetrics(sim.metricsTimeline);
  assert.deepEqual([completed.completed,completed.starts,completed.wip,completed.deliveries],[2,2,0,8]);
  assert.ok(near(completed.wph!,2*3600/period));
  assert.ok(completed.pickupP95!>=completed.pickupMean!&&completed.handoffP95!>=completed.handoffMean!);
  assert.ok(completed.processing!>0&&completed.starved!>0&&completed.blocked!>0);
  const deposition=measureMetrics(sim.metricsTimeline,period,undefined,[],'deposition');
  const scanner=measureMetrics(sim.metricsTimeline,period,undefined,[],'scanner');
  assert.equal(deposition.processing,10);
  assert.equal(scanner.processing,6);
  assert.equal(scanner.ports,null);
  assert.equal(deposition.completed,completed.completed);
  const elapsed=period*3+2;
  const whole=new FabSimulation(),steps=new FabSimulation();
  whole.advanceContinuous(elapsed);
  for(let i=0;i<16;i++)steps.advanceContinuous(elapsed/16);
  const once=measureMetrics(whole.metricsTimeline),sampled=measureMetrics(steps.metricsTimeline);
  assert.deepEqual([once.completed,once.starts,once.wip],[6,8,2]);
  assert.ok(near(once.wph!,sampled.wph!));
  assert.ok(near(once.pickupP95!,sampled.pickupP95!));
  assert.equal(measureMetrics(whole.metricsTimeline,period-.01).completed,2);
  const before=whole.totalTime-whole.time;
  const interval=whole.startEtch(0,4,'short');
  assert.ok(near(whole.totalTime,before+interval.start));
  assert.deepEqual(measureMetrics(whole.metricsTimeline,before-.01),measureMetrics(steps.metricsTimeline,before-.01));
  whole.reset();
  assert.equal(measureMetrics(whole.metricsTimeline).completed,0);
});

test('targets and entered quality, maintenance and resource values use matching denominators',()=>{
  const sim=new FabSimulation();
  sim.seek(sim.snapshot.duration);
  const done=sim.snapshot.events.filter(e=>e.kind==='complete');
  const readings:Measurement[]=[
    {time:1,group:'quality',values:{tested:100,good:90,wafers:10,reworked:2,scrapped:1}},
    {time:2,group:'maintenance',values:{failures:2,uptime:20,downtime:3}},
    {time:3,group:'resources',values:{wafers:10,energy:20,water:40,cost:10000,good:100}},
  ];
  assert.equal(measureMetrics(sim.metricsTimeline).yield,null);
  assert.equal(measureMetrics(sim.metricsTimeline,2,undefined,readings).energy,null);
  const v=measureMetrics(sim.metricsTimeline,sim.totalTime,{wph:25,dueSeconds:done[0].time},readings);
  assert.deepEqual([v.yield,v.rework,v.scrap,v.good,v.onTime],[90,20,10,90,50]);
  const overdue=measureMetrics(sim.metricsTimeline,5,{wph:null,dueSeconds:1});
  assert.equal(overdue.completed,0);
  assert.equal(overdue.onTime,0);
  assert.deepEqual([v.failures,v.downtime,v.mtbf,v.mttr,v.energy,v.water,v.cost],[2,3,10,1.5,2,4,100]);
  assert.ok(near(v.target!,v.wph!*100/25));
  assert.equal(validateMeasurement('quality',readings[0].values),null);
  assert.ok(validateMeasurement('quality',{...readings[0].values,good:101}));
  assert.ok(validateMeasurement('maintenance',{...readings[1].values,failures:0}));
  assert.ok(validateMeasurement('resources',{...readings[2].values,wafers:-1}));
});
test('each product changes an executed action sequence',()=>{
  const recipes=productIds.map(id=>PRODUCTS[id].steps.map(s=>s.action as Action).join(','));
  assert.equal(new Set(recipes).size,productIds.length);
});

test('each etch uses the selected slot and layer, replays from the same point and preserves the protected film',()=>{
  for(const product of productIds){
    const sim=new FabSimulation(product);
    const indices=PRODUCTS[product].steps.flatMap((s,i)=>s.action==='etch'?[i]:[]);
    for(const index of indices) for(const lot of [0,1]){
      const run=(condition:'short'|'standard')=>{
        const {start,end}=sim.startEtch(lot,index,condition);
        const before=sim.snapshot.carriers[lot];
        assert.equal(before.activeStepIndex,index);
        assert.equal(before.wafer.material.resist,'developed');
        assert.equal(before.wafer.material.opening,1);
        sim.seek((start+end)/2);
        assert.ok(near(sim.snapshot.carriers[lot].wafer.material.opening,condition==='short'?.75:.5));
        sim.seek(end);
        const after=sim.snapshot.carriers[lot];
        assert.equal(after.wafer.id,before.wafer.id);
        assert.equal(after.wafer.slot,before.wafer.slot);
        assert.equal(after.wafer.material.protected,1);
        assert.ok(near(after.wafer.material.opening,condition==='short'?.5:0));
        assert.equal(after.completedSteps,index+1);
        return {start,position:before.wafer.position,after:after.wafer.material};
      };
      const first=run('standard'),short=run('short');
      assert.equal(first.start,short.start);
      assert.deepEqual(first.position,short.position);
      assert.deepEqual(run('standard'),first);
    }
  }
});
