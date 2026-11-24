import {compareFleet} from './experiment-analysis';
import {runExperiment,type ExperimentInput,type ExperimentPolicy,type ExperimentResult} from './fab-experiment';

type RunPair = [ExperimentResult,ExperimentResult];
type FleetSummary = Awaited<ReturnType<typeof compareFleet>>;
export type ExperimentJob = {
  input:ExperimentInput;
  policies:[ExperimentPolicy,ExperimentPolicy];
} & ({type:'compare'}|{type:'fleet'; repetitions:number});
export type ExperimentReply = {type:'compare'; result:RunPair}|{type:'fleet'; result:FleetSummary}|{type:'error'; message:string};

self.addEventListener('message',async ({data:job}:MessageEvent<ExperimentJob>)=>{
  try{
    const reply:ExperimentReply=job.type==='compare'?
      {type:'compare',result:[runExperiment(job.input,job.policies[0]),runExperiment(job.input,job.policies[1])]}:
      {type:'fleet',result:await compareFleet(job.input,job.policies,job.repetitions)};
    self.postMessage(reply);
  }catch(error){
    self.postMessage({type:'error',message:error instanceof Error?error.message:String(error)} satisfies ExperimentReply);
  }
});
