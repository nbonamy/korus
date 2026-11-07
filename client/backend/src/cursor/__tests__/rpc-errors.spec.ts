import { afterEach, expect, it } from 'vitest';
import { AcpConnection, AcpError } from '../../acp/acp-connection';
import { cursorRpcErrorMessage, isCursorAuthenticationFailure, isCursorQuotaFailure } from '../rpc-errors';

const connections: AcpConnection[] = [];
afterEach(async () => { await Promise.all(connections.splice(0).map(connection => connection.close())); });
const authentication = 'Cursor authentication is required. Reconnect Cursor in Settings.';
const quota = 'Cursor usage limit reached. Check your Cursor plan or usage in Cursor.';
const team = 'Your team has switched. Reconnect Cursor in Settings.';
const policy = 'Cursor ACP is blocked by your team policy. Contact your administrator.';
const generic = 'Cursor ACP request failed (-32603). Try again in this conversation.';
function connect(script = `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:request.params.error})+'\\n');});`, overrides: Partial<ConstructorParameters<typeof AcpConnection>[0]> = {}) {
  const connection = new AcpConnection({displayName:'Cursor',command:process.execPath,args:['-e',script],cwd:process.cwd(),env:process.env,
    formatRpcError:cursorRpcErrorMessage,onRequest:async()=>({}),onNotification:()=>{},onClose:()=>{},...overrides});
  connections.push(connection); connection.start(); return connection;
}

// Actual framed RPC failures: only fixed safe messages leave the adapter, and
// auth/quota classification never mistakes congestion or an unknown failure for login expiry.
it.each([
  {code:-32000,native:'Private native diagnostic',message:authentication,auth:true,limited:false},
  {code:-32000,native:'Usage limit exceeded',message:authentication,auth:true,limited:false},
  {code:-32000,native:'Your team has switched',message:team,auth:true,limited:false},
  {code:-32000,native:'Headless ACP use is disabled by team policy',message:policy,auth:true,limited:false},
  {code:-32603,native:'ACP is blocked by policy',message:policy,auth:true,limited:false},
  {code:-32603,native:'You have hit your usage limit',message:quota,auth:false,limited:true},
  {code:-32603,native:'Your quota has been exhausted',message:quota,auth:false,limited:true},
  {code:-32603,native:'Insufficient credits',message:quota,auth:false,limited:true},
  {code:-32603,native:'[resource_exhausted] Usage limit exceeded',message:quota,auth:false,limited:true},
  {code:-32603,native:'[resource_exhausted] Insufficient credits',message:quota,auth:false,limited:true},
  {code:-32603,native:'[resource_exhausted] Overloaded. HTTP 429. Retry later',message:generic,auth:false,limited:false},
  {code:-32603,native:'[unavailable] Usage limit exceeded',message:generic,auth:false,limited:false},
  {code:-32000,native:'[resource_exhausted] Usage limit exceeded',message:authentication,auth:true,limited:false},
  {code:-32603,native:'Overloaded. Retry later. HTTP 429',message:generic,auth:false,limited:false},
  {code:-32601,native:'Method not found',message:'Cursor ACP request failed (-32601). Try again in this conversation.',auth:false,limited:false},
  {code:429,native:'Too many requests',message:'Cursor ACP request failed (429). Try again in this conversation.',auth:false,limited:false},
  {code:-32603,native:'Rate limit exceeded',message:generic,auth:false,limited:false},
  {code:-32603,native:"Model 'quota exceeded' is unavailable",message:generic,auth:false,limited:false},
  {code:-32603,native:'You have not exceeded your quota',message:generic,auth:false,limited:false},
  {code:-32603,native:{diagnostic:'quota exceeded'},message:generic,auth:false,limited:false},
])('classifies $code / $native without exposing diagnostics', async ({code,native,message,auth,limited}) => {
  const error = await connect().request('session/prompt',{error:{code,message:typeof native === 'string' ? `${native}. SECRET https://private.invalid/account/model` : native,data:{token:'SECRET'}}}).catch(error => error);
  expect(error).toBeInstanceOf(AcpError);
  if (!(error instanceof AcpError)) throw error;
  expect(error.code).toBe(code);
  expect(error.message).toBe(message);
  expect(isCursorAuthenticationFailure(error)).toBe(auth);
  expect(isCursorQuotaFailure(error)).toBe(limited);
  expect(`${error.stack} ${JSON.stringify(error)}`).not.toMatch(/SECRET|private\.invalid|diagnostic|token/);
});

it.each(['loss','timeout'])('keeps transport %s separate from authentication and quota exhaustion', async kind => {
  const script = kind === 'loss' ? `process.stdin.once('data',()=>process.exit(0));` : `process.stdin.resume();`;
  const error = await connect(script).request('session/prompt',{},kind === 'timeout' ? 100 : 5000).catch(error => error);
  expect(error).toBeInstanceOf(Error);
  if (!(error instanceof Error)) throw error;
  expect(error.message).toMatch(kind === 'timeout' ? /request timed out/ : /output stream ended|runtime closed/);
  expect(isCursorAuthenticationFailure(error)).toBe(false);
  expect(isCursorQuotaFailure(error)).toBe(false);
});

it.each([
  {marker:'Your team has switched',message:team},
  {marker:'Headless ACP use is disabled',message:policy},
])('retains authentication classification for the safe stderr marker $marker', async ({marker,message}) => {
  const script = `process.stdin.once('data',()=>process.stderr.write(${JSON.stringify(marker + ' SECRET https://private.invalid/account')}));`;
  const error = await connect(script,{stderrErrorMarkers:[{marker,message}]}).request('session/prompt',{}).catch(error=>error);
  if (!(error instanceof Error)) throw error;
  expect(error.message).toBe(message);
  expect(isCursorAuthenticationFailure(error)).toBe(true);
  expect(isCursorQuotaFailure(error)).toBe(false);
  expect(error.stack).not.toMatch(/SECRET|private\.invalid/);
});
