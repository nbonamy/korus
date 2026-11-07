// Cursor CLI 2026.10.22-27dcf5f wire shapes, sanitized from plans/cursor.md.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
if (process.argv[2] === '--version') { console.log(fs.readFileSync(path.join(__dirname, 'version'), 'utf8')); process.exit(); }
if (process.argv[2] === 'status') { console.log(fs.existsSync(path.join(__dirname, 'status.json')) ? fs.readFileSync(path.join(__dirname, 'status.json'),'utf8') : JSON.stringify({ isAuthenticated: true })); process.exit(); }
if (process.argv[2] !== 'acp' || process.env.NO_OPEN_BROWSER !== '1' || process.env.CURSOR_API_KEY) process.exit(99);
const log = value => fs.appendFileSync(path.join(__dirname, 'wire.jsonl'), JSON.stringify(value) + '\n');
const historyFile = path.join(__dirname, 'history.json');
const history = () => fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : {};
const configOptions = [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'auto', options: [{ value: 'auto', name: 'Auto' }, { value: 'composer-2.5', name: 'Composer' }] }];
configOptions.push({id:'mode',name:'Mode',category:'mode',type:'select',currentValue:'agent',options:[{value:'agent',name:'Agent'}, ...(fs.existsSync(path.join(__dirname,'no-plan')) ? [] : [{value:'plan',name:'Plan'},{value:'ask',name:'Ask'}])]});
let sessionId = 'session-' + process.pid, pending, mode;
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const update = value => send({ method: 'session/update', params: { sessionId, update: value } });
readline.createInterface({ input: process.stdin }).on('line', line => {
  const value = JSON.parse(line); log(value);
  const reply = result => send({ id: value.id, result });
  if (value.method === 'initialize') reply({ protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: fs.existsSync(path.join(__dirname, 'no-list')) ? {} : { list: {} } }, authMethods: [{ id: 'cursor_login', name: 'Cursor Login' }] });
  else if (value.method === 'authenticate') reply({});
  else if (value.method === 'session/new') { if (!fs.existsSync(path.join(__dirname, 'hold-new'))) reply({ sessionId, configOptions }); }
  else if (value.method === 'session/set_config_option') { if (value.params.configId === 'mode' && fs.existsSync(path.join(__dirname,'no-mode-ack'))) { reply({configOptions:[]}); return; } if (value.params.configId === 'mode' && fs.existsSync(path.join(__dirname,'bad-mode-ack'))) { reply({configOptions:configOptions.map(option=>({...option,currentValue:option.id==='mode'?'agent':option.currentValue}))}); return; } reply({ configOptions: configOptions.map(option => ({ ...option, currentValue: option.id === value.params.configId ? value.params.value : option.currentValue })) }); }
  else if (value.method === 'session/list') reply({ sessions: [{ sessionId: 'saved-session', cwd: process.cwd() }, { sessionId: 'foreign-session', cwd: path.dirname(process.cwd()) }, ...Object.entries(history()).map(([sessionId, value]) => ({sessionId,cwd:value.cwd,title:'Saved conversation'}))] });
  else if (value.method === 'session/load') {
    sessionId = value.params.sessionId;
    if (fs.existsSync(path.join(__dirname, 'hold-load'))) return;
    const saved = history()[sessionId];
    if (saved) {
      for (const content of saved.prompt) {
        if (content.type === 'text') { const middle = Math.floor(content.text.length / 2); update({sessionUpdate:'user_message_chunk',content:{type:'text',text:content.text.slice(0,middle)}}); update({sessionUpdate:'user_message_chunk',content:{type:'text',text:content.text.slice(middle)}}); }
        else update({ sessionUpdate: 'user_message_chunk', content });
      }
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello Cursor' } });
      reply({ configOptions }); return;
    }
    update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Remember synthetic marker' } });
    update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Remembering' } });
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Remembered' } });
    update({ sessionUpdate: 'tool_call', toolCallId: 'replay-tool', title: 'Read synthetic.txt', kind: 'read', status: 'completed' });
    reply({ configOptions });
  }
  else if (value.method === 'session/prompt') {
    const saved = history(); saved[sessionId] = {cwd:process.cwd(),prompt:value.params.prompt}; fs.writeFileSync(historyFile,JSON.stringify(saved));
    pending = value.id; mode = value.params.prompt[0].text.split('\n')[0];
    // session_info_update: installed CLI live evidence; subagent kinds: installed-source evidence only.
    update({sessionUpdate:'session_info_update',title:'Synthetic conversation'});
    update({sessionUpdate:'subagent_spawned',agentId:'synthetic-child'});
    update({sessionUpdate:'subagent_state_update',agentId:'synthetic-child',state:'completed'});
    if (mode === 'team') { send({ id: pending, error: { code: -32000, message: 'Your team has switched. https://private.invalid/token' } }); return; }
    if (mode === 'team-stderr') { process.stderr.write('Your team has switched. https://private.invalid/token\n'); process.exit(1); }
    if (mode === 'policy') { send({ id: pending, error: { code: -32000, message: 'Headless ACP use is disabled by team policy' } }); return; }
    if (mode === 'policy-stderr') { process.stderr.write('Headless ACP use is disabled by team policy\n'); process.exit(1); }
    if (mode === 'protocol') { process.stdout.write('not-json\n'); return; }
    if (mode === 'invalid-completion') { reply({ stopReason: 'https://private.invalid/token' }); return; }
    if (mode === 'eof') { update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Partial' } }); process.stdout.end(); return; }
    if (mode === 'permission') {
      update({ sessionUpdate: 'tool_call', toolCallId: 'shell', title: 'Write synthetic file', kind: 'execute', status: 'pending' });
      send({ id: 1, method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId: 'shell', title: 'Write synthetic file', kind: 'execute', status: 'pending' }, options: [
        { optionId: 'allow-once', kind: 'allow_once' }, { optionId: 'allow-always', kind: 'allow_always' }, { optionId: 'reject-once', kind: 'reject_once' },
      ] } }); return;
    }
    // Documented Cursor extension schemas: synthetic behavior, not a captured native question/todo exchange.
    if (mode === 'question') {
      // Sanitized native session plan-entry shape from plans/cursor.md.
      update({sessionUpdate:'plan',entries:[{content:'Choose mode',priority:'medium',status:'in_progress'}]});
      send({method:'cursor/update_todos',params:{toolCallId:'todos',todos:[{id:'todo-1',content:'Choose mode',status:'in_progress'}],merge:false}});
      send({id:4,method:'cursor/ask_question',params:{toolCallId:'question-tool',title:'Configuration',questions:[
        {id:'mode',prompt:'Choose mode',options:[{id:'fast-id',label:'Fast'},{id:'safe-id',label:'Safe'}]},
        {id:'extras',prompt:'Choose extras',options:[{id:'one-id',label:'One'},{id:'two-id',label:'Two'}],allowMultiple:true}
      ]}}); return;
    }
    if (mode === 'extension') { send({ id: 2, method: 'cursor/create_plan', params: { toolCallId: 'plan', plan: '# Synthetic plan', todos: [] } }); return; }
    update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thinking' } });
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } });
    if (mode === 'wait' || mode === 'ignore-cancel') return;
    const wire = JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Cursor' } } } }) + '\n';
    process.stdout.write(wire.slice(0, 43));
    setImmediate(() => { process.stdout.write(wire.slice(43)); update({ sessionUpdate: 'tool_call', toolCallId: 'read', title: 'Read synthetic.txt', kind: 'read', status: 'in_progress' }); update({ sessionUpdate: 'tool_call_update', toolCallId: 'read', status: 'completed', rawOutput: 'synthetic contents' }); reply({ stopReason: 'end_turn' }); });
  } else if (value.method === 'session/cancel') {
    if (mode === 'ignore-cancel') return;
    send({ id: pending, result: { stopReason: 'cancelled' } });
    // Duplicate terminal responses and late chunks must not contaminate a later turn.
    send({ id: pending, result: { stopReason: 'end_turn' } });
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'LATE' } });
    send({ id: 3, method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId: 'late-tool' }, options: [{ optionId: 'allow-always', kind: 'allow_always' }] } });
  } else if (value.id === 1 && value.result) {
    if (value.result.outcome.optionId === 'allow-once' || value.result.outcome.optionId === 'allow-always') fs.writeFileSync(path.join(process.cwd(), 'should-not-exist'), 'unsafe');
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'shell', status: 'completed', rawOutput: { rejected: true } });
    send({ id: pending, result: { stopReason: 'end_turn' } });
  } else if (value.id === 4 && value.result) {
    send({method:'cursor/update_todos',params:{toolCallId:'todos',todos:[{id:'todo-1',content:'Choose mode',status:'completed'}],merge:true}});
    send({id:pending,result:{stopReason:'end_turn'}});
  } else if (value.id === 2 && value.result) send({ id: pending, result: { stopReason: 'end_turn' } });
});
