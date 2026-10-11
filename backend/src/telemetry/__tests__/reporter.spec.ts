import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, it, expect, vi } from 'vitest';
import { TelemetryReporter, type ReporterConfig } from '../reporter';
import { UsageLedger } from '../usage-ledger';
import type { ExecutionObservation } from '@workspace/core/usage';
const dirs:string[]=[];
afterEach(async()=>{ await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true}))); });
async function file(name:string) { const d=await mkdtemp(path.join(os.tmpdir(),'telemetry-'));dirs.push(d);return path.join(d,name); }
const config:ReporterConfig={rollout:true,forceOff:false,environment:true,endpoint:'http://127.0.0.1:9999/report',synthetic:true,version:'0.33.0',channel:'stable',platform:'macos',client:'desktop'};
const event:ExecutionObservation={agentId:'CANARY_agent',sessionId:'CANARY_session',turnId:'one',provider:'claude',phase:'started',at:Date.parse('2026-10-11T23:59:00Z'),model:'CANARY_private_model'};
it('requires disclosure, preserves choices, fails closed and purges immutable retry batches on opt out',async()=>{
  let now=event.at; const sends:string[]=[]; const deliver=vi.fn(async(_url:unknown,input:RequestInit)=>{sends.push(String(input.body));return new Response(null,{status:503});});
  const f=await file('outbox');const reporter=new TelemetryReporter(f,config,()=>now,deliver as typeof fetch,()=>0);await reporter.load();
  await reporter.feature('desktop','off','agent.create','succeeded');expect(reporter.privacy('desktop').pending).toStrictEqual([]);
  await reporter.choose('desktop',{enabled:true,disclosure:1});
  await reporter.execution(event,'desktop');await reporter.execution(event,'desktop');
  await reporter.feature('unknown-remote','remote','agent.create','succeeded');
  expect(reporter.privacy('desktop').pending[0]?.rows).toStrictEqual([{day:'2026-10-11',metric:'turn.started',provider:'claude',model:'custom',value:1}]);
  now+=4000000;await reporter.flush();now+=4000000;await reporter.flush();
  expect(sends).toHaveLength(2);expect(sends[1]).toBe(sends[0]);expect(sends.join()).not.toContain('CANARY');
  await reporter.choose('desktop',{enabled:false,disclosure:1});expect(reporter.privacy('desktop').pending).toStrictEqual([]);await reporter.close();
  const restored=new TelemetryReporter(f,config,()=>now);await restored.load();expect(restored.privacy('desktop').choice).toStrictEqual({enabled:false,disclosure:1});await restored.close();
  for(const override of [{forceOff:true},{rollout:false},{environment:false}]) { const blocked=new TelemetryReporter(f,{...config,...override},()=>now);await blocked.load();await blocked.choose('desktop',{enabled:true,disclosure:1});expect(blocked.allowed('desktop')).toBe(false);await blocked.close(); }
});
it('invalidates an in-flight upload and never resurrects pre-disable counters',async()=>{
 let now=event.at;let finish!:(r:Response)=>void;const request=new Promise<Response>(r=>finish=r);let signal:AbortSignal|null|undefined;
 const reporter=new TelemetryReporter(await file('outbox'),config,()=>now,vi.fn((_u,_i)=>{signal=_i?.signal;return request;}) as typeof fetch,()=>0);await reporter.load();await reporter.choose('desktop',{enabled:true,disclosure:1});await reporter.execution(event,'desktop');now+=4000000;
 const flush=reporter.flush();await vi.waitFor(()=>expect(signal).toBeDefined());await reporter.choose('desktop',{enabled:false,disclosure:1});expect(signal!.aborted).toBe(true);await reporter.choose('desktop',{enabled:true,disclosure:1});finish(new Response(null,{status:200}));await flush;
 await reporter.execution({...event,phase:'completed',at:now},'desktop');expect(reporter.privacy('desktop').pending).toStrictEqual([]);await reporter.close();
});
it('bounds expired queues and drops incompatible reports without affecting work',async()=>{
 let now=event.at;const reporter=new TelemetryReporter(await file('outbox'),config,()=>now,vi.fn(async()=>new Response(null,{status:422})) as typeof fetch,()=>0);await reporter.load();await reporter.choose('desktop',{enabled:true,disclosure:1});await reporter.feature('desktop','one','git.branch','failed');now+=4000000;await reporter.flush();expect(reporter.privacy('desktop').pending).toStrictEqual([]);
 await reporter.feature('desktop','two','git.branch','cancelled');now+=8*86400000;await reporter.flush();expect(reporter.privacy('desktop').pending).toStrictEqual([]);await reporter.close();
});
it('persists one actual execution and terminal outcome across restart, with unknown consumption and start-date attribution',async()=>{
 const f=await file('local');let now=event.at;let ledger=new UsageLedger(f,()=>now);await ledger.load();
 expect(await ledger.observe(event,{teamId:'team',repository:'/private/repo'})).toBe(true);expect(await ledger.observe(event,{teamId:null,repository:null})).toBe(false);
 now+=120000;await ledger.observe({...event,phase:'completed',at:now},{teamId:null,repository:null});await ledger.close();ledger=new UsageLedger(f,()=>now);await ledger.load();expect(await ledger.observe(event,{teamId:null,repository:null})).toBe(false);
 await ledger.observe({...event,sessionId:'fork',turnId:'retry',at:now},{teamId:'team',repository:'/private/repo'});await ledger.observe({...event,sessionId:'fork',turnId:'retry',at:now,phase:'failed',tokens:{input:100,cacheRead:20,cacheWrite:5,output:30,reasoning:10}},{teamId:null,repository:null});
 expect(ledger.query({from:'2026-10-11',to:'2026-10-11',group:'provider'}).rows).toStrictEqual([{label:'claude',started:1,completed:1,failed:0,interrupted:0,inProgress:0,measuredTurns:0,tokens:null}]);
 expect(ledger.query({agentId:'CANARY_agent',from:'2026-10-12'}).rows[0]?.tokens).toStrictEqual({input:100,output:30,cacheRead:20,cacheWrite:5,reasoning:10});await ledger.close();
});
