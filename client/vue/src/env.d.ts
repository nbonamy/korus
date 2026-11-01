declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<object, object, unknown>;
  export default component;
}

declare module '*?url' {
  const url: string;
  export default url;
}

declare module '*.css';
declare module '*.png?url' {
  const url: string;
  export default url;
}
