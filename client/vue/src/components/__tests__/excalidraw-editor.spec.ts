import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Visualization } from '@workspace/core/visualize';
const root = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: () => root }));
const convert = vi.hoisted(() => vi.fn());
vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: () => null,
  MainMenu: () => null,
  CaptureUpdateAction: {},
  FONT_FAMILY: { Nunito: 6, Cascadia: 3 },
  convertToExcalidrawElements: vi.fn(),
  exportToCanvas: vi.fn(),
  restoreElements: vi.fn(elements => structuredClone(elements)),
  bumpVersion: vi.fn(element => ({ ...element, version: element.version + 1 })),
  sceneCoordsToViewportCoords: vi.fn(({ sceneX, sceneY }, state) => ({
    x: (sceneX + state.scrollX) * state.zoom.value + state.offsetLeft,
    y: (sceneY + state.scrollY) * state.zoom.value + state.offsetTop,
  })),
}));
vi.mock('@excalidraw/mermaid-to-excalidraw', () => ({ parseMermaidToExcalidraw: convert }));
import { convertToExcalidrawElements, restoreElements, exportToCanvas } from '@excalidraw/excalidraw';
import { isCanvasDocument } from '@workspace/core/visualize-canvas';
import { importVisualization, mountCanvas } from '../excalidraw-editor';
const base: Visualization = { id: 'v', title: 'Diagram', content: { kind: 'mermaid', source: '' }, createdAt: '', updatedAt: '' };
describe('canvas imports', () => {
  it('opens legacy diagram text with portable native fonts without mutating the saved scene', async () => {
    const elements = [{id:'name',type:'text',x:0,y:0,width:150,height:24,text:'Vue UI',fontFamily:4},
      {id:'edge',type:'text',x:160,y:0,width:150,height:20,text:'prompts',fontFamily:10}];
    const canvas = {elements,files:{},selectedElementIds:[],preview:'',revision:1};
    const scene = await importVisualization({...base,canvas}, '');
    expect(scene.elements.map(element=>element.fontFamily)).toEqual([6,3]);
    expect(canvas.elements.map(element=>element.fontFamily)).toEqual([4,10]);
    const imported = await importVisualization({...base,content:{kind:'excalidraw',source:JSON.stringify(canvas)}}, '');
    expect(imported.elements.map(element=>element.fontFamily)).toEqual([6,3]);
  });
  it('renders app-owned native colors without Excalidraw inverting the palette in dark mode', () => {
    const fonts = Object.assign(new EventTarget(), { ready: Promise.resolve() });
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', vi.fn());
    document.documentElement.classList.add('dark');
    const editor = mountCanvas(document.createElement('div'), { elements: [], files: {}, selectedElementIds: [], preview: '' }, vi.fn(), vi.fn(), vi.fn(), { nativeColors: true });
    try { expect(root.render.mock.calls.at(-1)![0].props.children.props.initialData.appState).toMatchObject({ theme: 'light', viewBackgroundColor: 'transparent' }); }
    finally { editor.dispose(); document.documentElement.classList.remove('dark'); }
  });
  it('imports converter image files as persistable canvas documents', async () => {
    const image = { id: 'image', type: 'image', x: 0, y: 0, width: 120, height: 60, fileId: 'asset' };
    convert.mockResolvedValueOnce({ elements: [image], files: { asset: { id: 'asset', mimeType: 'image/svg+xml', dataURL: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 1200 600"><text>Fallback diagram</text></svg>') } } });
    vi.mocked(convertToExcalidrawElements).mockReturnValueOnce([image] as never);
    vi.stubGlobal('Image', class {
      naturalWidth = 120; naturalHeight = 60;
      set src(value: string) {
        const svg = new DOMParser().parseFromString(decodeURIComponent(value.slice(value.indexOf(',') + 1)), 'image/svg+xml').documentElement;
        this.naturalWidth = Number(svg.getAttribute('width'));
        this.naturalHeight = Number(svg.getAttribute('height'));
      }
      async decode() {}
    });
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
    const dataUrl = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,YQ==');
    try {
      const scene = await importVisualization({ ...base, content: { kind: 'mermaid', source: 'flowchart LR; A --> B' } }, '');
      expect(context.mock.contexts[0]).toMatchObject({ width: 1200, height: 600 });
      expect(isCanvasDocument({ ...scene, revision: 1 })).toBe(true);
      expect(scene.files.asset.mimeType).toBe('image/png');
    } finally { context.mockRestore(); dataUrl.mockRestore(); }
  });
  it.each(['flowchart LR; A@{img: "https://example.com/a.png"}', 'flowchart LR; click A "https://example.com"', '%%{init: {securityLevel: "loose"}}%%\nflowchart LR; A-->B'])('rejects active content before Mermaid creates DOM: %s', async source => {
    await expect(importVisualization({ ...base, content: { kind: 'mermaid', source } }, '')).rejects.toThrow('does not allow');
    expect(convert).not.toHaveBeenCalled();
  });
  it('loads a native Excalidraw scene directly as the editable canvas', async () => {
    const elements = [{ id: 'box', type: 'rectangle', x: 5, y: 6, width: 100, height: 40 }];
    vi.mocked(restoreElements).mockClear();
    const source = JSON.stringify({ elements, files: { img: { id: 'img', mimeType: 'image/png', dataURL: 'data:image/png;base64,YQ==', created: 1 } } });
    const scene = await importVisualization({ ...base, content: { kind: 'excalidraw', source } }, '');
    expect(scene).toStrictEqual({ elements, files: { img: { id: 'img', mimeType: 'image/png', dataURL: 'data:image/png;base64,YQ==', created: 1 } }, selectedElementIds: [], preview: '' });
    expect(isCanvasDocument({ ...scene, revision: 1 })).toBe(true);
    expect(convert).not.toHaveBeenCalled();
  });
  it.each([false,true])('loads self-contained icon bytes from diagram data after a restart (saved=%s)', async saved => {
    const iconImage={mimeType:'image/svg+xml' as const,base64:btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24"><path fill="#fff" d="M0 0h48v24H0z"/></svg>'),source:'svgl' as const,sourceUrl:'https://svgl.app/library/example.svg',whiteFill:true};
    const elements=[{id:'brand',type:'image',x:10,y:20,width:80,height:40,customData:{iconImage}}];
    const native={elements,files:{},selectedElementIds:[],preview:''};
    vi.stubGlobal('Image',class {naturalWidth=48;naturalHeight=24;src='';async decode(){}});
    const paint={drawImage:vi.fn(),fillRect:vi.fn(),fillStyle:''};
    const context=vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(paint as never);
    const data=vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/png;base64,YQ==');
    try {
      const persisted=JSON.parse(JSON.stringify({...base,content:{kind:'excalidraw',source:JSON.stringify(native)},...(saved?{canvas:{...native,revision:2}}:{})}));
      const scene=await importVisualization(persisted,'');
      expect(Object.values(scene.files)).toEqual([expect.objectContaining({mimeType:'image/png',dataURL:'data:image/png;base64,YQ=='})]);
      expect(scene.elements[0]).toMatchObject({id:'brand',x:10,y:20,width:80,height:40});
      expect(scene.files[scene.elements[0].fileId as string]).toBeDefined();
      expect(scene.elements[0].customData).not.toHaveProperty('iconImage');
      expect(paint.fillStyle).toBe('#20242d');
      expect(paint.drawImage).toHaveBeenCalledOnce();
      expect(isCanvasDocument({...scene,revision:1})).toBe(true);
    } finally {context.mockRestore();data.mockRestore();}
  });
  it('restores an authoritative canvas without reparsing its original source', async () => {
    const canvas = { revision: 3, elements: [{ id: 'user', type: 'rectangle', x: 77, y: 31, width: 20, height: 20 }], files: {}, selectedElementIds: [], preview: '' };
    expect(await importVisualization({ ...base, canvas }, '')).toEqual(canvas);
    expect(convert).not.toHaveBeenCalled();
  });
});

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts); else Reflect.deleteProperty(document, 'fonts'); });
describe('canvas font loading', () => {
  it('remeasures the current scene after fonts load, enables binding repair and cleans up its listener', async () => {
    const fonts = new EventTarget();
    Object.assign(fonts, { ready: Promise.resolve(fonts) });
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const host = document.createElement('div');
    const initial = { elements: [], files: {}, selectedElementIds: [], preview: '' };
    const editor = mountCanvas(host, initial, vi.fn(), vi.fn());
    const current = [{ id: 'box', type: 'rectangle', x: 20, y: 30, width: 260, height: 90, version: 2 }, { id: 'user-label', type: 'text', containerId: 'box', text: 'User edited label', originalText: 'User edited label', textAlign: 'center', verticalAlign: 'middle', x: 70, y: 90, width: 100, height: 25, version: 4 }];
    const api = { getSceneElements: () => current, updateScene: vi.fn(), scrollToContent: vi.fn(), onScrollChange: vi.fn(() => vi.fn()) };
    root.render.mock.calls.at(-1)![0].props.children.props.excalidrawAPI(api);
    await Promise.resolve();
    frames.splice(0).forEach(callback => callback(0));
    vi.mocked(restoreElements).mockClear();
    vi.mocked(restoreElements).mockImplementationOnce(elements => (elements ?? []).map(element => element.type === 'text' ? { ...element, width: 160, height: 50 } : element) as ReturnType<typeof restoreElements>);
    fonts.dispatchEvent(new Event('loadingdone'));
    frames.splice(0).forEach(callback => callback(0));
    expect(restoreElements).toHaveBeenCalledWith(current, null, { repairBindings: true, refreshDimensions: true });
    expect(api.updateScene.mock.calls.at(-1)![0].elements[1]).toMatchObject({ id: 'user-label', text: 'User edited label', x: 70, y: 50, width: 160, height: 50, version: 5 });
    expect(api.updateScene.mock.calls.at(-1)![0].elements[0]).toEqual(current[0]);
    editor.dispose();
    fonts.dispatchEvent(new Event('loadingdone'));
    expect(frames).toHaveLength(0);
  });

  it('fits once when a newly mounted canvas first receives usable dimensions', async () => {
    const fonts = new EventTarget();
    Object.assign(fonts, { ready: Promise.resolve(fonts) });
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    let resized!: () => void;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback; }
      observe() {}
      disconnect() {}
    });
    const host = document.createElement('div');
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 0 },
      clientHeight: { configurable: true, value: 0 },
    });
    const editor = mountCanvas(host, { elements: [], files: {}, selectedElementIds: [], preview: '' }, vi.fn(), vi.fn());
    const api = { getSceneElements: () => [], updateScene: vi.fn(), scrollToContent: vi.fn(), refresh: vi.fn(), onScrollChange: vi.fn(() => vi.fn()) };
    root.render.mock.calls.at(-1)![0].props.children.props.excalidrawAPI(api);
    await Promise.resolve();
    frames.splice(0).forEach(callback => callback(0));
    expect(api.scrollToContent).not.toHaveBeenCalled();

    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 420 },
      clientHeight: { configurable: true, value: 280 },
    });
    resized();
    frames.splice(0).forEach(callback => callback(0));
    expect(api.scrollToContent).toHaveBeenCalledOnce();
    expect(api.scrollToContent).toHaveBeenCalledWith(undefined, { fitToContent: true });

    resized();
    frames.splice(0).forEach(callback => callback(0));
    expect(api.scrollToContent).toHaveBeenCalledOnce();
    editor.dispose();
  });

  it('projects selectable boxes over the read-only canvas without enabling Excalidraw editing', async () => {
    const fonts = new EventTarget();
    Object.assign(fonts, { ready: Promise.resolve(fonts) });
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const host = document.createElement('div');
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 700, top: 400, right: 1100, bottom: 700, width: 400, height: 300, x: 700, y: 400, toJSON: () => ({}) });
    const shape = { id: 'box', type: 'rectangle', x: 10, y: 20, width: 30, height: 40, version: 1, versionNonce: 2, isDeleted: false };
    const onChange = vi.fn();
    const editor = mountCanvas(host, { elements: [shape], files: {}, selectedElementIds: [], preview: '' }, onChange, vi.fn());
    const unsubscribe = vi.fn();
    const api = {
      getSceneElements: () => [shape],
      getAppState: () => ({ offsetLeft: 100, offsetTop: 50, scrollX: 5, scrollY: 6, zoom: { value: 2 } }),
      updateScene: vi.fn(),
      addFiles: vi.fn(),
      scrollToContent: vi.fn(),
      onScrollChange: vi.fn(() => unsubscribe),
    };
    root.render.mock.calls.at(-1)![0].props.children.props.excalidrawAPI(api);
    await Promise.resolve();
    expect(editor.getAnnotationTargets()).toStrictEqual([{ id: 'box', x: 30, y: 52, width: 60, height: 80 }]);
    expect(root.render.mock.calls.at(-1)![0].props.children.props.initialData.appState.selectedElementIds).toEqual({});
    const nativeUpdates = api.updateScene.mock.calls.length;
    editor.setSelection(['box']);
    expect(api.updateScene).toHaveBeenCalledTimes(nativeUpdates);
    root.render.mock.calls.at(-1)![0].props.children.props.onChange([shape], { selectedElementIds: {} }, {});
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ selectedElementIds: ['box'] }));
    editor.update({ elements: [shape], files: {}, selectedElementIds: ['box'], preview: '' }, true);
    expect(api.updateScene).toHaveBeenLastCalledWith(expect.objectContaining({ appState: { selectedElementIds: {} } }));
    editor.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('zooms around the viewport center', async () => {
    const fonts = new EventTarget();
    Object.assign(fonts, { ready: Promise.resolve(fonts) });
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const host = document.createElement('div');
    const editor = mountCanvas(host, { elements: [], files: {}, selectedElementIds: [], preview: '' }, vi.fn(), vi.fn());
    const state = { offsetLeft: 100, offsetTop: 50, scrollX: 5, scrollY: 6, width: 400, height: 300, zoom: { value: 0.4 } };
    const api = {
      getSceneElements: () => [],
      getAppState: () => state,
      updateScene: vi.fn(),
      scrollToContent: vi.fn(),
      onScrollChange: vi.fn(() => vi.fn()),
    };
    root.render.mock.calls.at(-1)![0].props.children.props.excalidrawAPI(api);
    await Promise.resolve();
    expect(editor.getControlsState()).toEqual({ zoom: 0.4 });
    expect(editor.zoomBy(0.1)).toBe(0.5);
    expect(api.updateScene).toHaveBeenLastCalledWith(expect.objectContaining({
      appState: expect.objectContaining({ zoom: { value: 0.5 }, scrollX: -95, scrollY: -69 }),
    }));
    editor.dispose();
  });
});
