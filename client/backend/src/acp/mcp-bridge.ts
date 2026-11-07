import { product } from '@workspace/core/product';

// The native runtime starts one bridge per session. Its URL stays in that child's
// environment; neither identities nor endpoint configuration reach shared files.
const bridge = String.raw`
const readline = require('node:readline');
const endpoint = process.env.KORUS_ACP_MCP_URL;
const allowed = process.env.KORUS_ACP_MCP_TOOLS ? new Set(JSON.parse(process.env.KORUS_ACP_MCP_TOOLS)) : null;
let session;
const output = value => {
  if(allowed && Array.isArray(value.result?.tools)) value.result.tools=value.result.tools.filter(tool=>allowed.has(tool.name));
  process.stdout.write(JSON.stringify(value) + '\n');
};
async function request(message) {
  try {
    // Google's harness probes this optional discovery extension before MCP
    // initialize. The bridge has no extra discovery metadata to advertise.
    if(message.method==='server/discover') { output({jsonrpc:'2.0',id:message.id,result:{}}); return; }
    if(allowed && message.method==='tools/call' && !allowed.has(message.params?.name)) throw new Error('Tool unavailable in this review');
    const response = await fetch(endpoint, {method:'POST',headers:{
      'Content-Type':'application/json', Accept:'application/json, text/event-stream',
      ...(session ? {'Mcp-Session-Id':session} : {}),
    },body:JSON.stringify(message),signal:AbortSignal.timeout(30*60*1000)});
    session = response.headers.get('mcp-session-id') || session;
    if(!response.ok) throw new Error('MCP request failed');
    if(response.status===204 || response.status===202) return;
    if(response.headers.get('content-type')?.includes('text/event-stream')) {
      let buffer=''; const decoder=new TextDecoder();
      for await(const chunk of response.body) {
        buffer+=decoder.decode(chunk,{stream:true}).replaceAll('\r\n','\n');
        if(buffer.length>8*1024*1024) throw new Error('MCP response too large');
        let end;
        while((end=buffer.indexOf('\n\n'))>=0) {
          const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);
          const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
          if(data) output(JSON.parse(data));
        }
      }
    } else { const text=await response.text(); if(text.trim()) output(JSON.parse(text)); }
  } catch { if(message.id!==undefined) output({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:'Session MCP bridge request failed.'}}); }
}
const lines=readline.createInterface({input:process.stdin});
lines.on('line',line=>{try{const message=JSON.parse(line);void request(message);}catch{process.exitCode=1;lines.close();}});
lines.on('close',()=>process.exit());
`;

export function sessionMcpServer(url: string, name = product.mcpServerName, allowedTools?: string[]) {
  const endpoint = new URL(url);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Invalid session MCP endpoint.');
  return { name, command: process.execPath, args: ['-e', bridge], env: [{ name: 'KORUS_ACP_MCP_URL', value: endpoint.href },
    ...(allowedTools ? [{ name: 'KORUS_ACP_MCP_TOOLS', value: JSON.stringify(allowedTools) }] : []),
  ] };
}
