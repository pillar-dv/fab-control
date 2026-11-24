import {baselinePolicy,defaultInput,runExperiment,type ExperimentResult} from './fab-experiment';
import {fabs,type CampusZone,type FabSite} from './campus-layout';
import {sectionName,type CampusRailEdit,type FabSections} from './campus-fab-layout';
export type CampusProduct = 'gpu'|'npu';
export const campusProductNames:Record<CampusProduct,string>={gpu:'GPU',npu:'NPU'};
export type ShippingRoute = 'direct'|'distribution'|'board';
export const shippingNames:Record<ShippingRoute,string>={direct:'고객 직송',distribution:'지역 유통센터 경유',board:'보드 조립사 경유'};

export interface CampusInput {
  units:number; fleet:number; hbmDelay:number; deliveryDelay:number; holdWafer:boolean; testOutage:boolean; utilityOutage:boolean;
  gpuRoute:ShippingRoute; npuRoute:ShippingRoute;
  fabCount:1|2; testLanes:1|2; docks:1|2; utilityLines:1|2; waves:1|2|3; sections:FabSections;
  areaProducts?:Partial<Record<FabSite,Partial<Record<FabSections,CampusProduct>>>>;
  railEdits?:Partial<Record<FabSite,CampusRailEdit>>;
}
export const campusDefaults:CampusInput={units:5,fleet:4,hbmDelay:0,deliveryDelay:0,holdWafer:false,
  testOutage:false,utilityOutage:false,gpuRoute:'board',npuRoute:'distribution',fabCount:1,testLanes:1,docks:1,utilityLines:2,waves:1,sections:2};
export const campusHbmExample=950;
export function campusAreas(input:Pick<CampusInput,'fabCount'|'sections'|'areaProducts'>,site:FabSite){
  if(site==='fabB'&&input.fabCount===1)return [];
  return Array.from({length:input.sections},(_,index)=>{
    const section=(index+1) as FabSections;
    const defaultProduct=site==='fabB'||input.fabCount===1&&section===2?'npu':'gpu';
    const product:CampusProduct=input.areaProducts?.[site]?.[section]??defaultProduct;
    return {section,product};
  });
}
export interface CampusEvent {time:number; zone:CampusZone; order?:string; label:string; ref?:string}
export type CampusLoad='truck'|'cart'|'foup'|'tray'|'box';
export interface CampusMove {
  from:CampusZone; to:CampusZone; start:number; end:number; load:CampusLoad; ref:string; order?:string;
}
export interface CampusWork {zone:CampusZone; lane:string; order:string; job:string; start:number; end:number}
type Material='wafer'|'hbm'|'logic'|'substrate'|'container';
const materialNames:Record<Material,string>={wafer:'웨이퍼',hbm:'HBM 스택',logic:'GPU 연산 다이',substrate:'패키지 기판',container:'출하용 트레이·릴'};
export interface CampusReceipt {
  id:string; po:string; supplier:string; order:string; material:Material; units:number;
  promised:number; arrived:number; dockWait:number; approved?:number; held?:number; uses:{job:string;time:number;units:number}[];
}
export interface CampusDie {id:string; wafer:string; row:number; column:number; good:boolean; packageId?:string}
export interface CampusWafer {id:string; material:string; order:string; sorted:number; dies:CampusDie[]}
interface Component {material:Material; lot:string; units:number}
export interface CampusPackage {
  id:string; order:string; die:string; components:Component[]; assembled:number;
  firstTest:number; retest?:number; decision:number; accepted:boolean;
}
export interface CampusBox {
  id:string; label:string; order:string; packages:string[]; contents:'트레이'|'테이프·릴';
  verified:number; shipped:number; delivered:number; route:ShippingRoute;
}
export interface CampusOrder {
  id:string; product:CampusProduct; reference:string; quantity:number; due:number; route:ShippingRoute;
  wave:number; fabSite?:FabSite; fabSection?:FabSections; release?:number; sorted?:number; kitStart?:number; waiting?:number; fabLot?:number;
}
export interface CampusReturn {box:string; received:number; inspected:number; quarantinedAt:number; heldLots:string[]}
export interface CampusResult {
  input:CampusInput; orders:CampusOrder[]; receipts:CampusReceipt[]; wafers:CampusWafer[]; packages:CampusPackage[];
  boxes:CampusBox[]; moves:CampusMove[]; work:CampusWork[]; events:CampusEvent[];
  fabRuns:Partial<Record<FabSite,ExperimentResult>>;
  end:number; outage?:{start:number;end:number}; utility?:{start:number;end:number}; returns:CampusReturn[];
}

export function runCampus(input:CampusInput):CampusResult {
  const allocations=fabs.flatMap(site=>campusAreas(input,site).map(area=>({...area,site})));
  function allocation(product:CampusProduct,wave:number){
    const matches=allocations.filter(area=>area.product===product);
    const match=matches.length?matches[wave%matches.length]:undefined;
    return {fabSite:match?.site,fabSection:match?.section};
  }
  const orders:CampusOrder[]=Array.from({length:input.waves},(_,wave)=>{
    const suffix=wave?'-'+String(wave+1).padStart(2,'0'):'';
    return [
      {id:'ORD-GPU'+suffix,product:'gpu',reference:'GPU 서버 모듈',quantity:input.units,due:1050+wave*135,
        route:input.gpuRoute,wave,...allocation('gpu',wave)},
      {id:'ORD-NPU'+suffix,product:'npu',reference:'엣지 NPU SoC',quantity:input.units,due:1020+wave*135,
        route:input.npuRoute,wave,...allocation('npu',wave)},
    ] satisfies CampusOrder[];
  }).flat();
  const events:CampusEvent[]=[],moves:CampusMove[]=[],work:CampusWork[]=[],receipts:CampusReceipt[]=[];
  const wafers:CampusWafer[]=[],packages:CampusPackage[]=[],boxes:CampusBox[]=[];
  const resources=new Map<string,number>();
  const outage=input.testOutage?{start:345,end:525}:undefined;
  const utility=input.utilityOutage?{start:24,end:110}:undefined;
  function log(time:number,zone:CampusZone,label:string,order?:string,ref?:string){
    events.push({time,zone,order,label,ref});
  }
  function move(start:number,seconds:number,from:CampusZone,to:CampusZone,load:CampusLoad,ref:string,order?:string){
    const end=start+seconds;
    moves.push({start,end,from,to,load,ref,order});
    return end;
  }
  function nextStart(ready:number,seconds:number,lane:string){
    let start=Math.max(ready,resources.get(lane)??0);
    if(lane.startsWith('ATE')&&outage&&start<outage.end&&start+seconds>outage.start)start=outage.end;
    return start;
  }
  function laneFor(ready:number,seconds:number,base:string,count:number){
    const lanes=Array.from({length:count},(_,index)=>count===1?base:base+'-'+(index+1));
    return lanes.reduce((best,lane)=>nextStart(ready,seconds,lane)<nextStart(ready,seconds,best)?lane:best);
  }
  function book(ready:number,seconds:number,zone:CampusZone,lane:string,order:string,job:string){
    const start=nextStart(ready,seconds,lane);
    const end=start+seconds;
    resources.set(lane,end);
    const reservation={start,end,zone,lane,order,job};
    work.push(reservation);
    return reservation;
  }
  const requests:{order:CampusOrder;material:Material;units:number;eta:number;delay:number;supplier:string;hold?:boolean}[]=[];
  const plannedUnits=input.units+1;
  for(const order of orders){
    log(0,'supplier','고객 주문 등록 · 부품 명세 및 납기 확정',order.id,order.id);
    if(!order.fabSite){
      log(0,'supplier',campusProductNames[order.product]+' 생산 구역 미배정 · 자재 발주 보류',order.id,order.id);
      continue;
    }
    const gpu=order.product==='gpu';
    const eta=gpu?19:27,offset=order.wave*48;
    requests.push({order,material:'wafer',units:2,eta,delay:0,supplier:'실리콘 웨이퍼 공급사',hold:gpu&&input.holdWafer&&!order.wave},
      {order,material:'substrate',units:plannedUnits+1,eta:65,delay:0,supplier:'패키지 기판 공급사'},
      {order,material:'container',units:2,eta:76,delay:0,supplier:'전자부품 포장재 공급사'});
    if(gpu){
      requests.push({order,material:'hbm',units:2*(plannedUnits+1),eta:80,delay:input.hbmDelay,supplier:'HBM 공급사'},
        {order,material:'logic',units:2*(plannedUnits+1),eta:67,delay:0,supplier:'연산 다이 외주 공장'});
      if(input.holdWafer&&!order.wave)requests.push({order,material:'wafer',units:2,eta:95,delay:0,supplier:'대체 웨이퍼 공급사'});
    }
    for(const request of requests)if(request.order===order)request.eta+=offset;
  }
  requests.map((request,index)=>({request,index}))
    .sort((a,b)=>a.request.eta+a.request.delay-b.request.eta-b.request.delay).forEach(({request,index})=>{
    const {order,material,units,eta,delay,supplier,hold}=request;
    const code=String(index+1).padStart(2,'0');
    const id='MAT-'+code,po='PO-'+code,arrived=eta+delay;
    const receipt:CampusReceipt={id,po,supplier,order:order.id,material,units,promised:eta,arrived,dockWait:0,uses:[]};
    log(0,'supplier','구매 발주 · '+materialNames[material],order.id,po);
    move(Math.max(0,arrived-14),14,'supplier','gate','truck',id,order.id);
    log(arrived,'gate','트럭 도착 · 운송 예약 확인',order.id,id);
    const registered=book(arrived,2,'gate','차량 등록',order.id,id).end;
    const queued=move(registered,3,'gate','yard','truck',id,order.id);
    const lane=laneFor(queued+4,7,'하역 도크',input.docks);
    const unloading=book(queued+4,7,'receiving',lane,order.id,id);
    receipt.dockWait=unloading.start-(queued+4);
    log(queued,'yard',receipt.dockWait?'하역 도크 배정 대기':'하역 도크 배정 완료',order.id,id);
    if(receipt.dockWait>0)move(queued,receipt.dockWait,'yard','yard','truck',id,order.id);
    move(unloading.start-4,4,'yard','receiving','truck',id,order.id);
    log(unloading.start,'receiving',lane+' 접안 · 화물 인수',order.id,id);
    const inspection=book(unloading.end,6,'receiving','입고 검사',order.id,id);
    if(hold){
      receipt.held=move(inspection.end,4,'receiving','quarantine','cart',id,order.id);
      log(receipt.held,'quarantine','입고 부적합 · 생산 투입 차단',order.id,id);
    }else{
      receipt.approved=move(inspection.end,6,'receiving','materials','cart',id,order.id);
      log(receipt.approved,'materials','입고 승인 · 가용 재고 적치',order.id,id);
    }
    receipts.push(receipt);
  });
  function receiptFor(order:string,material:Material){
    return receipts.find(item=>item.order===order&&item.material===material&&item.approved!==undefined)!;
  }
  function consume(receipt:CampusReceipt,units:number,time:number,job:string){
    const balance=receipt.units-receipt.uses.reduce((total,item)=>total+item.units,0);
    if(receipt.approved===undefined||time<receipt.approved||units>balance)throw Error('승인 재고 또는 수량 불일치 '+receipt.id);
    receipt.uses.push({units,time,job});
    return {material:receipt.material,lot:receipt.id,units};
  }
  if(utility){
    log(utility.start,'utilities','유틸리티 정지 · 팹 신규 투입 보류');
    log(utility.end,'utilities','유틸리티 복구 · 웨이퍼 투입 재개');
  }
  const fabRuns:CampusResult['fabRuns']={};
  const readyForSort:{order:CampusOrder;site:FabSite;completion:number}[]=[];
  for(const site of fabs){
    const areas=campusAreas(input,site);
    if(!areas.length)continue;
    const siteOrders=orders.filter(order=>order.fabSite===site);
    const available=site==='fabB'&&input.utilityLines===1?
      Math.max(0,...(fabRuns.fab?.lots??[]).map(lot=>lot.completed??lot.release))+8:0;
    const releases=siteOrders.map((order,index)=>{
      const receipt=receiptFor(order.id,'wafer');
      order.fabLot=index+1;
      let released=receipt.approved!;
      if(utility&&released<utility.end&&released+10>utility.start){
        log(released,'materials','팹 유틸리티 복구 대기 · 자재 창고 보관',order.id,receipt.id);
        released=utility.end;
      }
      if(released<available){
        log(released,'utilities','전력·냉각 회선 할당 대기',order.id,receipt.id);
        released=available;
      }
      consume(receipt,2,released,order.id);
      order.release=move(released,site==='fab'?12:19,'materials',site,'foup',receipt.id,order.id);
      const section=order.fabSection!;
      log(order.release,site,sectionName(section)+' '+campusProductNames[order.product]+' 로트 투입 · OHT 배차',order.id,'FOUP-'+order.fabLot);
      return {product:order.product,time:order.release,section};
    });
    const primary=areas[0].product,secondary=areas.find(item=>item.product!==primary)?.product??'';
    const horizon=Math.max(0,...releases.map(item=>item.time))+siteOrders.length*1250;
    const fab=runExperiment({...defaultInput,primary,secondary,horizon,lots:siteOrders.length,wafers:2,fleet:input.fleet},
      {...baselinePolicy,buffer:'near',bypass:true,chambers:2,staging:true},releases,areas,input.railEdits?.[site]);
    fabRuns[site]=fab;
    for(const transfer of fab.transfers){
      const order=siteOrders[transfer.lot-1];
      log(transfer.delivery,site,'OHT-'+transfer.vehicle+' · '+fab.stations.find(station=>station.point.id===transfer.destination)?.label+' 인계',
        order.id,'FOUP-'+transfer.lot);
    }
    for(const lot of fab.lots)if(lot.completed!==undefined)readyForSort.push({order:siteOrders[lot.id-1],site,completion:lot.completed});
  }
  readyForSort.sort((a,b)=>a.completion-b.completion);
  const candidates:{order:CampusOrder;ready:number;dies:CampusDie[];materials:CampusReceipt[]}[]=[];
  for(const {order,site,completion} of readyForSort){
    const waferMaterial=receiptFor(order.id,'wafer');
    const arrived=move(completion,site==='fab'?13:19,site,'sort','foup','FOUP-'+order.fabLot,order.id);
    log(completion,site,'팹 완료 · 인계장에서 후공정 전용 운송차 배정',order.id,'FOUP-'+order.fabLot);
    const probe=book(arrived,17,'sort','웨이퍼 프로버',order.id,'웨이퍼 소트');
    const cut=book(probe.end,11,'sort','다이 절단기',order.id,'다이 분리');
    const dies:CampusDie[]=[];
    for(let index=1;index<=2;index++){
      const wafer=order.id+'-W'+index;
      const map=Array.from({length:6},(_,i)=>({
        id:wafer+'-D'+(i+1),wafer,row:Math.floor(i/3),column:i%3,good:i!==(index===1?1:4),
      }));
      wafers.push({id:wafer,material:waferMaterial.id,order:order.id,sorted:probe.end,dies:map});
      dies.push(...map.filter(die=>die.good));
    }
    log(probe.end,'sort','웨이퍼 맵 기록 · 양품 10개 / 검사 12개',order.id);
    log(cut.end,'sort','다이 분리 · 합격 다이 트레이 이관',order.id);
    order.sorted=cut.end;
    const materials=[receiptFor(order.id,'substrate')];
    if(order.product==='gpu')materials.push(receiptFor(order.id,'hbm'),receiptFor(order.id,'logic'));
    const partsReady=Math.max(...materials.map(item=>item.approved!));
    order.waiting=Math.max(0,partsReady-cut.end);
    if(order.waiting>0){
      const late=materials.filter(item=>item.approved!>cut.end).map(item=>materialNames[item.material]).join(' · ');
      log(cut.end,'assembly','부품 대기 · '+late,order.id);
    }
    const kit=Math.max(cut.end,partsReady);
    order.kitStart=kit;
    log(kit,'materials','조립 키트 출고 · 승인 부품과 양품 다이 대조',order.id);
    const tray=move(cut.end,8,'sort','assembly','tray','TRAY-'+order.product.toUpperCase(),order.id);
    for(const item of materials)move(kit,8,'materials','assembly','cart',item.id,order.id);
    candidates.push({order,ready:Math.max(tray,kit+8),dies,materials});
  }
  for(const {order,ready,dies,materials} of candidates.sort((a,b)=>a.ready-b.ready)){
    const assembly=book(ready,order.product==='gpu'?27:18,'assembly',order.product==='gpu'?'2.5D 조립':'플립칩 조립',
      order.id,order.product==='gpu'?'인터포저·GPU 다이·HBM 접합':'엣지 SoC 다이 접합');
    for(let i=0;i<Math.min(plannedUnits,dies.length);i++){
      const id=order.id+'-P'+String(i+1).padStart(2,'0');
      const die=dies[i];
      die.packageId=id;
      const components=materials.map(item=>consume(item,item.material==='substrate'?1:2,order.kitStart!,id));
      packages.push({id,order:order.id,die:die.id,components,assembled:assembly.end,firstTest:0,decision:0,accepted:false});
    }
    log(assembly.start,'assembly',assembly.job+' 시작',order.id);
    log(assembly.end,'assembly','패키지 병합 · 다이와 부품 로트 연결',order.id);
  }
  if(outage){
    log(outage.start,'test','ATE 정지 · 검사 진입 차단');
    log(outage.end,'test','ATE 복구 · 대기 패키지 검사 재개');
  }
  const testQueue=orders.flatMap(order=>{
    const batch=packages.filter(item=>item.order===order.id);
    if(!batch.length)return [];
    const arrived=move(batch[0].assembled,8,'assembly','test','tray',order.id,order.id);
    return [{order,batch,arrived}];
  }).sort((a,b)=>a.arrived-b.arrived);
  const tests:{order:CampusOrder;batch:CampusPackage[];ready:number;rescreen:boolean}[]=testQueue.map(item=>({...item,ready:item.arrived,rescreen:false}));
  while(tests.length){
    tests.sort((a,b)=>a.ready-b.ready);
    const {order,batch,ready,rescreen}=tests.shift()!;
    const seconds=rescreen?9:18+batch.length;
    const test=book(ready,seconds,'test',laneFor(ready,seconds,'ATE',input.testLanes),order.id,rescreen?'재시험':'외관·전기 검사');
    if(rescreen){
      batch[0].retest=test.end;
      batch[0].decision=test.end;
      batch[0].accepted=true;
      log(test.end,'test','재시험 합격',order.id,batch[0].id);
      continue;
    }
    log(test.start,'test','최종 시험 시작',order.id);
    batch.forEach((pkg,index)=>{
      pkg.firstTest=test.end;
      if(index===batch.length-2){
        tests.push({order,batch:[pkg],ready:test.end+6,rescreen:true});
        log(test.end,'test','기능 검사 경계값 · 재시험 대기',order.id,pkg.id);
      }else{
        pkg.decision=test.end;
        pkg.accepted=index!==batch.length-1;
        if(!pkg.accepted)log(test.end,'test','최종 시험 불합격 · 출하 차단',order.id,pkg.id);
      }
    });
  }
  const packQueue=orders.flatMap(order=>{
    const accepted=packages.filter(pkg=>pkg.order===order.id&&pkg.accepted);
    return accepted.length?[{order,accepted,ready:Math.max(...accepted.map(pkg=>pkg.decision))}]:[];
  }).sort((a,b)=>a.ready-b.ready);
  for(const {order,accepted,ready} of packQueue){
    const id=order.id.replace('ORD-','BOX-');
    const cartons=receiptFor(order.id,'container');
    const readyToPack=move(ready,7,'test','packing','tray',id,order.id);
    move(cartons.approved!,8,'materials','packing','cart',cartons.id,order.id);
    const pack=book(Math.max(readyToPack,cartons.approved!+8),13,'packing','포장 검사',order.id,id);
    consume(cartons,1,pack.start,id);
    const contents=order.product==='gpu'?'트레이':'테이프·릴';
    const label=id+' / '+order.id+' / '+accepted.length+'개';
    log(pack.end,'packing','수량·라벨 대조와 봉인 · '+contents+' 포장',order.id,id);
    const stocked=move(pack.end,8,'packing','finished','box',id,order.id);
    log(stocked,'finished','출하 승인 · 완제품 창고 적치',order.id,id);
    const shipped=stocked+12;
    log(shipped,'finished','출하 · '+shippingNames[order.route],order.id,id);
    let delivered:number;
    if(order.route==='direct')delivered=move(shipped,33+input.deliveryDelay,'finished','customer','truck',id,order.id);
    else {
      const intermediate=order.route==='board'?'board':'distribution';
      const via=move(shipped,24+input.deliveryDelay,'finished',intermediate,'truck',id,order.id);
      log(via,intermediate,order.route==='board'?'인수 · 보드 모듈 조립':'유통센터 인수 · 지역 주문 배정',order.id,id);
      delivered=move(via+(order.route==='board'?24:13),22,intermediate,'customer','truck',id,order.id);
    }
    log(delivered,'customer','고객 인도 · '+(delivered<=order.due?'납기 준수':'납기 지연'),order.id,id);
    boxes.push({id,label,order:order.id,packages:accepted.map(pkg=>pkg.id),contents,verified:pack.end,shipped,delivered,route:order.route});
  }
  const unassignedDue=orders.filter(order=>!order.fabSite).map(order=>order.due);
  const end=Math.max(0,...events.map(event=>event.time),...moves.map(move=>move.end),...unassignedDue);
  return {input,orders,receipts,wafers,packages,boxes,moves,work,events:events.sort((a,b)=>a.time-b.time),fabRuns,end,outage,utility,returns:[]};
}

export function traceBox(run:CampusResult,box:CampusBox) {
  const packages=run.packages.filter(pkg=>box.packages.includes(pkg.id));
  const dies=run.wafers.flatMap(wafer=>wafer.dies).filter(die=>packages.some(pkg=>pkg.die===die.id));
  const wafers=run.wafers.filter(wafer=>dies.some(die=>die.wafer===wafer.id));
  const ids=new Set([...wafers.map(wafer=>wafer.material),...packages.flatMap(pkg=>pkg.components.map(component=>component.lot)),
    ...run.receipts.filter(receipt=>receipt.uses.some(use=>use.job===box.id)).map(receipt=>receipt.id)]);
  return {packages,dies,wafers,receipts:run.receipts.filter(receipt=>ids.has(receipt.id))};
}

export function recordCampusReturn(run:CampusResult,boxId:string,time:number):CampusResult {
  const box=run.boxes.find(item=>item.id===boxId);
  if(!box||time<Math.max(...run.boxes.map(item=>item.delivered))||run.returns.some(item=>item.box===boxId))return run;
  const received=time+17,inspected=received+15;
  const heldLots=traceBox(run,box).receipts.filter(receipt=>receipt.uses.reduce((sum,use)=>sum+use.units,0)<receipt.units).map(receipt=>receipt.id);
  const quarantinedAt=heldLots.length?inspected+6:inspected;
  const events:CampusEvent[]=[...run.events,
    {time,zone:'customer',label:'고객 반품 접수',order:box.order,ref:box.id},
    {time:received,zone:'returns',label:'반품 인수 · 박스와 패키지 번호 대조',order:box.order,ref:box.id},
    {time:inspected,zone:'returns',label:'고장 분석용 격리 · 관련 공급 로트 역추적',order:box.order,ref:box.id},
    ...heldLots.map(id=>({time:quarantinedAt,zone:'quarantine' as const,label:'관련 자재의 잔여 재고 격리 완료',order:box.order,ref:id})),
  ];
  const move:CampusMove={from:'customer',to:'returns',start:time,end:received,load:'truck',order:box.order,ref:box.id};
  const isolation:CampusMove[]=heldLots.map(id=>({
    from:'materials',to:'quarantine',start:inspected,end:quarantinedAt,load:'cart',order:box.order,ref:id,
  }));
  return {...run,returns:[...run.returns,{box:box.id,received,inspected,quarantinedAt,heldLots}],end:Math.max(run.end,quarantinedAt),
    moves:[...run.moves,move,...isolation],events:events.sort((a,b)=>a.time-b.time)};
}

export function campusInventory(run:CampusResult,time:number){
  const returned=new Set(run.returns.filter(item=>item.inspected<=time).flatMap(item=>item.heldLots));
  return run.receipts.map(receipt=>{
    const used=receipt.uses.filter(use=>use.time<=time).reduce((sum,use)=>sum+use.units,0);
    const held=(receipt.held!==undefined&&receipt.held<=time)||returned.has(receipt.id);
    const movingToHold=run.returns.some(item=>item.inspected<=time&&time<item.quarantinedAt&&item.heldLots.includes(receipt.id));
    const approved=receipt.approved!==undefined&&receipt.approved<=time;
    return {...receipt,name:materialNames[receipt.material],used,available:approved&&!held?receipt.units-used:0,
      quarantined:held?receipt.units-used:0,state:movingToHold?'격리 이송':held?'격리':approved?'승인':receipt.arrived<=time?'검사 중':'입고 예정'};
  });
}

export function campusMetrics(run:CampusResult,time:number){
  const stock=campusInventory(run,time);
  const map=run.wafers.filter(wafer=>wafer.sorted<=time).flatMap(wafer=>wafer.dies);
  const decided=run.packages.filter(pkg=>pkg.decision>0&&pkg.decision<=time);
  const approved=decided.filter(pkg=>pkg.accepted);
  const delivered=run.boxes.filter(box=>box.delivered<=time);
  const due=run.orders.filter(order=>order.due<=time);
  return {
    inbound:stock.filter(item=>item.arrived<=time).length,quarantined:stock.filter(item=>item.quarantined>0).length,
    yield:map.length?100*map.filter(die=>die.good).length/map.length:null,
    packageYield:decided.length?100*approved.length/decided.length:null,
    accepted:approved.length,delivered:delivered.reduce((sum,box)=>sum+box.packages.length,0),
    waiting:run.orders.reduce((sum,order)=>sum+Math.max(0,Math.min(time,order.kitStart??0)-(order.sorted??0)),0),
    dockOnTime:stock.some(item=>item.arrived<=time)?
      100*stock.filter(item=>item.arrived<=time&&item.arrived<=item.promised).length/stock.filter(item=>item.arrived<=time).length:null,
    onTime:delivered.length?100*delivered.filter(box=>box.delivered<=run.orders.find(order=>order.id===box.order)!.due).length/delivered.length:null,
    dueOnTime:due.length?100*due.filter(order=>delivered.some(box=>box.order===order.id&&box.delivered<=order.due)).length/due.length:null,
    fabBusy:Object.values(run.fabRuns).flatMap(fab=>fab.work).reduce((sum,item)=>sum+Math.max(0,Math.min(time,item.end)-item.start),0),
    waferComplete:Object.values(run.fabRuns).flatMap(fab=>fab.lots).filter(lot=>lot.completed!==undefined&&lot.completed<=time).length*2,
    dockWait:run.moves.filter(move=>move.from==='yard'&&move.to==='yard')
      .reduce((sum,move)=>sum+Math.max(0,Math.min(time,move.end)-move.start),0),
    testWait:run.work.filter(item=>item.lane.startsWith('ATE')&&item.job!=='재시험')
      .reduce((sum,item)=>sum+Math.max(0,Math.min(time,item.start)-(run.moves.find(move=>move.to==='test'&&move.order===item.order)?.end??time)),0),
    fabTransfer:run.moves.filter(item=>item.load==='foup'&&item.end<=time).reduce((sum,item)=>sum+item.end-item.start,0),
    utilityLines:Object.values(run.fabRuns).filter(fab=>fab.work.some(item=>item.start<=time&&item.end>time)).length,
    finishedStock:run.boxes.filter(box=>box.verified+8<=time&&box.shipped>time).reduce((sum,box)=>sum+box.packages.length,0),
  };
}
