import assert from 'node:assert/strict';
import {test} from 'node:test';
import {campusDefaults,campusHbmExample,campusInventory,campusMetrics,recordCampusReturn,runCampus,traceBox} from '../src/campus';
import {advancePlayback,facilityPlayback,mergePlaybackWindows,startPlayback} from '../src/facility-playback';
import {defaultRailEdit} from '../src/campus-fab-layout';
import {railUsage} from '../src/campus-rail-panel';

test('facility playback seeks active work, skips idle gaps and loops without resetting other scenarios',()=>{
  const windows=mergePlaybackWindows([{start:20,end:24},{start:3,end:7},{start:5,end:9},{start:42,end:42}]);
  assert.deepEqual(windows,[{start:3,end:9},{start:20,end:24}]);
  assert.equal(startPlayback(5,windows),5);
  assert.equal(startPlayback(9,windows),20);
  assert.equal(startPlayback(24,windows),3);
  assert.equal(advancePlayback(8,2,windows),21);
  assert.equal(advancePlayback(23,3,windows),5);
  assert.equal(advancePlayback(23,13,windows),5);
  assert.equal(advancePlayback(41,10,[]),41);
});

test('facility equipment uses the campus reservations, order packaging, movements and return records',()=>{
  const run=runCampus({...campusDefaults,waves:3,docks:2,testLanes:2,testOutage:true});
  const receiving=facilityPlayback(run,'receiving');
  assert.equal(receiving.machines.filter(machine=>machine.kind==='dock').length,2);
  for(const work of run.work.filter(item=>item.zone==='receiving')){
    assert.ok(receiving.clips.some(clip=>clip.unit===work.lane&&clip.start===work.start&&clip.end===work.end));
  }
  const queue=facilityPlayback(run,'yard');
  const waits=run.moves.filter(move=>move.from==='yard'&&move.to==='yard');
  assert.ok(waits.length);
  assert.deepEqual(queue.clips.map(clip=>clip.reference).sort(),waits.map(move=>move.ref).sort());
  const warehouse=facilityPlayback(run,'materials');
  assert.ok(warehouse.clips.some(clip=>clip.direction==='in'));
  assert.ok(warehouse.clips.some(clip=>clip.direction==='out'));
  const test=facilityPlayback(run,'test');
  assert.equal(test.machines.length,2);
  assert.ok(test.clips.length);
  assert.ok(test.clips.every(item=>item.end<=run.outage!.start||item.start>=run.outage!.end));
  const packing=facilityPlayback(run,'packing');
  for(const box of run.boxes){
    const work=run.work.find(item=>item.zone==='packing'&&item.job===box.id)!;
    const clips=packing.clips.filter(item=>item.reference===box.id);
    assert.equal(clips[0].unit,box.contents==='트레이'?'tray':'reel');
    assert.equal(clips[0].start,work.start);
    assert.equal(clips[0].end,clips[1].start);
    assert.equal(clips[1].unit,'scan');
    assert.equal(clips[1].end,work.end);
  }
  assert.deepEqual(facilityPlayback(run,'reserve').windows,[]);
  assert.deepEqual(facilityPlayback(run,'returns').windows,[]);
  const returned=recordCampusReturn(run,run.boxes[0].id,run.end);
  const [receipt]=returned.returns;
  assert.deepEqual(facilityPlayback(returned,'returns').windows,[{start:receipt.received,end:receipt.inspected}]);
  assert.deepEqual(facilityPlayback(run,'utilities').windows,
    mergePlaybackWindows(Object.values(run.fabRuns).flatMap(site=>site.work)));
});

test('approved PO lots control actual fabrication releases and held inventory is unavailable',()=>{
  const result=runCampus({...campusDefaults,holdWafer:true,utilityOutage:true});
  const rejected=result.receipts.find(receipt=>receipt.held!==undefined)!;
  assert.equal(rejected.order,'ORD-GPU');
  assert.equal(rejected.approved,undefined);
  assert.deepEqual(rejected.uses,[]);
  assert.equal(campusInventory(result,result.end).find(receipt=>receipt.id===rejected.id)?.quarantined,2);
  assert.ok(result.orders.every(order=>order.release!>result.utility!.end));
  for(const order of result.orders){
    const fab=result.fabRuns[order.fabSite]!;
    const lot=fab.lots.find(lot=>lot.id===order.fabLot)!;
    assert.equal(lot.release,order.release);
    assert.equal(lot.product,order.product);
    assert.ok(fab.work.some(item=>item.lot===lot.id&&item.start>lot.release));
    const map=result.wafers.filter(wafer=>wafer.order===order.id);
    assert.equal(map.length,2);
    assert.ok(map.every(wafer=>wafer.material!==rejected.id&&wafer.sorted>lot.completed!));
  }
});

test('HBM delay waits on the GPU kit and preserves NPU order, yield and traceable assembly',()=>{
  const base=runCampus(campusDefaults);
  const delayed=runCampus({...campusDefaults,hbmDelay:campusHbmExample});
  assert.deepEqual(base.boxes.find(box=>box.order==='ORD-NPU'),delayed.boxes.find(box=>box.order==='ORD-NPU'));
  const gpu=delayed.boxes.find(box=>box.order==='ORD-GPU')!;
  assert.ok(gpu.delivered>base.boxes.find(box=>box.id===gpu.id)!.delivered);
  assert.ok(delayed.orders.find(order=>order.id===gpu.order)!.waiting!>120);
  assert.equal(campusMetrics(base,base.end).onTime,100);
  assert.equal(campusMetrics(delayed,delayed.end).onTime,50);
  const gpuTrace=traceBox(delayed,gpu);
  assert.equal(gpu.packages.length,campusDefaults.units);
  assert.ok(gpuTrace.dies.every(die=>die.good));
  assert.ok(gpuTrace.packages.every(pkg=>pkg.accepted&&pkg.components.find(part=>part.material==='hbm')?.units===2));
  assert.ok(gpuTrace.receipts.some(receipt=>receipt.material==='hbm'&&receipt.approved!>delayed.orders[0].sorted!));
  assert.ok(gpuTrace.wafers.every(wafer=>gpuTrace.receipts.some(receipt=>receipt.id===wafer.material)));
  assert.ok(campusInventory(delayed,delayed.end).every(receipt=>receipt.used+receipt.available+receipt.quarantined===receipt.units));
});

test('product areas execute complete recipes on two machine copies with connected directional OHT routes',()=>{
  const campus=runCampus({...campusDefaults,waves:3,docks:2});
  const fab=campus.fabRuns.fab!;
  assert.deepEqual(fab.campusFloor?.areas.map(({section,product})=>({section,product})),[
    {section:1,product:'gpu'},{section:2,product:'npu'},
  ]);
  const tools=new Map(fab.stations.map(station=>[station.point.id,station]));
  const installed=[...tools.values()].filter(station=>station.type==='tool');
  assert.equal(installed.length,30);
  assert.ok(!installed.some(station=>station.product==='npu'&&station.recipeStation==='cmp'));
  assert.ok(!installed.some(station=>station.product==='gpu'&&station.recipeStation==='deposition'));
  assert.deepEqual(new Set(fab.work.map(item=>tools.get(item.station)?.section)),new Set([1,2]));
  for(const tool of installed){
    assert.equal(fab.edges.find(edge=>edge.to===tool.point)?.kind,'siding');
    assert.equal(fab.edges.find(edge=>edge.from===tool.point)?.kind,'siding');
  }
  const running=fab.vehicles.flatMap(vehicle=>vehicle.motion);
  const traversals=new Map(fab.edges.map(edge=>[edge.from.id+'→'+edge.to.id,edge]));
  for(const move of running.filter(item=>item.from!==item.to)){
    const edge=traversals.get(move.from.id+'→'+move.to.id);
    assert.ok(edge,move.from.id+'→'+move.to.id);
    assert.ok(Math.abs(move.end-move.start-edge.seconds)<1e-7);
  }
  assert.ok(running.some(item=>item.phase==='loaded'&&traversals.get(item.from.id+'→'+item.to.id)?.kind==='spine'));
  assert.ok(running.some(item=>item.phase==='loaded'&&traversals.get(item.from.id+'→'+item.to.id)?.kind==='bay'));
  const shared=new Map<string,typeof fab.bookings>();
  for(const booking of fab.bookings){
    const history=shared.get(booking.resource)??[];
    assert.ok(history.every(other=>other.vehicle===booking.vehicle||
      other.end<=booking.start+1e-7||booking.end<=other.start+1e-7),booking.resource);
    history.push(booking);shared.set(booking.resource,history);
  }
  for(const lot of fab.lots){
    assert.ok(lot.completed!==undefined);
    const actual=fab.work.filter(work=>work.lot===lot.id).map(work=>tools.get(work.station)!);
    assert.ok(actual.every(station=>station.product===lot.product&&station.section===lot.section));
    assert.deepEqual(actual.map(station=>station.recipeStation),lot.route.map(visit=>visit.station));
  }
  for(const area of fab.campusFloor!.areas){
    const stations=installed.filter(station=>station.section===area.section);
    const rows=new Set(stations.map(station=>station.point.z));
    assert.equal(rows.size,2);
    assert.ok([...rows].every(z=>Math.abs(z-area.z)<area.depth/2));
    const fleet=fab.vehicles.filter(car=>car.section===area.section);
    assert.equal(fleet.length,campusDefaults.fleet);
    assert.ok(fleet.every(car=>car.initial.district===area.district&&car.motion.length>0));
    assert.ok(fleet.every(car=>car.motion.every(move=>move.lot===undefined||fab.lots[move.lot-1].section===area.section)));
    const copies=fab.work.map(item=>tools.get(item.station)!).filter(item=>item.section===area.section&&item.recipeStation==='track');
    assert.deepEqual(new Set(copies.map(item=>item.copy)),new Set([1,2]));
  }
  const single=runCampus({...campusDefaults,sections:1,waves:3,fleet:1});
  assert.equal(single.fabRuns.fab?.campusFloor?.areas.length,1);
  assert.equal(single.boxes.length,3);
  assert.ok(single.orders.filter(order=>order.product==='npu').every(order=>order.fabSection===undefined&&order.release===undefined));
  assert.ok(single.receipts.every(receipt=>!receipt.order.startsWith('ORD-NPU')));
});

test('selectable area products route orders to matching fabs and keep an assigned idle area visible',()=>{
  const swapped=runCampus({...campusDefaults,fabCount:2,sections:1,areaProducts:{fab:{1:'npu'},fabB:{1:'gpu'}}});
  assert.deepEqual(swapped.orders.map(order=>[order.product,order.fabSite,order.fabSection]),[
    ['gpu','fabB',1],['npu','fab',1],
  ]);
  assert.ok(swapped.fabRuns.fabB?.work.length);
  assert.ok(swapped.fabRuns.fab?.work.length);
  const idle=runCampus({...campusDefaults,fabCount:2,sections:1,areaProducts:{fabB:{1:'gpu'}}});
  assert.equal(idle.fabRuns.fabB?.campusFloor?.areas[0].product,'gpu');
  assert.equal(idle.fabRuns.fabB?.lots.length,0);
  assert.ok(idle.fabRuns.fabB?.stations.some(station=>station.product==='gpu'));
  assert.ok(idle.end>=idle.orders.find(order=>order.product==='npu')!.due);
  const split=runCampus({...campusDefaults,fabCount:2,waves:3});
  assert.deepEqual(split.orders.filter(order=>order.product==='gpu').map(order=>order.fabSection),[1,2,1]);
});

test('prefabrication demand and ATE expansion alter the shared bottleneck with two independent fabs',()=>{
  const input={...campusDefaults,waves:3,docks:2} as const;
  const single=runCampus(input);
  const dual=runCampus({...input,fabCount:2});
  const expanded=runCampus({...input,fabCount:2,testLanes:2});
  assert.equal(dual.fabRuns.fab!.lots.length,3);
  assert.equal(dual.fabRuns.fabB!.lots.length,3);
  assert.ok(dual.fabRuns.fab!.lots.every(lot=>lot.product==='gpu'));
  assert.ok(dual.fabRuns.fabB!.lots.every(lot=>lot.product==='npu'));
  assert.equal(new Set(dual.fabRuns.fab!.stations.filter(item=>['clean','cmp','plate'].includes(item.point.id)).map(item=>item.hub)).size,1);
  const deadline=Math.max(...dual.orders.map(order=>order.due));
  const firstDelivery=dual.boxes[0].delivered;
  assert.ok(campusMetrics(dual,firstDelivery).delivered>campusMetrics(single,firstDelivery).delivered);
  assert.ok(campusMetrics(expanded,deadline).testWait<=campusMetrics(dual,deadline).testWait);
  assert.ok(expanded.boxes.some(box=>box.delivered<dual.boxes.find(item=>item.id===box.id)!.delivered));
  assert.ok(dual.moves.some(move=>move.from==='gate'&&move.to==='yard'));
  assert.ok(dual.moves.some(move=>move.from==='fabB'&&move.to==='sort'));
  const utility=runCampus({...input,fabCount:2,utilityLines:1});
  assert.ok(utility.fabRuns.fabB!.lots[0].release>Math.max(...utility.fabRuns.fab!.lots.map(lot=>lot.completed!)));
  assert.ok(utility.events.some(event=>event.zone==='utilities'&&event.label.includes('회선 할당')));
});

test('ATE shutdown, final retest, packaging and outbound delay preserve sequencing',()=>{
  const normal=runCampus(campusDefaults);
  const outage=runCampus({...campusDefaults,testOutage:true,deliveryDelay:80,gpuRoute:'direct'});
  const window=outage.outage!;
  const tests=outage.work.filter(work=>work.lane==='ATE');
  assert.ok(tests.every(work=>work.end<=window.start||work.start>=window.end));
  assert.ok(tests[0].start>normal.work.find(work=>work.lane==='ATE')!.start);
  assert.ok(outage.packages.some(pkg=>pkg.retest!==undefined&&pkg.accepted&&pkg.retest>pkg.firstTest));
  for(const box of outage.boxes){
    assert.ok(box.packages.every(id=>{
      const pkg=outage.packages.find(pkg=>pkg.id===id)!;
      return pkg.accepted&&pkg.decision<box.verified&&box.verified<box.shipped&&box.shipped<box.delivered;
    }));
  }
  assert.ok(outage.moves.some(move=>move.to==='customer'&&move.from==='finished'&&move.end-move.start>=113));
  assert.ok(outage.moves.some(move=>move.to==='distribution'&&move.order==='ORD-NPU'));
});

test('RMA blocks early or duplicate claims and quarantines only actual remaining stock',()=>{
  const result=runCampus(campusDefaults);
  assert.equal(recordCampusReturn(result,'BOX-GPU',0),result);
  const returned=recordCampusReturn(result,'BOX-GPU',result.end);
  assert.notEqual(returned,result);
  assert.equal(recordCampusReturn(returned,'BOX-GPU',returned.end),returned);
  assert.equal(returned.boxes.length,result.boxes.length);
  assert.equal(returned.returns[0].heldLots.length,4);
  const held=campusInventory(returned,returned.end).filter(item=>item.quarantined>0);
  assert.deepEqual(held.map(item=>item.id).sort(),[...returned.returns[0].heldLots].sort());
  assert.ok(held.every(item=>item.order==='ORD-GPU'&&item.used>0&&item.available===0));
});
test('edited campus crossover, storage and port geometry participate in the actual OHT graph',()=>{
  const before=runCampus(campusDefaults).fabRuns.fab!;
  const selected=before.stations.find(item=>item.type==='tool')!;
  const edit={...defaultRailEdit(),west:-19,buffers:{1:{offset:1.5,capacity:4}},ports:{[selected.point.id]:{offset:.5,open:false}}};
  const after=runCampus({...campusDefaults,railEdits:{fab:edit}}).fabRuns.fab!;
  assert.equal(after.edges.find(edge=>edge.from.id==='spine-cross-south-0'&&edge.bypass)?.from.x,-19);
  const oldBuffer=before.stations.find(item=>item.point.id==='buffer-line-1')!;
  const newBuffer=after.stations.find(item=>item.point.id==='buffer-line-1')!;
  assert.equal(newBuffer.point.x,oldBuffer.point.x+1.5);
  assert.equal(newBuffer.capacity,4);
  assert.equal(after.stations.find(item=>item.point.id===selected.point.id)?.point.x,selected.point.x+.5);
  assert.deepEqual(after.unreachablePorts,[selected.point.id]);
  assert.ok(after.transfers.every(trip=>trip.destination!==selected.point.id));
  assert.ok(after.metrics.lots>0);
  const usage=railUsage(after);
  assert.ok([...usage.values()].some(ratio=>ratio>0));
  assert.ok([...usage.values()].every(ratio=>ratio>=0&&ratio<=1));
});
