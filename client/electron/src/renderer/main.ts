import { product } from '@workspace/core/product';
import { mountAppVueApp } from '@workspace/vue/bootstrap';

document.title = product.name;

if (!window.app) {
  throw new Error(`${product.name} preload API is unavailable.`);
}

mountAppVueApp({
  client: {
    api: window.app,
    platform: 'desktop',
  },
});
