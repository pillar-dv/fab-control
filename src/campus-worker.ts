import {runCampus,type CampusInput,type CampusResult} from './campus';

export type CampusJob = {input:CampusInput; type:'scenario'|'capacity'};
export type CampusReply = {type:'scenario'; normal:CampusResult; current:CampusResult; originalLayout?:CampusResult}|
  {type:'capacity'; cases:CampusResult[]}|{type:'error'; message:string};

self.addEventListener('message',({data:{type,input}}:MessageEvent<CampusJob>)=>{
  try{
    const reply:CampusReply=type==='capacity'?{type,cases:([[1,1],[2,1],[2,2]] as const)
      .map(([fabCount,testLanes])=>runCampus({...input,fabCount,testLanes}))}:
      {type,normal:runCampus({...input,hbmDelay:0,deliveryDelay:0,testOutage:false,utilityOutage:false,holdWafer:false}),current:runCampus(input),
        originalLayout:input.railEdits&&Object.keys(input.railEdits).length?runCampus({...input,railEdits:undefined}):undefined};
    self.postMessage(reply);
  }catch(error){self.postMessage({type:'error',message:error instanceof Error?error.message:String(error)} satisfies CampusReply);}
});
