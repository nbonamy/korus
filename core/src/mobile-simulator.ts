/** Local emulators only. Coordinates always refer to the returned screenshot pixels. */
export type MobileDevice = {
  id: string;
  platform: 'ios' | 'android';
  name: string;
  state: 'booted' | 'shutdown';
  owner?: string;
};
export type MobileAttachment = { id: string; device: MobileDevice };
/** Desktop pane transport. Video never enters provider transcripts or app snapshots. */
export type MobileViewRequest =
  | { action: 'start'; attachmentId: string }
  | { action: 'frame' | 'stop'; attachmentId: string; viewId: string }
  | { action: 'touch'; attachmentId: string; viewId: string; phase: 'down' | 'move' | 'up'; x: number; y: number; geometry: number };
export type MobileViewResult = {
  viewId: string;
  /** Normal teardown, not a stream failure. The pane must stop requesting frames. */
  ended?: true;
  /** Native video image; coordinates use the full framebuffer, independent of encoding scale. */
  frame?: {
    data: Uint8Array;
    mimeType: 'image/jpeg' | 'image/png';
    width: number;
    height: number;
    geometry: number;
    /** Clockwise quarter turns that show the framebuffer upright (iOS keeps a portrait framebuffer when rotated). */
    rotation?: 0 | 1 | 2 | 3;
  };
};
export type MobileFrame = {
  attachmentId: string;
  data: string;
  mimeType: 'image/png';
  /** Screenshot pixels per device point (Android input uses pixels). */
  scale: number;
  width: number;
  height: number;
};
export type MobileCatalog = {
  devices: MobileDevice[];
  setup: { platform: 'ios' | 'android'; message: string; url: string }[];
};
export type MobileAction =
  | { action: 'tap'; x: number; y: number; width: number; height: number }
  | {
      action: 'swipe';
      x: number;
      y: number;
      toX: number;
      toY: number;
      width: number;
      height: number;
      durationMs: number;
    }
  | { action: 'text'; text: string }
  | { action: 'button'; button: 'home' | 'back' | 'enter' | 'backspace' | 'volumeUp' | 'volumeDown' | 'power' }
  | { action: 'launch'; appId: string };
export type MobileRequest =
  | { action: 'list' }
  | { action: 'status' }
  | { action: 'attach'; deviceId: string }
  | { action: 'detach'; attachmentId: string }
  | { action: 'screenshot'; attachmentId: string }
  | { action: 'inspect'; attachmentId: string }
  /** Rotation is pane-only; the agent tool never exposes it. */
  | { action: 'rotate'; attachmentId: string }
  | { action: 'shutdown'; attachmentId: string }
  | (MobileAction & { attachmentId: string });
export type MobileResult = {
  catalog?: MobileCatalog;
  attachment: MobileAttachment | null;
  frame?: MobileFrame;
  inspection?: { kind: 'accessibility' | 'screenshot'; text: string };
};
