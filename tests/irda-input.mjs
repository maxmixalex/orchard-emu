// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {IrDAInput,irdaTimeline,irdaSuffix,IRDA_SPAN_TICKS,IRDA_WINDOW_PACKETS} from '../web/irda-input.js';
function harness(){
 const delivered=[],replies=[],progress=[];let tick=0,ready=true,capacity=1024;
 const receiver=new IrDAInput({ready:()=>ready,send:bytes=>{
  const accepted=Math.min(capacity,bytes.length);delivered.push({tick,bytes:Array.from(bytes.subarray(0,accepted))});return accepted;
 },reply:result=>replies.push(result),progress:result=>progress.push(result)});
 return {receiver,delivered,replies,progress,setReady:value=>ready=value,setCapacity:value=>capacity=value,
  run(at){assert(at>=tick);tick=at;receiver.poll(tick);receiver.notifyProgress(tick);},
  input(bytes,segments,request=1){receiver.receive({request,bytes:Uint8Array.from(bytes),segments},tick);}};
}
{
 const h=harness();h.run(5000);
 h.input([1,2,3,4,5],[[2,20167680],[3,20311232]]);
 assert.deepEqual(h.delivered,[{tick:5000,bytes:[1,2]}]);assert.deepEqual(h.replies,[]);
 assert.equal(h.receiver.boundary(5000),148552);
 h.run(148551);assert.equal(h.delivered.length,1);h.run(148552);
 assert.deepEqual(h.delivered,[{tick:5000,bytes:[1,2]},{tick:148552,bytes:[3,4,5]}]);
 assert.deepEqual(h.replies,[{request:1,accepted:5,discarded:false}]);
 // A packet boundary does not reset the nominal clock mapping. Already elapsed
 // idle time is counted, and a late packet can catch up to that mapping.
 h.run(150000);h.input([6],[[1,20316232]],2);assert.equal(h.receiver.boundary(150000),153552);
 h.run(153552);h.run(180000);h.input([7],[[1,20321232]],3);
 assert.deepEqual(h.delivered.at(-1),{tick:180000,bytes:[7]});
}
{
 const h=harness();h.setCapacity(0);h.input([10,11,12,13],[[3,40],[1,1040]]);
 h.run(10);assert.equal(h.receiver.boundary(10),IRDA_SPAN_TICKS+1000);assert.equal(h.replies.length,0);
 h.setCapacity(1);h.run(20);h.run(30);h.run(40);
 assert.equal(h.receiver.boundary(40),1000,'Partial retries do not postpone later source intervals');
 h.run(999);h.run(1000);
 assert.deepEqual(h.delivered.flatMap(row=>row.bytes),[10,11,12,13]);
 assert.deepEqual(h.replies,[{request:1,accepted:4,discarded:false}]);
 assert(h.progress.every((row,index)=>index===0||row.tick>h.progress[index-1].tick));
}
{
 const h=harness();h.run(1000);h.input([1],[[1,0]]);
 h.run(1150);h.input([2],[[1,100]],2);
 h.run(1190);h.input([3],[[1,200]],3);
 assert.equal(h.receiver.boundary(1190),1200,'Late packet completion does not move the initial source clock anchor');
 h.run(1200);h.run(1350);h.input([4],[[1,300]],4);
 h.run(1390);h.input([5],[[1,400]],5);
 assert.equal(h.receiver.boundary(1390),1400,'Repeated host lateness does not add drift');
 h.run(1400);h.run(2000);h.input([6],[[1,10000]],6);
 assert.equal(h.receiver.boundary(2000),11000,'A later long idle interval uses the original anchor');
 h.run(11000);
 assert.deepEqual(h.delivered,[{tick:1000,bytes:[1]},{tick:1150,bytes:[2]},
  {tick:1200,bytes:[3]},{tick:1350,bytes:[4]},{tick:1400,bytes:[5]},{tick:11000,bytes:[6]}]);
 assert(h.replies.every(row=>row.accepted===1&&!row.discarded));
}
{
 const h=harness();h.run(1000);h.input([1],[[1,0]]);
 h.run(1200);h.input([2,3,4],[[1,100],[1,200],[1,300]],2);
 assert.deepEqual(h.delivered.at(-1),{tick:1200,bytes:[2]});
 assert.equal(h.receiver.boundary(1200),1300,'Late coalesced input retains the internal source interval');
 h.run(1350);assert.equal(h.receiver.boundary(1350),1400,'A late poll does not move later segments');
 h.run(1400);h.input([5],[[1,500]],3);
 assert.equal(h.receiver.boundary(1400),1500,'The late packet does not move the next packet clock');
 h.run(1500);
 assert.deepEqual(h.delivered.flatMap(row=>row.bytes),[1,2,3,4,5]);
}
{
 const h=harness();h.run(1000);h.input([1],[[1,100]]);
 h.setReady(false);h.run(1500);h.setReady(true);
 h.input([2],[[1,1000000]],2);
 assert.deepEqual(h.delivered,[{tick:1000,bytes:[1]},{tick:1500,bytes:[2]}],
  'An empty receiver that closed and reopened does not inherit the earlier clock phase');
 h.input([3],[[1,1000100]],3);assert.equal(h.receiver.boundary(1500),1600);h.run(1600);
 assert.deepEqual(h.delivered.at(-1),{tick:1600,bytes:[3]},'The new receive session preserves its own source interval');
 h.setReady(false);h.run(1700);h.setReady(true);
 assert.throws(()=>h.input([4],[[1,999999]],4),/backwards/,
  'Hardware receive closure does not release same-peer source ordering');
}
{
 const h=harness();h.run(1000);h.input([1,2],[[1,100],[1,1000100]]);
 h.setReady(false);h.run(2000);h.setReady(true);
 assert.equal(h.receiver.boundary(2000),1001000,'Queued future input retains its established due time while RX is temporarily disabled');
 h.run(1001000);h.input([3],[[1,1000200]],2);
 assert.equal(h.receiver.boundary(1001000),1001100,'A temporary RX disable with future input does not reanchor later packets');
 h.run(1001100);assert.deepEqual(h.delivered,[{tick:1000,bytes:[1]},{tick:1001000,bytes:[2]},{tick:1001100,bytes:[3]}]);
}
{
 const h=harness();h.input([1,2,3],[[1,10],[2,1000010]]);h.run(1);
 h.receiver.reset(1);assert.deepEqual(h.replies,[{request:1,accepted:1,discarded:true}]);
 h.input([8,9],[[2,2]],2);h.run(2000000);
 assert.deepEqual(h.delivered.flatMap(row=>row.bytes),[1,8,9],'New peer has a new clock epoch; no old suffix');
 assert.equal(h.receiver.pending,null);
}
{
 const h=harness();h.input([1,2],[[1,1],[1,500001]]);h.setReady(false);h.run(2);
 assert.equal(h.replies.length,0);h.setReady(true);h.run(500000);
 assert.deepEqual(h.delivered.flatMap(row=>row.bytes),[1,2],'Temporary RX disable before due does not lose future input');
 assert.deepEqual(h.replies,[{request:1,accepted:2,discarded:false}]);
}
{
 const h=harness();h.setReady(false);h.input([1,2],[[1,1],[1,500001]]);
 h.run(10);h.setReady(true);h.run(500000);
 assert.deepEqual(h.delivered.flatMap(row=>row.bytes),[2],'Only the segment arriving while RX is disabled is discarded');
 assert.deepEqual(h.replies,[{request:1,accepted:1,discarded:true}]);
}
{
 const h=harness();h.input([1,2,3],[[1,1],[1,11],[1,21]]);
 h.setReady(false);h.run(10);h.setReady(true);h.run(20);
 assert.deepEqual(h.delivered.flatMap(row=>row.bytes),[1,3]);
 assert.deepEqual(h.replies,[{request:1,accepted:2,discarded:true}]);
 h.input([4],[[1,31]],2);assert.equal(h.receiver.boundary(20),30);h.run(30);
 assert.deepEqual(h.delivered.flatMap(row=>row.bytes),[1,3,4],'Discarded middle segment neither repeats bytes nor resets the following clock interval');
}
{
 const h=harness();h.setCapacity(0);h.input([1],[[1,0]]);
 h.run(IRDA_SPAN_TICKS-1);assert.equal(h.replies.length,0);assert(h.progress.length);
 h.run(IRDA_SPAN_TICKS);
 assert.deepEqual(h.replies,[{request:1,accepted:0,discarded:true,error:'overflow'}]);
 h.run(3*IRDA_SPAN_TICKS);assert.equal(h.replies.length,1,'Clock progress cannot renew the finite guest backpressure budget');
}
{
 const h=harness();h.run(Number.MAX_SAFE_INTEGER-10);h.input([1],[[1,0]]);
 assert.equal(h.replies[0].error,'timing','Target deadline arithmetic must remain exact');
}
{
 const h=harness(),source=Number.MAX_SAFE_INTEGER-1000;
 h.run(1000);h.input([1,2],[[1,source],[1,source+100]]);
 assert.equal(h.receiver.boundary(1000),1100,'Large safe source stamps retain exact relative intervals');
 assert.equal(h.receiver.pending.deadline,1100+IRDA_SPAN_TICKS);
 h.run(1100);h.input([3],[[1,source+200]],2);
 assert.equal(h.receiver.boundary(1100),1200);h.run(1200);
 assert.deepEqual(h.delivered,[{tick:1000,bytes:[1]},{tick:1100,bytes:[2]},{tick:1200,bytes:[3]}]);
}
{
 const h=harness();h.input([1],[[1,0]]);h.input([2],[[1,IRDA_SPAN_TICKS+1]],2);
 assert.deepEqual(h.replies.at(-1),{request:2,accepted:0,discarded:true,error:'timing'});
 assert.deepEqual(h.delivered.flatMap(row=>row.bytes),[1]);
}
{
 const h=harness();h.setCapacity(0);
 h.input([31],[[1,100]],1);h.input([32],[[1,100]],2);h.input([33],[[1,100]],3);
 assert.equal(h.replies.length,0,'Several packets can wait for the actual UART together');
 h.setCapacity(1024);h.run(50);
 assert.deepEqual(h.delivered.filter(row=>row.bytes.length),[
  {tick:50,bytes:[31]},{tick:50,bytes:[32]},{tick:50,bytes:[33]},
 ],'One poll drains already due queued packets without a main-thread round trip');
 assert.deepEqual(h.replies,[1,2,3].map(request=>({request,accepted:1,discarded:false})));
}
{
 const h=harness();h.input([10,11],[[1,100],[1,1124]],1);
 h.input([12],[[1,1124]],2);h.input([13],[[1,1124]],3);
 h.run(1023);assert.equal(h.replies.length,0);assert.equal(h.receiver.boundary(1023),1024);
 h.run(1024);
 assert.deepEqual(h.delivered,[{tick:0,bytes:[10]},{tick:1024,bytes:[11]},
  {tick:1024,bytes:[12]},{tick:1024,bytes:[13]}],'A source gap survives while adjacent queued packets share its exact endpoint');
 assert.deepEqual(h.replies.map(result=>result.request),[1,2,3]);
}
{
 const h=harness();h.setCapacity(0);
 for(let request=1;request<=IRDA_WINDOW_PACKETS;request++)h.input([request],[[1,request]],request);
 h.run(100);assert.deepEqual(h.progress.map(result=>result.request),Array.from({length:IRDA_WINDOW_PACKETS},(_,index)=>index+1));
 h.run(100);assert.equal(h.progress.length,IRDA_WINDOW_PACKETS,'An unchanged guest tick cannot renew queued deadlines');
 h.run(IRDA_SPAN_TICKS);
 assert.equal(h.replies.length,IRDA_WINDOW_PACKETS);assert(h.replies.every(result=>result.error==='overflow'&&result.accepted===0));
 assert.equal(h.receiver.pending,null);assert.equal(h.receiver.queued,0);
 h.setCapacity(1024);h.input([90],[[1,100]],90);
 assert.equal(h.replies.at(-1).error,'overflow','An errored direction stays closed until reset');
 h.receiver.reset(IRDA_SPAN_TICKS);h.input([91],[[1,0]],91);
 assert.deepEqual(h.delivered.flatMap(row=>row.bytes),[91]);
}
{
 const h=harness();h.input([1],[[1,0]]);h.run(1000);h.setCapacity(0);
 h.input([2,3],[[1,100],[1,200]],2);h.input([4],[[1,200]],3);
 assert.equal(h.receiver.boundary(1000),1000+IRDA_SPAN_TICKS,'A queued packet deadline can precede the late head deadline');
 h.run(1000+IRDA_SPAN_TICKS);
 assert.deepEqual(h.replies.slice(1).map(result=>[result.request,result.error]),[[2,'overflow'],[3,'overflow']]);
}
{
 const h=harness();h.input([1,2],[[1,0],[1,1024]],1);
 for(let request=2;request<=IRDA_WINDOW_PACKETS;request++)h.input([request+10],[[1,1024]],request);
 h.receiver.reset(0);
 assert.deepEqual(h.replies,Array.from({length:IRDA_WINDOW_PACKETS},(_,index)=>({request:index+1,accepted:index===0?1:0,discarded:true})));
 assert.equal(h.receiver.queue.length,0);assert.equal(h.receiver.queued,0);
 h.input([99],[[1,3]],99);h.run(2048);
 assert.deepEqual(h.delivered.flatMap(row=>row.bytes),[1,99],'Reset cancels every future suffix without undoing already accepted bytes');
}
{
 const h=harness();h.setCapacity(0);h.input([1],[[1,100]],1);
 assert.throws(()=>h.input([2],[[1,99]],2),/backwards/,'Queued source time is validated before the head completes');
 assert.throws(()=>h.input([2],[[1,100]],1),/Duplicate/);
 h.receiver.reset();
 for(let request=1;request<=IRDA_WINDOW_PACKETS;request++)h.input([request],[[1,0]],request);
 h.input([99],[[1,0]],99);
 assert.equal(h.replies.at(-1).error,'overflow');assert.equal(h.receiver.queued,0,'A packet count overflow clears the failed direction');
 h.setCapacity(1024);h.run(1);assert.deepEqual(h.delivered.flatMap(row=>row.bytes),[]);
}
{
 const h=harness();h.setCapacity(0);h.input([1],[[1,10]],1);
 h.input([2],[[1,11+IRDA_SPAN_TICKS]],2);
 assert.equal(h.replies.at(-1).error,'overflow','The combined queue retains the original source-span bound');
}
assert.deepEqual(irdaSuffix([[3,20],[2,40]],2),[[1,20],[2,40]]);
assert.deepEqual(irdaSuffix([[3,20],[2,40]],3),[[2,40]]);
for(const segments of [[],[[0,1]],[[1,-1]],[[1,0.5]],[[1,Number.MAX_SAFE_INTEGER+1]],[[1,2],[1,1]],[[1,0],[1,IRDA_SPAN_TICKS+1]],[[2,1]],[[1,1,2]]])
 assert.throws(()=>irdaTimeline(1,segments),JSON.stringify(segments));
assert.equal(irdaTimeline(1024,Array.from({length:1024},(_,i)=>[1,i])).length,1024);
assert.throws(()=>irdaTimeline(1025,Array.from({length:1025},(_,i)=>[1,i])));
console.log('IrDA guest-clock input: bounded FIFO, same-tick cross-packet delivery, source gaps, finite queued deadlines, real progress and cancellation pass.');
