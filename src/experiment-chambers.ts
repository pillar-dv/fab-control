import {stepDwell,type ProcessStep} from './simulation';
import type {ChamberActivity, ChamberOrder} from './fab-experiment';

export interface ChamberJob {lot:number; steps:ProcessStep[]}

// A cluster batch admits lots with the same sequence of physical process modules.
export function sharedChamberCycle(jobs:ChamberJob[],wafers:number,chambers:number,arms:1|2,order:ChamberOrder,start:number){
  let time=start;
  const work=jobs.map(job=>({lot:job.lot,start,end:start,activities:[] as ChamberActivity[]}));
  for(let stage=0;stage<jobs[0].steps.length;stage++){
    const queue=Array.from({length:wafers},(_,wafer)=>jobs.map((job,index)=>({index,wafer:wafer+1,step:job.steps[stage]}))).flat();
    type Wafer=typeof queue[number];
    const slots:(Wafer&{ready:number}|null)[]=Array(chambers).fill(null);
    function load(item:Wafer,chamber:number,from:number,until:number){
      const ready=until+stepDwell[item.step.action];
      work[item.index].activities.push({kind:'load',wafer:item.wafer,chamber:chamber+1,start:from,end:until,step:item.step.label},
        {kind:'process',wafer:item.wafer,chamber:chamber+1,start:until,end:ready,step:item.step.label});
      slots[chamber]={...item,ready};
    }
    while(queue.length||slots.some(Boolean)){
      const ready=slots.findIndex(item=>item!==null&&item.ready<=time);
      const free=slots.indexOf(null);
      if(ready>=0&&(arms===2&&queue.length>0||order==='unload'||free<0||!queue.length)){
        const item=slots[ready]!,swap=arms===2&&queue.length>0;
        const end=time+(swap?1.8:1.2);
        work[item.index].activities.push({kind:'unload',wafer:item.wafer,chamber:ready+1,start:time,end:time+1.2,step:item.step.label});
        work[item.index].end=time+1.2;
        slots[ready]=null;
        if(swap)load(queue.shift()!,ready,time+1.2,end);
        time=end;
      }else if(free>=0&&queue.length){
        load(queue.shift()!,free,time,time+1.2);
        time+=1.2;
      }else time=Math.min(...slots.flatMap(item=>item?[item.ready]:[]));
    }
  }
  return work.map(job=>({...job,start:job.activities[0].start}));
}
