import type { Component } from 'vue';
import { IconArrowLeft, IconChecklist, IconCommand, IconDeviceMobile, IconKeyboard, IconSitemap, IconWorld } from '@tabler/icons-vue';
import { ArrowsMinimizeIcon, ArrowRightIcon, BacklogIcon, BoltIcon, ClockHour8Icon, CopyIcon, DashboardIcon, FileDiffIcon, FileTextIcon, FoldersIcon, GitForkIcon, ListDetailsIcon, MessageIcon, PencilIcon, PlusIcon, QuitIcon, RefreshIcon, SettingsIcon, SwitchHorizontalIcon, UserIcon, VolumeIcon, X } from './app-icons';

// Shared presentation for command results and their keyboard reference rows.
const icons: Record<string, Component> = {
  commands: IconCommand, help: IconKeyboard, palette: UserIcon, files: FileTextIcon,
  review: FileDiffIcon, browser: IconWorld, simulator: IconDeviceMobile, nextAgent: ArrowRightIcon, previousAgent: IconArrowLeft, nextTeam: SwitchHorizontalIcon,
  duplicate: CopyIcon, restart: RefreshIcon, closeAgent: X, edit: PencilIcon, compact: ArrowsMinimizeIcon,
  saveDraft: FileTextIcon, drafts: ListDetailsIcon, newTeam: PlusIcon, closeTeam: X, settings: SettingsIcon, quit: QuitIcon, mute: VolumeIcon,
  newAgent: PlusIcon, fork: GitForkIcon, resume: ClockHour8Icon, visualize: IconSitemap, plan: ListDetailsIcon,
  filesPane: FoldersIcon, codeReview: IconChecklist, cockpit: DashboardIcon, backlog: BacklogIcon, automations: ClockHour8Icon, quickChat: MessageIcon,
};
export function actionIcon(id: string): Component {
  return icons[id] ?? (/^agent\d$/.test(id) ? UserIcon : BoltIcon);
}
