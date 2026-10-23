import { mount } from '@vue/test-utils';
import ProvisioningOperationHost from '../ProvisioningOperationHost.vue';

/** The one shared progress dialog; component specs mount it beside the flow under test. */
export function mountProvisioningHost() {
  return mount(ProvisioningOperationHost);
}
