// SPDX-License-Identifier: MIT
// Runs unchanged against native browser APIs in both Window and Worker scope.
export async function checkScheduler(TaskScheduler) {
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function run(setup,label) {
    const scheduler=new TaskScheduler(setup),events=[];
    let timeout;
    try {
      await Promise.race([
        new Promise(resolve=>scheduler.schedule(()=>{events.push('delayed');resolve();},1)),
        new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error(label+': delayed task hung')),2000);})
      ]);
      clearTimeout(timeout);
      const cancelled=scheduler.schedule(()=>events.push('cancelled'),5);
      scheduler.cancel(cancelled);scheduler.cancel(cancelled);
      // Cross several native MessageChannel -> timer fairness boundaries.
      await Promise.race([
        new Promise(resolve=>{let n=0;const next=()=>{events.push('immediate');if(++n===24)resolve();else scheduler.schedule(next);};scheduler.schedule(next);}),
        new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error(label+': task chain hung')),2000);})
      ]);
      clearTimeout(timeout);
      scheduler.schedule(()=>events.push('closed'),10);
      scheduler.close();
      await sleep(30);
      check(events.filter(e=>e==='immediate').length===24,label+': lost task');
      check(events.length===25,label+': cancelled/closed task executed');
      check(scheduler.jobs.size===0,label+': leaked job');
      let rejected=false;try{scheduler.schedule(()=>{});}catch{rejected=true;}
      check(rejected,label+': closed scheduler accepted work');
      return {label,delayed:true,cancelled:true,immediateTasks:24,shutdown:true};
    } finally {clearTimeout(timeout);scheduler.close();}
  }
  return [await run(undefined,'default browser timers'),
    await run({setTimer:globalThis.setTimeout,clearTimer:globalThis.clearTimeout},'explicit native timers')];
}
