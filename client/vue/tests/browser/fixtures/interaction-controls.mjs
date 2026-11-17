export const interactionControlsSource = `
import {createApp,h,ref} from 'vue';
import ElementPlus,{ElButton,ElTabs,ElTabPane} from 'element-plus';
import {appMessageBox} from '/client/vue/src/shared/dialog/message-box.ts';
import 'element-plus/dist/index.css';
import '@korus-dev/agent-ui-sdk/styles.css';
import '/client/vue/src/styles/variables.css';
import '/client/vue/src/styles/base.css';
import '/client/vue/src/styles/theme.css';
import {i18n} from '/client/vue/src/i18n/index.ts';
import {appThemes} from '/client/vue/src/theme/themes.ts';
import {applyAppTheme} from '/client/vue/src/theme/apply-theme.ts';
import {createInitialSnapshot} from '@workspace/core/snapshot';
import AgentSidebar from '/client/vue/src/components/AgentSidebar.vue';
import {providerChoicesKey} from '/client/vue/src/components/provider-selection';
import TeamRail from '/client/vue/src/components/TeamRail.vue';
import AgentHeader from '/client/vue/src/components/AgentHeader.vue';
import RightWorkspacePanel from '/client/vue/src/components/RightWorkspacePanel.vue';
import ProviderInstallActions from '/client/vue/src/components/ProviderInstallActions.vue';
import SettingsSidebar from '/client/vue/src/components/SettingsSidebar.vue';
const agent=createInitialSnapshot().agents[0];
const previewDiff=['diff --git a/src/example.ts b/src/example.ts','--- a/src/example.ts','+++ b/src/example.ts','@@ -1 +1 @@','-before','+after'].join('\\n');
const gitStatus={folder:agent.folder,branch:'main',ahead:0,behind:0,changedFiles:2,addedLines:3,removedLines:3,hasUntracked:false,state:'dirty',updatedAt:''};
const repoAgent={...agent,workspace:{kind:'git',folder:'/src/repo',repositoryName:'repo',repositoryRoot:'/src/repo',branch:'main',isLinkedWorktree:false,primaryWorktreeRoot:'/src/repo',updatedAt:''}};
const quickAgent={...agent,id:'quick',name:'Quick chat',sessionKind:'quickChat',folder:'/src',workspace:undefined};
const activeTeam=ref('identity-blue');
const activity=ref(false);
const unread=ref(['quick']);
window.markedUnread=null;
window.selectedAgent=null;
window.showActivity=()=>{activity.value=true};
const identityTeams=[{id:'identity-blue',name:'Blue workspace',color:'#1B4FB2',agentIds:[]},{id:'identity-green',name:'Green workspace',color:'#46A857',agentIds:[]}];
window.themes=appThemes;
window.openDialog=async (method,destructive)=>{
 window.dialogResult=null;
 const options={confirmButtonType:destructive?'danger':'primary',confirmButtonClass:'fixture-confirm'};
 try { window.dialogResult=await (method==='alert'?appMessageBox.alert('A message',options):appMessageBox[method]('A message','Confirm',options)); }
 catch(action) {window.dialogResult=action;}
};
window.applyTheme=theme=>applyAppTheme({id:theme.id,mode:theme.appearance,uiFontSize:14,chatFontSize:15,codeFontSize:13});
window.applyTheme(appThemes.find(theme=>theme.id==='app-dark-blue'));
createApp({render:()=>h('main',{style:'width:1100px;height:800px;background:var(--color-shell-main)'},[
 h(AgentSidebar,{agents:activity.value?[repoAgent,quickAgent,{...repoAgent,id:'working',status:{type:'working'}},{...repoAgent,id:'waiting',status:{type:'awaitingInput'}}]:[repoAgent,quickAgent],unreadAgentIds:activity.value?unread.value:[],'onSet-agent-unread':input=>{window.markedUnread=input;unread.value=[...unread.value,input.agentId]},'onSelect-agent':id=>{window.selectedAgent=id},allTeams:activity.value,activeAgentId:repoAgent.id,teamName:'Workspace',style:'position:absolute;left:620px;top:300px;height:500px'}),
 h(TeamRail,{teams:identityTeams,activeTeamId:activeTeam.value,'onSelect-team':id=>activeTeam.value=id,style:'position:absolute;right:0;top:300px;height:300px'}),
 h(AgentHeader,{agent,gitStatus,gitReviewAvailable:true,gitWorkflowAvailable:true,workspaceOpen:true,isLoading:false,sidebarCollapsed:false,
 openInAvailable:true,openInCatalog:{defaultApplication:'vscode',applications:[{id:'vscode',label:'VS Code'}]}}),
 h('div',{class:'fixture-controls',style:'display:flex;gap:8px;margin:12px'},[
  ...['neutral','primary','destructive'].flatMap(variant=>[
   h('button',{class:'app-button agent-ui-interactive','data-test':'native-'+variant,'data-variant':variant,'data-appearance':variant==='neutral'?undefined:'solid'},variant),
   h(ElButton,{class:'agent-ui-interactive','data-test':'toolkit-'+variant,type:variant==='primary'?'primary':variant==='destructive'?'danger':undefined,'data-variant':variant,'data-appearance':variant==='neutral'?undefined:'solid'},()=>variant),
  ]),
  h(ElButton,{class:'agent-ui-interactive','data-test':'disabled',disabled:true},()=>'Disabled'),
 ]),
 h(ElTabs,{'data-agent-ui-scope':'',modelValue:'one',style:'width:300px'},()=>[
  h(ElTabPane,{name:'one',label:'First'}),h(ElTabPane,{name:'two',label:'Second'})
 ]),
 h(ProviderInstallActions,{provider:'codex',capabilities:{installation:{managed:false,instructionsUrl:'https://example.com'}}}),
 h('section',{style:'display:flex;height:500px'},[
  h(SettingsSidebar,{activeTab:'appearance'}),
  h(RightWorkspacePanel,{agent,tabs:['review','plan'],activeTab:'review',gitPanel:{kind:'gitDiff',title:'Changes',diff:previewDiff,state:'idle'},visible:true}),
 ])
])}).provide(providerChoicesKey,ref(['codex','claude'])).use(i18n).use(ElementPlus).mount('#app');
`;
