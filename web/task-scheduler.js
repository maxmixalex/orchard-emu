// SPDX-License-Identifier: MIT
// Yield to the Worker's task queue without nested setTimeout's 4 ms floor.
// Positive delays still use timers: catching up must not become busy-waiting.
export class TaskScheduler {
  constructor({channel = new MessageChannel(), setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
    this.channel = channel;
    // Web IDL timers require the Window/WorkerGlobalScope receiver. Keeping
    // them as plain object methods makes `this` a TaskScheduler in browsers
    // (Illegal invocation); Node's timers do not catch this integration bug.
    this.setTimer = setTimer.bind(globalThis);
    this.clearTimer = clearTimer.bind(globalThis);
    this.jobs = new Map();
    this.nextId = 1;
    this.closed = false;
    this.immediateTasks = 0;
    channel.port1.onmessage = ({data}) => this.run(data);
    channel.port1.start?.();
  }
  schedule(callback, delay = 0) {
    if (this.closed || typeof callback !== 'function' || !Number.isFinite(delay) || delay < 0)
      throw new Error('Invalid scheduled task');
    const id = this.nextId++;
    const job = {callback, timer: null};
    this.jobs.set(id, job);
    try {
      // Some runtimes drain one MessagePort until it becomes empty. An
      // endless self-post chain can starve the UI command port (including
      // pause). Bound each burst and yield across task sources every 4 jobs.
      if (delay > 0 || this.immediateTasks >= 4) {
        this.immediateTasks = 0;
        job.timer = this.setTimer(() => this.run(id), delay);
      } else {
        ++this.immediateTasks;
        this.channel.port2.postMessage(id);
      }
    } catch (error) { this.jobs.delete(id); throw error; }
    return id;
  }
  run(id) {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.delete(id);
    job.callback();
  }
  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.timer !== null) this.clearTimer(job.timer);
    this.jobs.delete(id);
  }
  close() {
    for (const id of this.jobs.keys()) this.cancel(id);
    this.closed = true;
    this.channel.port1.close();
    this.channel.port2.close();
  }
}
