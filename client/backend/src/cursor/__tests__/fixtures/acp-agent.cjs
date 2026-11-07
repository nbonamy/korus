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
let configOptions = [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'auto', options: [{ value: 'auto', name: 'Auto' }, { value: 'composer-2.5', name: 'Composer' }] }];
configOptions.push({id:'mode',name:'Mode',category:'mode',type:'select',currentValue:'agent',options:[{value:'agent',name:'Agent'}, ...(fs.existsSync(path.join(__dirname,'no-plan')) ? [] : [{value:'plan',name:'Plan'},{value:'ask',name:'Ask'}])]});
// Synthetic exact-native parameterized catalog shapes (IDs and distinct enum spellings are deliberate).
const select = (id,currentValue,values) => ({id,name:id,category:'thought_level',type:'select',currentValue,options:values.map(value=>({value,name:value}))});
const controlsFor = model => model==='fixture-alpha' ? [select('reasoning','low',['low','extra-high'])]
  : model==='fixture-beta' ? [select('reasoning_effort','medium',['medium','xhigh'])]
  : model==='fixture-dual' ? [select('thinking','false',['false','true']),select('effort','high',['low','high'])]
  : model==='fixture-thinking' ? [select('thinking','false',['false','true'])] : [];
const rich = fs.existsSync(path.join(__dirname,'rich-models'));
if(rich) { configOptions[0].options.push(...['fixture-alpha','fixture-beta','fixture-dual','fixture-thinking'].map(value=>({value,name:value}))); configOptions[0].currentValue='fixture-alpha'; configOptions.push(...controlsFor('fixture-alpha')); }
if(rich && fs.existsSync(path.join(__dirname,'missing-live-model-id'))) delete configOptions[0].id;
let sessionId = 'session-' + process.pid, pending, mode;
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const update = value => send({ method: 'session/update', params: { sessionId, update: value } });
// Diff/location shape from installed Cursor source; resource/image blocks are synthetic ACP content fixtures.
const richOutput = replay => {
  const toolCallId = replay ? 'replay-rich-edit' : 'rich-edit';
  update({sessionUpdate:'tool_call',toolCallId,title:'Edit note.txt',kind:'edit',status:'pending',rawInput:{path:'note.txt'},locations:[{path:'note.txt',line:2}]});
  const completed = {sessionUpdate:'tool_call_update',toolCallId,status:'completed',rawOutput:{native:'retained'},content:[
    {type:'diff',path:'note.txt',oldText:'before\nlast line',newText:'after\nlast line\n'},
    {type:'content',content:{type:'resource',resource:{uri:'file:///synthetic/context.txt',mimeType:'text/plain',text:'RESOURCE_MARKER'}}},
    {type:'content',content:{type:'image',mimeType:'image/png',data:'iVBORw0KGgo='}},
  ]};
  update(completed); update(completed);
  update({sessionUpdate:'tool_call_update',toolCallId,rawOutput:{native:'retained'}});
  const deleted = replay ? 'replay-delete' : 'delete';
  update({sessionUpdate:'tool_call',toolCallId:deleted,title:'Delete removed.txt',kind:'delete',status:'pending'});
  const deletion = {sessionUpdate:'tool_call_update',toolCallId:deleted,status:'completed',content:[{type:'diff',path:'removed.txt',oldText:'gone',newText:''}]};
  update(deletion); update(deletion);
  update({sessionUpdate:'tool_call',toolCallId:replay?'replay-add':'add',title:'Write added.txt',kind:'edit',status:'completed',content:[{type:'diff',path:'added.txt',oldText:null,newText:'created'}]});
  update({sessionUpdate:'agent_message_chunk',content:{type:'image',mimeType:'image/png',data:'iVBORw0KGgo='}});
  // Native MCP rawInput shape; partial completion updates omit the identity.
  update({sessionUpdate:'tool_call',toolCallId:replay?'replay-mcp':'live-mcp',title:'korus: send-message',kind:'other',status:'pending',rawInput:{providerIdentifier:'korus',toolName:'send-message',args:{to:'other-agent',message:'Hello'}}});
  update({sessionUpdate:'tool_call_update',toolCallId:replay?'replay-mcp':'live-mcp',kind:'other',status:'completed',rawOutput:{recipientName:'Other Agent'}});
  update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Rich output complete'}});
};
readline.createInterface({ input: process.stdin }).on('line', line => {
  const value = JSON.parse(line); log(value);
  const reply = result => send({ id: value.id, result });
  if (value.method === 'initialize') reply({ protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: fs.existsSync(path.join(__dirname, 'no-list')) ? {} : { list: {} } }, authMethods: [{ id: 'cursor_login', name: 'Cursor Login' }] });
  else if (value.method === 'authenticate') reply({});
  else if (value.method === 'cursor/list_available_models') {
    if(fs.existsSync(path.join(__dirname,'hold-model-catalog'))) return;
    if(fs.existsSync(path.join(__dirname,'catalog-error.json'))) {send({id:value.id,error:JSON.parse(fs.readFileSync(path.join(__dirname,'catalog-error.json'),'utf8'))});return;}
    if(fs.existsSync(path.join(__dirname,'catalog-result.json'))) {reply(JSON.parse(fs.readFileSync(path.join(__dirname,'catalog-result.json'),'utf8')));return;}
    reply({models:configOptions[0].options.map(option=>({...option,configOptions:controlsFor(option.value)}))});
  }
  else if (value.method === 'session/new') { if (!fs.existsSync(path.join(__dirname, 'hold-new'))) reply({ sessionId, configOptions }); }
  else if (value.method === 'session/set_config_option') {
    if (value.params.configId === 'model' && fs.existsSync(path.join(__dirname,'model-ack.json'))) { reply(JSON.parse(fs.readFileSync(path.join(__dirname,'model-ack.json'),'utf8'))); return; }
    if (value.params.configId === 'mode' && fs.existsSync(path.join(__dirname,'mode-selection-ack.json'))) {reply(JSON.parse(fs.readFileSync(path.join(__dirname,'mode-selection-ack.json'),'utf8')));return;}
    if (value.params.configId === 'mode' && fs.existsSync(path.join(__dirname,'no-mode-ack'))) { reply({configOptions:[]}); return; }
    if (value.params.configId === 'mode' && fs.existsSync(path.join(__dirname,'bad-mode-ack'))) { reply({configOptions:configOptions.map(option=>({...option,currentValue:option.id==='mode'?'agent':option.currentValue}))}); return; }
    if(!['model','mode'].includes(value.params.configId) && fs.existsSync(path.join(__dirname,'effort-ack.json'))) {reply(JSON.parse(fs.readFileSync(path.join(__dirname,'effort-ack.json'),'utf8')));return;}
    if(rich) {
      if(value.params.configId==='model') configOptions=[...configOptions.filter(option=>option.category!=='thought_level'),...controlsFor(value.params.value)];
      if(!['model','mode'].includes(value.params.configId) && fs.existsSync(path.join(__dirname,'effort-resets-mode'))) configOptions=configOptions.map(option=>option.id==='mode'?{...option,currentValue:'agent'}:option);
      configOptions=configOptions.map(option=>({...option,currentValue:option.id===value.params.configId?value.params.value:option.currentValue})); reply({configOptions});return;
    }
    // Persist complete acknowledgments; model changes deliberately report Agent mode for the cache regression.
    if(value.params.configId==='model') configOptions=configOptions.map(option=>option.id==='mode'?{...option,currentValue:'agent'}:option);
    configOptions=configOptions.map(option => ({ ...option, currentValue: option.id === value.params.configId ? value.params.value : option.currentValue }));
    reply({configOptions});
  }
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
      if (saved.prompt[0].text.split('\n')[0] === 'rich-output') { richOutput(true); reply({configOptions}); return; }
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
    log({fixture:'prompt-admission',model:configOptions[0].currentValue,thoughts:Object.fromEntries(configOptions.filter(option=>option.category==='thought_level').map(option=>[option.id,option.currentValue]))});
    // External/native preference change: the app must preserve this on a later same-model null selection.
    if(configOptions[0].currentValue==='fixture-dual' && fs.existsSync(path.join(__dirname,'native-thinking-change'))) {configOptions=configOptions.map(option=>option.id==='thinking'?{...option,currentValue:'true'}:option);update({sessionUpdate:'config_option_update',configOptions});}
    const saved = history(); saved[sessionId] = {cwd:process.cwd(),prompt:value.params.prompt}; fs.writeFileSync(historyFile,JSON.stringify(saved));
    pending = value.id; mode = value.params.prompt[0].text.split('\n')[0];
    // session_info_update: installed CLI live evidence; subagent kinds: installed-source evidence only.
    update({sessionUpdate:'session_info_update',title:'Synthetic conversation'});
    update({sessionUpdate:'subagent_spawned',agentId:'synthetic-child'});
    update({sessionUpdate:'subagent_state_update',agentId:'synthetic-child',state:'completed'});
    if (mode === 'rich-output') { richOutput(false); reply({stopReason:'end_turn'}); return; }
    // Source-backed generate_image request shape; notification variant is compatibility coverage.
    if (mode === 'image-observation') {
      const config = JSON.parse(fs.readFileSync(path.join(__dirname,'image-event.json'),'utf8'));
      update({sessionUpdate:'tool_call',toolCallId:'native-image',title:'Generate image',kind:'other',status:'failed',rawOutput:{native:'unchanged'}});
      const params = {toolCallId:'native-image',description:'Suggested generation',filePath:config.filePath};
      if (!config.notification) send({id:5,method:'cursor/generate_image',params});
      send({method:'cursor/generate_image',params});
      reply({stopReason:'end_turn'}); return;
    }
    if (mode === 'team') { send({ id: pending, error: { code: -32000, message: 'Your team has switched. https://private.invalid/token' } }); return; }
    if (mode === 'team-stderr') { process.stderr.write('Your team has switched. https://private.invalid/token\n'); process.exit(1); }
    if (mode === 'policy') { send({ id: pending, error: { code: -32000, message: 'Headless ACP use is disabled by team policy' } }); return; }
    if (mode === 'policy-stderr') { process.stderr.write('Headless ACP use is disabled by team policy\n'); process.exit(1); }
    if (mode === 'protocol') { process.stdout.write('not-json\n'); return; }
    if (mode === 'invalid-completion') { reply({ stopReason: 'https://private.invalid/token' }); return; }
    if (mode === 'eof') { update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Partial' } }); process.stdout.end(); return; }
    // Native MCP tool updates carry identity; permission requests omit rawInput (2026.11.05 source).
    if (mode === 'mcp-permission') {
      const config = JSON.parse(fs.readFileSync(path.join(__dirname,'mcp-permission.json'),'utf8'));
      if (!config.omitObservation) update({sessionUpdate:'tool_call',toolCallId:'mcp-call',kind:config.kind??'other',title:'korus: set-status',status:'pending',rawInput:config.input??{providerIdentifier:'korus',toolName:'set-status',args:{status:'Fixture'}}});
      send({id:8,method:'session/request_permission',params:{sessionId,toolCall:{toolCallId:'mcp-call',kind:config.kind??'other',title:'korus: set-status',status:'pending',...(config.requestInput?{rawInput:config.requestInput}:{})},options:[
        ...(!config.noOnce?[{optionId:'native-mcp-once',kind:'allow_once'}]:[]),{optionId:'native-mcp-always',kind:'allow_always'},{optionId:'native-mcp-reject',kind:'reject_once'}
      ]}});return;
    }
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
      // Installed 2026.11.05-86047df sendNonBlockingExtensionNotification uses extMethod (a request).
      send({id:6,method:'cursor/update_todos',params:{toolCallId:'todos',todos:[{id:'todo-1',content:'Choose mode',status:'in_progress'}],merge:false}});
      send({id:7,method:'cursor/update_todos',params:{sessionId:'foreign-session',toolCallId:'todos',todos:[{id:'foreign',content:'Wrong conversation',status:'pending'}],merge:false}});
      send({method:'cursor/update_todos',params:{sessionId:'foreign-session',toolCallId:'todos',todos:[{id:'foreign',content:'Wrong conversation',status:'pending'}],merge:false}});
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
  } else if (value.id === 8 && value.result) {
    update({sessionUpdate:'tool_call_update',toolCallId:'mcp-call',status:'completed',rawOutput:{approved:value.result.outcome.optionId==='native-mcp-once'}});
    send({id:pending,result:{stopReason:'end_turn'}});
  } else if (value.id === 4 && value.result) {
    send({method:'cursor/update_todos',params:{toolCallId:'todos',todos:[{id:'todo-1',content:'Choose mode',status:'completed'}],merge:true}});
    send({id:pending,result:{stopReason:'end_turn'}});
  } else if (value.id === 2 && value.result) send({ id: pending, result: { stopReason: 'end_turn' } });
});
