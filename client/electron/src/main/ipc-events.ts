import type { AppCommand, MainToRendererEvent } from '@workspace/core/contracts';
import { ipcChannels, type AppIpcEvents } from '@workspace/core/ipc';
import { sendIpcEvent, type IpcEventSender } from '@codex-app-sdk/electron';

export function sendRendererEvent(sender: IpcEventSender, event: MainToRendererEvent): void {
  sendIpcEvent<AppIpcEvents, typeof ipcChannels.event>(sender, ipcChannels.event, event);
}

export function sendAppCommand(sender: IpcEventSender, command: AppCommand): void {
  sendIpcEvent<AppIpcEvents, typeof ipcChannels.appCommand>(sender, ipcChannels.appCommand, command);
}
