import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';

test('Mission documents use a request drawer and centered viewer without replacing the workspace', async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const require = createRequire(new URL('../package.json', import.meta.url));
  const artifacts = process.env.MISSION_DOCUMENT_ARTIFACTS ?? path.join(root, '.app-dev/mission-documents');
  const server = await createServer({ configFile:false, root, cacheDir:path.join(artifacts,'vite-cache'), server:{host:'127.0.0.1',port:0,watch:null},
    resolve:{alias:{'@workspace/core':path.join(root,'core/src'),'@codex-app-sdk/vue/styles.css':require.resolve('@codex-app-sdk/vue/styles.css')},dedupe:['vue']},
    plugins:[vue(), {
      name:'mission-documents-fixture',
      configureServer(server) {
        server.middlewares.use('/mission-documents', (_req,res) => {
          res.setHeader('Content-Type','text/html');
          res.end('<!doctype html><html><head><style>html,body,#app{height:100%;margin:0}#app{display:flex;flex-direction:column}</style></head><body><div id="app"></div><script type="module" src="/mission-documents-fixture.js"></script></body></html>');
        });
      },
      resolveId(id) { if (id === '/mission-documents-fixture.js') return '\0mission-documents-fixture'; },
      load(id) {
        if (id !== '\0mission-documents-fixture') return;
        return `
          import {createApp,h,Fragment,ref,reactive} from 'vue';
          import ElementPlus from 'element-plus';
          import {createCodexConversationPaneController} from '@codex-app-sdk/vue';
          import 'element-plus/dist/index.css';
          import '@codex-app-sdk/vue/styles.css';
          import '/vue/src/styles/variables.css';
          import '/vue/src/styles/theme.css';
          import '/vue/src/styles/base.css';
          import {i18n} from '/vue/src/i18n/index.ts';
          import {createInitialSnapshot} from '/core/src/snapshot-construction.ts';
          import {createMission} from '/core/src/missions.ts';
          import {applyMissionDebugFixture} from '/backend/src/mission-debug-fixtures.ts';
          import {codexTextMessage} from '/vue/src/test/codex-conversation-fixtures.ts';
          import MissionWorkspace from '/vue/src/components/MissionWorkspace.vue';
          import ConversationPane from '/vue/src/components/ConversationPane.vue';
          import WorkspacePreviewHost from '/vue/src/components/WorkspacePreviewHost.vue';
          import RightWorkspacePanel from '/vue/src/components/RightWorkspacePanel.vue';
          import MissionDocumentRequest from '/vue/src/components/MissionDocumentRequest.vue';
          import {useMissionDocuments} from '/vue/src/components/use-mission-documents.ts';
          const snapshot = createInitialSnapshot();
          const mission = createMission(snapshot,{outcome:'Review the workspace improvements',workflowType:'shapeAndShipFeature',teamId:snapshot.teams[0].id,orchestratorMemberId:snapshot.agents[0].id});
          applyMissionDebugFixture(snapshot,mission.id,'implementation');
          createApp({setup() {
            const activeAgentId = ref(snapshot.agents[0].id);
            const preview = reactive({open:false,agentId:snapshot.agents[0].id,tabs:[],activeTab:null,panels:{}});
            function openDocument(request) {
              const tab = 'file:'+ (request.path ?? request.title);
              preview.agentId = request.agentId;
              preview.panels[tab] = {kind:request.path?.endsWith('.json')?'source':'markdown',language:'json',title:request.title,content:request.content,state:'idle',error:null};
              if (!preview.tabs.includes(tab)) preview.tabs.push(tab);
              preview.activeTab = tab; preview.open = true;
            }
            function openFile(path) {
              openDocument({agentId:activeAgentId.value,path,title:path.split('/').at(-1),content:path.endsWith('.json')?'{"commit":"8116155c"}':'# Linked document\\n\\nOpened from the conversation.'});
            }
            const documents = useMissionDocuments({missions:()=>[mission],agents:()=>snapshot.agents,activeMissionId:()=>mission.id,currentAgentId:()=>activeAgentId.value,open:openDocument});
            window.requestDocument = (title,content) => documents.request({kind:'markdown',agentId:snapshot.agents[1].id,title,content});
            const controller = createCodexConversationPaneController({state:()=>({identity:{conversationKey:activeAgentId.value,messages:[codexTextMessage('links','assistant','Open [the document](notes.md) or [Evidence](/tmp/telemetry-merge3-evidence.json).')]}}),actions:{openLink:link=>openFile(link.path)}});
            return () => h(Fragment,[
              h(MissionWorkspace,{mission,agents:snapshot.agents,onOpenConversation:id=>activeAgentId.value=id},{conversation:({agentId})=>h(ConversationPane,{controller,agent:snapshot.agents.find(agent=>agent.id===agentId),agents:snapshot.agents},{'composer-drawers':()=>documents.pending.value?h(MissionDocumentRequest,{request:documents.pending.value,onOpen:documents.confirm,onDismiss:documents.dismiss}):null})}),
              h(WorkspacePreviewHost,{dialog:true,open:preview.open,title:preview.panels[preview.activeTab]?.title,onClose:()=>preview.open=false},{default:()=>h(RightWorkspacePanel,{agent:snapshot.agents.find(agent=>agent.id===preview.agentId),agents:snapshot.agents,contentOnly:true,activeTab:preview.activeTab,tabs:preview.tabs,filePanels:preview.panels,visible:preview.open,gitPanel:{kind:'gitDiff',title:'Changes',diff:'',state:'idle',error:null},style:'flex:1;min-width:0',onSelectTab:tab=>preview.activeTab=tab})}),
            ]);
          }}).use(ElementPlus).use(i18n).mount('#app');
        `;
      },
    }],
  });
  let browser;
  try {
    await mkdir(artifacts,{recursive:true});
    await server.listen(); browser = await chromium.launch();
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[]; page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(`${server.resolvedUrls.local[0]}mission-documents`);
    const board = page.locator('.mission-workspace__workbench');
    await board.waitFor();
    const initial = await board.boundingBox();
    await page.evaluate(()=>{window.requestDocument('Older document','# Older');window.requestDocument('Latest document','# Latest\n\nReview the changes before implementation.'+'\n\nReading a long document must keep the dialog inside the viewport.'.repeat(120));});
    const drawer = page.locator('.mission-document-request');
    await drawer.waitFor();
    assert.match(await drawer.innerText(),/wants to open Latest document/);
    assert.doesNotMatch(await drawer.innerText(),/Older document/);
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.deepEqual(await board.boundingBox(),initial,'request does not change the Mission layout');
    await page.screenshot({path:path.join(artifacts,'request-light.png'),animations:'disabled'});
    await page.getByRole('button',{name:'Open document',exact:true}).click();
    const dialog = page.getByRole('dialog',{name:'Latest document',exact:true});
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('tablist').count(),0,'viewer has no tabs');
    await page.evaluate(()=>window.requestDocument('Next document','# Next'));
    assert.match(await dialog.innerText(),/Review the changes/);
    assert.doesNotMatch(await dialog.innerText(),/# Next/);
    const measurements=[];
    for (const width of [1440,1100]) {
      await page.setViewportSize({width,height:900});
      for (const dark of [false,true]) {
        await page.emulateMedia({colorScheme:dark?'dark':'light'});
        await page.evaluate(dark=>{
          document.documentElement.classList.toggle('dark',dark);
          document.documentElement.dataset.codexTheme = dark ? 'dark' : 'light';
        },dark);
        await page.screenshot({path:path.join(artifacts,`${width}-${dark?'dark':'light'}.png`),animations:'disabled'});
        const bounds=await dialog.boundingBox();
        assert.ok(Math.abs(bounds.x+bounds.width/2-width/2)<=1,'document dialog is horizontally centered');
        assert.ok(bounds.y>=0 && bounds.y+bounds.height<=900,'document fits the viewport');
        const scroll = await dialog.locator('.markdown-panel__document').evaluate(el=>{
          el.scrollTop = 100;
          return {height:el.clientHeight,content:el.scrollHeight,top:el.scrollTop};
        });
        assert.ok(scroll.content>scroll.height,'long documents scroll within the viewer');
        assert.ok(scroll.top>0,'the viewer scrolls without moving the dialog');
        measurements.push({width,dark,bounds});
      }
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden'});
    assert.match(await drawer.innerText(),/Next document/);
    await page.getByRole('button',{name:'Dismiss document request',exact:true}).click();
    await drawer.waitFor({state:'hidden'});
    await page.locator('.mission-conversation-rail a[href="notes.md"]').click();
    const linked = page.getByRole('dialog',{name:'notes.md',exact:true});
    await linked.waitFor();
    assert.match(await linked.innerText(),/Opened from the conversation/);
    assert.equal(await linked.locator('.markdown-panel, .source-preview-panel').count(),1,'only the current document is rendered');
    await page.getByRole('button',{name:'Close document',exact:true}).click();
    await linked.waitFor({state:'hidden'});
    await page.locator('.mission-conversation-rail a[href="/tmp/telemetry-merge3-evidence.json"]').click();
    const evidence = page.getByRole('dialog',{name:'telemetry-merge3-evidence.json',exact:true});
    await evidence.waitFor();
    assert.match(await evidence.locator('.source-preview-panel').innerText(),/8116155c/);
    assert.equal(await evidence.locator('[data-code-annotation-trigger]').count(),0,'document previews are read-only');
    assert.equal(await evidence.getByRole('tablist').count(),0);
    await page.screenshot({path:path.join(artifacts,'evidence-json.png'),animations:'disabled'});
    await page.getByRole('button',{name:'Close document',exact:true}).click();
    await evidence.waitFor({state:'hidden'});
    assert.equal(await board.isVisible(),true);
    assert.equal(await page.locator('.mission-stage-rail').isVisible(),true);
    assert.deepEqual(errors,[]);
    await writeFile(path.join(artifacts,'measurements.json'),JSON.stringify(measurements,null,2));
  } finally { await browser?.close(); await server.close(); }
});
