export function runWorker<Input,Output>(create:()=>Worker,input:Input,signal:AbortSignal):Promise<Output> {
  return new Promise((resolve,reject)=>{
    signal.throwIfAborted();
    const worker=create();
    function cleanUp(){worker.terminate();signal.removeEventListener('abort',abort);}
    function abort(){cleanUp();reject(signal.reason);}
    signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data}:MessageEvent<Output>)=>{cleanUp();resolve(data);};
    worker.onerror=event=>{cleanUp();reject(new Error(event.message));};
    worker.onmessageerror=()=>{cleanUp();reject(new Error('계산 결과를 읽을 수 없습니다.'));};
    try{worker.postMessage(input);}catch(error){cleanUp();reject(error);}
  });
}
