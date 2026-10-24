// SPDX-License-Identifier: MIT
// Private, opt-in host diagnostics. Never shipped in a production build.
// These timestamps belong to an instrumented run, not a performance sample.
export function attachRuntimeTrace({scheduler, context, now=()=>performance.now(),
  timeOrigin=performance.timeOrigin, maxEvents=50000}) {
  if (!Number.isFinite(timeOrigin) || !Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 100000)
    throw Error('Invalid runtime trace clock or event limit');
  let epoch=0, generation=null, model=null, rows=[], count=0, frozen=null, nextTask=0;
  const active=new Map();
  function record(type, detail={}) {
    if (!epoch || frozen) return null;
    const row={seq:++count,epoch,at_ms:now(),type,...context(),...detail};
    if (rows.length < maxEvents) rows.push(row);
    return row;
  }
  const schedule=scheduler.schedule.bind(scheduler), cancel=scheduler.cancel.bind(scheduler);
  scheduler.schedule=(callback, delay=0)=>{
    const task=++nextTask, queued=record('task-queued',{task,delay_ms:delay});
    return schedule(()=>{
      const start=record('task-start',{task,queued_seq:queued?.epoch===epoch?queued.seq:null});
      if (start) active.set(task,start.seq);
      try { return callback(); }
      finally { record('task-end',{task,start_seq:start?.seq??null});active.delete(task); }
    },delay);
  };
  scheduler.cancel=id=>{record('task-cancel',{scheduler_id:id});return cancel(id);};
  return {
    begin(entry) {
      epoch=entry.epoch;generation=entry.generation;model=entry.model;
      rows=[];count=0;frozen=null;active.clear();
      record('epoch',{source:entry.source});
    },
    command(data) {
      return record('command',{command:data?.type,
        main_seq:data?.diagnostic_runtime?.seq??null,
        main_time_origin_ms:data?.diagnostic_runtime?.time_origin_ms??null,
        main_at_ms:data?.diagnostic_runtime?.at_ms??null});
    },
    wrapCore(core) {
      const wrapped={...core};
      for (const name of ['keyboard_matrix','keyboard_dedicated']) {
        if (typeof core[name] !== 'function') continue;
        wrapped[name]=(...args)=>{
          const scan=name==='keyboard_matrix'?args[0]*7+args[1]:56+[0,4,5,6].indexOf(args[0]);
          const row=record('key-contact',{scan,down:Boolean(args.at(-1))});
          const result=core[name](...args);
          if(row)row.result=result;
          return result;
        };
      }
      return wrapped;
    },
    outgoing(data) {
      if (data.type!=='snapshot') return data;
      const row=record('snapshot-post',{running:data.running,loaded:data.loaded,
        stopped:data.stopped,frame_status:data.frameStatus});
      return row?{...data,diagnostic_runtime:{epoch,seq:row.seq}}:data;
    },
    capture(reason) {
      if (frozen) return frozen;
      record('capture',{reason});
      frozen={schema:'orchard-browser-runtime-trace-v1',instrumented:true,performance_sample:false,
        epoch,generation,model,time_origin_ms:timeOrigin,complete:count===rows.length,
        event_count:count,event_limit:maxEvents,events:rows.map(row=>({...row})),
        open_tasks:Array.from(active,([task,start_seq])=>({task,start_seq}))};
      return frozen;
    },
  };
}

// Replay validates this supplemental evidence without treating host time as
// reproducible guest state. Older exact-core traces need no runtime section.
export function validateRuntimeTrace(trace, identity=trace) {
  const ensure=(value,message)=>{if(!value)throw Error('Invalid runtime trace: '+message);};
  ensure(trace?.schema==='orchard-browser-runtime-trace-v1','schema');
  ensure(trace.instrumented===true&&trace.performance_sample===false,'not a performance sample');
  ensure(trace.complete===true,'incomplete event history');
  ensure(['epoch','generation','model'].every(key=>trace[key]===identity[key]),'identity differs from core trace');
  ensure(Number.isFinite(trace.time_origin_ms),'time origin');
  ensure(Number.isInteger(trace.event_limit)&&trace.event_limit>0&&trace.event_limit<=100000,'event limit');
  ensure(Array.isArray(trace.events)&&trace.events.length===trace.event_count&&trace.event_count<=trace.event_limit,'event count');
  const types=new Set(['epoch','command','key-contact','snapshot-post','task-queued','task-start','task-end','task-cancel','capture']);
  const tasks=new Map();let last=-Infinity;
  for(const [index,row] of trace.events.entries()) {
    ensure(row.seq===index+1,'missing or reordered event');
    ensure(['epoch','generation','model'].every(key=>row[key]===trace[key]),'event identity');
    ensure(Number.isFinite(row.at_ms)&&row.at_ms>=last,'non-monotonic host time');last=row.at_ms;
    ensure(Number.isSafeInteger(row.tick)&&row.tick>=0,'guest tick');
    ensure(types.has(row.type),'event type');
    if(row.type==='task-start') {
      const queued=row.queued_seq===null?null:trace.events[row.queued_seq-1];
      ensure(row.queued_seq===null||queued?.type==='task-queued'&&queued.task===row.task&&queued.seq<row.seq,'task queue association');
      ensure(!tasks.has(row.task),'duplicate running task');tasks.set(row.task,row.seq);
    } else if(row.type==='task-end') {
      ensure(tasks.get(row.task)===row.start_seq,'task start association');tasks.delete(row.task);
    } else if(row.type==='key-contact') {
      ensure(Number.isInteger(row.scan)&&row.scan>=0&&row.scan<60&&typeof row.down==='boolean','key contact');
      ensure(Number.isInteger(row.result)&&row.result>=0,'key contact result');
    }
  }
  ensure(Array.isArray(trace.open_tasks)&&trace.open_tasks.length===tasks.size&&
    trace.open_tasks.every(row=>tasks.get(row.task)===row.start_seq),'open task association');
  ensure(trace.events[0]?.type==='epoch'&&trace.events.at(-1)?.type==='capture','epoch/capture boundary');
  const observation=identity.host_observation;
  if(observation) {
    ensure(observation.instrumented===true&&observation.performance_sample===false,'observation is not a performance sample');
    const result=observation.result_worker_event,posted=trace.events[result?.seq-1];
    ensure(result?.epoch===trace.epoch&&posted?.type==='snapshot-post','result snapshot association');
    const command=trace.events.find(row=>row.type==='command'&&row.main_seq===observation.last_command_seq);
    ensure(command&&['tap','tap-sequence','key-down'].includes(command.command)&&command.seq<posted.seq,'input command association');
    ensure(trace.events.some(row=>row.type==='key-contact'&&row.down&&row.result===0&&
      row.scan===observation.completion_scan&&row.seq>command.seq&&row.seq<posted.seq),'completion key did not reach the guest');
  }
  return trace;
}
