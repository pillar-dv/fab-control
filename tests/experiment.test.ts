import assert from 'node:assert/strict';
import {test} from 'node:test';
import {baselinePolicy,chamberCycle,defaultInput,metricsAt,runExperiment,type ExperimentPolicy} from '../src/fab-experiment';
import {closedBlock,secondaryBlock} from '../src/experiment-rail';
import {analyzeTraffic,compareFleet,plannedTraffic} from '../src/experiment-analysis';
import {PRODUCTS,type ProductId} from '../src/simulation';
import {parseFieldLog,sampleFieldLog,summarizeField,summarizeModel} from '../src/field-log';

const assisted:ExperimentPolicy={...baselinePolicy,staging:true,bypass:true,buffer:'direct',chambers:2,order:'unload'};
const overlaps=(a:{start:number;end:number},b:{start:number;end:number})=>a.start<b.end-1e-6&&b.start<a.end-1e-6;

test('fixed inputs produce repeatable schedules and independent compatible tool allocation',()=>{
  const standard=runExperiment(defaultInput,baselinePolicy);
  assert.deepEqual(runExperiment(defaultInput,baselinePolicy).transfers,standard.transfers);
  const dedicated=runExperiment(defaultInput,{...baselinePolicy,dedicated:true});
  assert.deepEqual(standard.lots.map(lot=>[lot.release,lot.product]),dedicated.lots.map(lot=>[lot.release,lot.product]));
  assert.ok(standard.work.some(run=>run.station==='track'&&standard.lots[run.lot-1].product==='dram'));
  assert.ok(standard.work.some(run=>run.station==='track'&&standard.lots[run.lot-1].product==='nand'));
  assert.ok(dedicated.work.some(run=>run.station==='track/dram'));
  assert.ok(dedicated.work.some(run=>run.station==='track/nand'));
  assert.ok(standard.stations.some(station=>station.point.id==='deep_etch'));
  assert.ok(dedicated.work.every(run=>!run.station.includes('/')||run.station.split('/')[1]===dedicated.lots[run.lot-1].product));
  for(const product of Object.keys(PRODUCTS) as ProductId[]){
    const trial=runExperiment({...defaultInput,primary:product,secondary:'',lots:1,horizon:2400},assisted);
    assert.equal(trial.metrics.lots,1,product);
    assert.deepEqual(trial.work.flatMap(run=>[...new Set(run.activities.filter(task=>task.kind==='load'&&task.wafer===1).map(task=>task.step))]),
      PRODUCTS[product].steps.map(step=>step.label),product);
  }
});

test('dispatch reserves rail blocks, merges, hoists, and releases every tool port on pickup',()=>{
  const result=runExperiment({...defaultInput,fleet:6},assisted);
  const resources=new Map<string,typeof result.bookings>();
  for(const entry of result.bookings){
    const group=resources.get(entry.resource)??[];
    group.push(entry);resources.set(entry.resource,group);
  }
  for(const [resource,group] of resources){
    group.sort((a,b)=>a.start-b.start);
    group.forEach((booking,i)=>{
      for(let j=i+1;j<group.length&&group[j].start<booking.end-1e-6;j++){
        if(booking.vehicle!==group[j].vehicle)assert.ok(!overlaps(booking,group[j]),resource);
      }
    });
  }
  for(const station of result.stations.filter(station=>station.type==='tool')){
    let occupied=false;
    const visits=result.transfers.flatMap(trip=>[
      ...(trip.source===station.point.id?[{time:trip.pickup,arrived:false}]:[]),
      ...(trip.destination===station.point.id?[{time:trip.delivery,arrived:true}]:[]),
    ]).sort((a,b)=>a.time-b.time||Number(a.arrived)-Number(b.arrived));
    for(const visit of visits){assert.equal(occupied,!visit.arrived,station.point.id);occupied=visit.arrived;}
  }
  assert.ok(result.metrics.staged>0);
  assert.ok(result.metrics.bypasses>0);
  assert.equal(result.vehicles.length,6);
});

test('near and central storage reserve finite capacity and direct booking skips storage',()=>{
  const direct=runExperiment(defaultInput,{...baselinePolicy,buffer:'direct'});
  const waiting=runExperiment(defaultInput,baselinePolicy);
  assert.equal(direct.metrics.bufferMoves,0);
  assert.notDeepEqual(direct.transfers,waiting.transfers);
  for(const buffer of ['near','central'] as const){
    const result=runExperiment(defaultInput,{...baselinePolicy,buffer});
    assert.ok(result.metrics.bufferMoves>0);
    for(const station of result.stations.filter(station=>station.type==='buffer')){
      let occupied=0;
      const visits=result.transfers.flatMap(trip=>[
        ...(trip.source===station.point.id?[{time:trip.pickup,change:-1}]:[]),
        ...(trip.destination===station.point.id?[{time:trip.delivery,change:1}]:[]),
      ]).sort((a,b)=>a.time-b.time||a.change-b.change);
      for(const {change} of visits){
        occupied+=change;assert.ok(occupied>=0&&occupied<=station.capacity,station.point.id);
      }
    }
  }
});

test('one robot serializes wafer handoffs with parallel processing and distinct order policies',()=>{
  const steps=PRODUCTS.nand.steps.slice(0,1);
  const serial=chamberCycle(steps,8,1,'feed',0);
  const feed=chamberCycle(steps,8,3,'feed',0);
  const unload=chamberCycle(steps,8,3,'unload',0);
  assert.ok(feed.end<serial.end);
  assert.notDeepEqual(feed.activities,unload.activities);
  for(const cycle of [serial,feed,unload]){
    const handling=cycle.activities.filter(activity=>activity.kind!=='process');
    assert.equal(handling.length,16);
    assert.ok(handling.every((task,i)=>!i||!overlaps(handling[i-1],task)));
    for(let chamber=1;chamber<=3;chamber++){
      const tasks=cycle.activities.filter(activity=>activity.chamber===chamber);
      assert.ok(tasks.every((task,i)=>!i||!overlaps(tasks[i-1],task)));
    }
  }
});

test('closed assets receive no reservations and unserved demand remains in the horizon total',()=>{
  const common={...defaultInput,outageAt:35,outageLength:100};
  const stops={start:35,end:135};
  const truck=runExperiment({...common,outage:'vehicle'},assisted);
  assert.ok(truck.bookings.filter(item=>item.resource==='vehicle:1').every(item=>!overlaps(item,stops)));
  assert.ok(truck.metrics.recovery!==null);
  const closure=runExperiment({...common,outage:'rail'},assisted);
  assert.ok(closure.bookings.filter(item=>item.resource===closedBlock).every(item=>!overlaps(item,stops)));
  assert.ok(closure.transfers.some(trip=>trip.bypass&&trip.dispatch>=stops.start&&trip.delivery<stops.end));
  const port=runExperiment({...common,outage:'port'},assisted);
  assert.ok(port.bookings.filter(item=>item.resource==='dock:'+port.outagePort).every(item=>!overlaps(item,stops)));
  assert.ok(port.metrics.recovery!==null);
  const short=metricsAt(closure,80);
  assert.ok(short.incomplete>0);
  assert.equal(short.recovery,null);
  assert.ok(short.remainingLots>0);
});

test('directional rails reroute around a closed main block while independent loops hand over FOUPs',()=>{
  const input={...defaultInput,horizon:2400,outage:'rail' as const,outageAt:35,outageLength:350};
  const closure={start:35,end:385};
  const loop=runExperiment(input,baselinePolicy);
  const dual=runExperiment(input,{...assisted,topology:'dual',buffer:'near'});
  assert.ok(dual.metrics.recoveryPorts!>loop.metrics.recoveryPorts!);
  assert.ok(dual.edges.some(edge=>edge.kind==='switch'));
  assert.ok(dual.transfers.some(trip=>trip.dispatch>=closure.start&&trip.delivery<=closure.end&&trip.blocks.some(id=>id.startsWith('rail:reverse'))));
  assert.ok(dual.bookings.filter(booking=>booking.resource===closedBlock).every(booking=>!overlaps(booking,closure)));
  assert.ok(dual.metrics.railMeters>loop.metrics.railMeters);
  const reverse=runExperiment({...input,outage:'secondary'},{...assisted,topology:'dual'});
  assert.ok(reverse.bookings.filter(booking=>booking.resource===secondaryBlock).every(booking=>!overlaps(booking,closure)));
  for(const topology of ['relay','vertical'] as const){
    const result=runExperiment({...input,outage:'lift',liftSeconds:14},{...assisted,topology});
    assert.ok(result.metrics.lots>0);
    assert.ok(result.relays.length>0);
    assert.ok(result.relays.every(move=>move.from.lane!==move.to.lane&&!overlaps(move,closure)));
    assert.ok(result.relays.every((move,i)=>i===0||!overlaps(move,result.relays[i-1])));
    assert.ok(result.vehicles.every(car=>car.motion.every(motion=>(motion.from.lane??0)===(car.initial.lane??0))));
    for(const move of result.relays){
      assert.ok(result.transfers.some(trip=>trip.lot===move.lot&&trip.destination===move.from.id&&trip.delivery<=move.start));
      assert.equal((move.to.elevation??0)!==(move.from.elevation??0),topology==='vertical');
      for(const port of [move.from,move.to])assert.ok(result.bookings.some(booking=>booking.resource==='dock:'+port.id&&booking.start===move.start&&booking.end===move.end));
    }
  }
  const redundant=runExperiment({...input,outage:'lift',liftCount:2},{...assisted,topology:'vertical',buffer:'near'});
  assert.ok(redundant.relays.some(move=>move.relay===1&&move.start>=closure.start&&move.end<=closure.end));
  assert.ok(redundant.relays.every(move=>move.relay!==0||!overlaps(move,closure)));
  assert.equal(redundant.metrics.conflicts,0);
});

test('seeded mix, recipe changes and separate traffic types drive actual and planned demand',()=>{
  const recipe=PRODUCTS.dram.steps.map((_,index)=>index);
  [recipe[0],recipe[1]]=[recipe[1],recipe[0]];
  const input={...defaultInput,seed:31,jitter:6,releasePattern:'peak' as const,mixPercent:63,testEvery:3,emptyTrips:2,
    horizon:2400,repeatStation:'track',repeatCount:1,recipeOrder:{dram:recipe},dueTime:200,maxQueue:15};
  const result=runExperiment(input,{...assisted,buffer:'mixed',bufferAssignment:'balanced'});
  const repeat=runExperiment(input,{...baselinePolicy,topology:'dual'});
  assert.deepEqual(result.lots.map(lot=>[lot.product,lot.release,lot.test,lot.empty]),repeat.lots.map(lot=>[lot.product,lot.release,lot.test,lot.empty]));
  assert.notDeepEqual(result.lots.map(lot=>lot.release),runExperiment({...input,seed:32},assisted).lots.map(lot=>lot.release));
  const dram=result.lots.find(lot=>lot.product==='dram'&&!lot.empty)!;
  assert.equal(dram.route[0].steps[0].id,PRODUCTS.dram.steps[1].id);
  assert.ok(dram.route.filter(visit=>visit.station==='track').length>1);
  assert.equal(result.metrics.lots+result.metrics.testLots,input.lots);
  assert.equal(result.metrics.wafers,result.metrics.lots*input.wafers);
  assert.ok(result.lots.filter(lot=>lot.empty).every(lot=>lot.completed!==undefined&&!result.work.some(work=>work.lot===lot.id)));
  for(const kind of ['production','test','carrier','empty'] as const)assert.ok(analyzeTraffic(result,kind).length>0);
  assert.equal(plannedTraffic(result,'carrier').reduce((sum,row)=>sum+row.count,0),input.emptyTrips*2);
  assert.ok(result.metrics.waitViolations>0);
  assert.ok(result.metrics.dueRate!==null);
  const direct=runExperiment(input,assisted);
  assert.ok(direct.metrics.stallSeconds>0&&direct.metrics.incomplete>0);
});

test('shared cluster ports, dual-arm exchanges and integrated assignment preserve resource limits',()=>{
  const input={...defaultInput,fleet:6,horizon:2400,releaseEvery:1,parallelTools:true};
  const shared={...assisted,pooling:'shared' as const,partnerWindow:25,assignment:'eta' as const};
  const result=runExperiment(input,{...shared,arms:2});
  const single=runExperiment(input,{...shared,arms:1});
  assert.ok(result.metrics.planChanges>0);
  assert.notDeepEqual(result.work,single.work);
  assert.ok(result.work.some(run=>result.work.some(other=>run.lot!==other.lot&&run.station===other.station&&overlaps(run,other))));
  for(const tool of result.stations.filter(station=>station.type==='tool')){
    const activities=result.work.filter(run=>run.station===tool.point.id).flatMap(run=>run.activities).sort((a,b)=>a.start-b.start);
    const robot=activities.filter(task=>task.kind!=='process');
    assert.ok(robot.every((task,i)=>!i||!overlaps(task,robot[i-1])),tool.label);
    for(let id=1;id<=shared.chambers;id++){
      const chamber=activities.filter(task=>task.chamber===id);
      assert.ok(chamber.every((task,i)=>!i||!overlaps(task,chamber[i-1])),tool.label);
    }
  }
  for(const key of ['chamberUse','portUse','bufferUse','vehicleUse'] as const)assert.ok(result.metrics[key]!>=0&&result.metrics[key]!<=100);
});

test('fleet comparison uses paired seeds and reports a qualifying fleet only when the target is reached',async()=>{
  const input={...defaultInput,lots:2,wafers:1,horizon:1200,targetWph:3,jitter:4};
  const comparison=await compareFleet(input,[assisted,assisted],3);
  assert.deepEqual(comparison.rows.map(row=>row.fleet),[1,2,3,4,5,6]);
  assert.ok(comparison.rows.every(row=>JSON.stringify(row.results[0])===JSON.stringify(row.results[1])));
  assert.deepEqual(comparison.minimum,[1,1]);
  const unreachable=await compareFleet({...input,targetWph:1000},[assisted,assisted],1);
  assert.deepEqual(unreachable.minimum,[null,null]);
});

test('adjacent revisits stage at a buffer and repeat only the specified tool',()=>{
  const result=runExperiment({...defaultInput,primary:'baseline',secondary:'',lots:1,wafers:1,horizon:1200,
    repeatStation:'etch_strip',repeatCount:2},baselinePolicy);
  assert.deepEqual(result.work.map(run=>run.station),['deposition','track','etch_strip','etch_strip','etch_strip']);
  assert.equal(result.transfers.filter(trip=>trip.source==='etch_strip'&&trip.destination.startsWith('buffer-')).length,2);
  assert.equal(result.metrics.lots,1);
});

test('a measured queue-time violation can trigger one physical rework and a held return',()=>{
  const input={...defaultInput,primary:'baseline' as const,secondary:'' as const,lots:1,wafers:1,horizon:1000,
    queueRule:{product:'baseline' as const,fromStep:PRODUCTS.baseline.steps[0].id,toStep:PRODUCTS.baseline.steps[1].id,
      seconds:1,consequence:'rework' as const}};
  const observed=runExperiment(input,baselinePolicy);
  const controlled=runExperiment(input,{...baselinePolicy,queueControl:true});
  assert.equal(observed.metrics.criticalViolations,1);
  assert.equal(observed.metrics.lots,1);
  assert.equal(controlled.metrics.reworkCount,1);
  assert.equal(controlled.metrics.holdCount,1);
  assert.equal(controlled.metrics.lots,0);
  assert.equal(controlled.metrics.incomplete,0);
  assert.equal(controlled.work.filter(run=>run.station==='deposition').length,2);
  assert.equal(controlled.work.some(run=>run.station==='track'),false);
  assert.equal(controlled.transfers.at(-1)?.destination,'home');
});

test('maintenance pauses active work and pairs the same seeded failures across policies',()=>{
  const input={...defaultInput,primary:'baseline' as const,secondary:'' as const,lots:1,wafers:4,horizon:850,seed:23,
    maintenance:{station:'deposition',start:24,length:48,meanFailure:120,repair:18}};
  const early=runExperiment(input,baselinePolicy);
  const late=runExperiment(input,{...baselinePolicy,maintenanceOffset:130});
  const windows=(run:typeof early)=>run.downtime.filter(window=>window.kind==='failure');
  assert.deepEqual(windows(early),windows(late));
  assert.equal(early.downtime.find(window=>window.kind==='planned')?.start,24);
  assert.equal(late.downtime.find(window=>window.kind==='planned')?.start,154);
  assert.ok(early.work[0].end>late.work[0].end);
  const m=early.metrics;
  assert.ok(m.availability!>0&&m.availability!<100);
  assert.ok(Math.abs(m.standby!+m.productive!-m.availability!/100*input.horizon)<1e-5);
  assert.equal(m.mttr,18);
  assert.equal(early.metrics.conflicts,0);
});

test('field-log CSV pairs event clocks and keeps unfinished or malformed tasks out of latency samples',()=>{
  const log=parseFieldLog('\uFEFF'+sampleFieldLog.replaceAll('TOOL-A','"TOOL,A"'));
  const actual=summarizeField(log,log.duration);
  assert.deepEqual([actual.pickup,actual.handoff,actual.invalid,actual.pending],[9,28,0,0]);
  assert.equal(summarizeField(log,30).pending,1);
  assert.ok(log.assets.includes('TOOL,A'));
  const broken=parseFieldLog(sampleFieldLog.replace(/27,pickup.+\n/,''));
  assert.equal(summarizeField(broken,broken.duration).handoff,null);
  assert.equal(summarizeField(broken,broken.duration).invalid,1);
  assert.throws(()=>parseFieldLog(sampleFieldLog.replace('18,move_request','18,undefined_event')));
  const stamps=sampleFieldLog.replace(/^\d+(?=,)/gm,seconds=>new Date(Date.UTC(2026,0,1)+Number(seconds)*1000).toISOString());
  assert.equal(parseFieldLog(stamps).duration,103);
  const record=runExperiment(defaultInput,baselinePolicy);
  const model=summarizeModel(record,record.input.horizon);
  assert.equal(model.handoff,record.metrics.handoffP95);
});
