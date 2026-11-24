import type {ExperimentInput,ExperimentPolicy} from './fab-experiment';
import type {RailTopology} from './experiment-rail';
import {PRODUCTS,type ProcessStep,type ProductId} from './simulation';
import type {FabRelease} from './fab-experiment';

export const railNames:Record<RailTopology,string>={
  loop:'순환 본선',bypass:'병목 우회선',dual:'반대 방향 복선',relay:'스토커 인계 이중 루프',vertical:'층간 리프터 이중 루프',
};

export const recipeStation=(step:ProcessStep)=>step.action==='expose'?'track':step.station;

export function noise(seed:number,index:number){
  let value=Math.imul((seed|0)^Math.imul(index+1,0x9e3779b1),0x85ebca6b);
  value=Math.imul(value^(value>>>16),0xc2b2ae35);
  return ((value^(value>>>13))>>>0)/4294967296;
}

export function recipeFor(product:ProductId,input:ExperimentInput){
  const steps=PRODUCTS[product].steps;
  const order=input.recipeOrder?.[product];
  if(!order||order.length!==steps.length||new Set(order).size!==steps.length||order.some(index=>!steps[index]))return steps;
  return order.map(index=>steps[index]);
}

export function experimentDemand(input:ExperimentInput):FabRelease[]{
  const secondary=input.secondary===input.primary?'':input.secondary;
  const mix=(input.mixPercent??50)/100;
  const lots=Array.from({length:input.lots},(_,i)=>{
    const main=!secondary||Math.ceil((i+1)*mix)>Math.ceil(i*mix);
    const nominal=i*input.releaseEvery;
    const offset=(noise(input.seed??1,i)-.5)*2*(input.jitter??0);
    const peak=input.releasePattern==='peak'?Math.min(nominal,input.releaseEvery)+(nominal>input.releaseEvery?(i%3)*.25:0):nominal;
    return {product:main?input.primary:secondary||input.primary,time:Math.max(0,peak+offset),
      test:!!input.testEvery&&(i+1)%input.testEvery===0};
  });
  return [...lots,...Array.from({length:input.emptyTrips??0},(_,i)=>({product:input.primary,time:(i+.5)*input.releaseEvery,empty:true}))];
}

export function topologyFor(policy:ExperimentPolicy):RailTopology {
  return policy.topology??(policy.bypass?'bypass':'loop');
}
