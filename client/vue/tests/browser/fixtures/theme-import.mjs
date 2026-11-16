export const themeImportSource = `
import {createApp,h,reactive,ref,watchEffect} from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import {ConversationPane} from '@korus-dev/agent-ui-sdk';
import '@korus-dev/agent-ui-sdk/styles.css';
import '/client/vue/src/styles/variables.css';
import '/client/vue/src/styles/base.css';
import '/client/vue/src/styles/theme.css';
import {defaultThemeSettings,normalizeThemeSettings} from '@workspace/core/settings';
import {createInitialSnapshot} from '@workspace/core/snapshot';
import {applyAppTheme} from '/client/vue/src/theme/apply-theme.ts';
import {i18n} from '/client/vue/src/i18n/index.ts';
import SettingsAppearancePanel from '/client/vue/src/components/SettingsAppearancePanel.vue';
import SettingsMenu from '/client/vue/src/components/SettingsMenu.vue';
import AgentMoreMenu from '/client/vue/src/components/AgentMoreMenu.vue';
import AgentSidebar from '/client/vue/src/components/AgentSidebar.vue';
import ThreadFlagAffordance from '/client/vue/src/components/ThreadFlagAffordance.vue';
const settings=reactive(normalizeThemeSettings(JSON.parse(localStorage.getItem('theme')||'null')||defaultThemeSettings));
const appearance=ref(true);
const snapshot=createInitialSnapshot();
document.documentElement.dataset.platform='macos';
watchEffect(()=>applyAppTheme(settings));
createApp({render:()=>h('div',{class:'app-shell',style:'display:flex;height:100vh;background:var(--color-shell-main)'},[
 h(AgentSidebar,{agents:snapshot.agents,activeAgentId:snapshot.agents[0].id,teamName:'Skin preview'}),
 h('main',{class:'app-shell__content',style:'flex:1;min-width:0;display:flex;flex-direction:column'},[
  h('header',{class:'agent-header',style:'height:48px;padding:12px;flex:none'},[
   h(SettingsMenu),
   h(AgentMoreMenu,{agentId:snapshot.agents[0].id,shareAvailable:true}),
   h('button',{class:'app-button',onClick:()=>appearance.value=!appearance.value},appearance.value?'Back to chat':'Appearance')
  ]),
  appearance.value?h(SettingsAppearancePanel,{settings,updateSettings:async input=>{
   input=structuredClone(input); // Same payload constraint as Electron IPC.
   Object.assign(settings,normalizeThemeSettings({...settings,...input.theme}));
   localStorage.setItem('theme',JSON.stringify(settings));
  }}):h(ConversationPane,{messages:[
   {id:'u1',role:'user',content:'Can you add a pricing page with three plans?'},
   {id:'a1',role:'assistant',content:'The pricing page is ready, with three plans side by side.\\n\\n- **Free:** one project and community support.\\n- **Pro:** unlimited projects and private skins.\\n- **Team:** shared skins and roles.'},
   {id:'u2',role:'user',content:'Make the cards stack on phones.'},
   {id:'a2',role:'assistant',content:'Done. Below 640px the cards stack, and the highlighted plan moves to the top.\\n\\n**On your phone:** the page is ready to preview.\\n\\nTablets keep two columns.'},
   {id:'u3',role:'user',content:'Start the dev server.'},
   {id:'a3',role:'assistant',content:'The server is running. I checked the home page and pricing page: both load.'},
   {id:'tool',role:'assistant',content:'',parts:[{type:'tool',toolCall:{id:'read',function:'read_file',args:{path:'/workspace/plan.ts'},done:true,state:'completed',result:'Ready',status:JSON.stringify({source:'command',action:'read',phase:'completed',params:{target:'plan.ts'}})}}]}
  ],style:'flex:1;min-height:0'},{'composer-shelf-actions':()=>h(ThreadFlagAffordance,{id:'work_proposed'})})
 ])
])}).use(ElementPlus).use(i18n).mount('#app');
`;
