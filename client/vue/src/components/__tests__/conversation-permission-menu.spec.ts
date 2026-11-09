import { describe, expect, it } from 'vitest';
import { conversationPermissionMenuItems } from '../conversation-permission-menu';

describe('conversation permission menu', () => {
  it('omits the permissions control when the capability catalog has no modes', () => {
    expect(conversationPermissionMenuItems([])).toStrictEqual([]);
  });

  it('renders capability modes without branching on provider identity', () => {
    const items = conversationPermissionMenuItems([
      { id: 'default', label: { key: 'permissions.cursor.default.label' }, description: { key: 'permissions.cursor.default.description' } },
      { id: 'full-access', label: { key: 'permissions.cursor.fullAccess.label' }, description: { key: 'permissions.cursor.fullAccess.description' }, dangerous: true },
    ], 'full-access');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'backend-permissions',
      type: 'submenu',
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'permission-mode:default', checked: false }),
        expect.objectContaining({ id: 'permission-mode:full-access', checked: true }),
      ]),
    });
  });
});
