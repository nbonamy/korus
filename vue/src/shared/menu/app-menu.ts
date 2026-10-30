import type { Component } from 'vue';

type AppMenuItemBase = {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: Component;
  iconUrl?: string;
  value?: string | { addedLines: number; removedLines: number };
};

/** A second, icon-only action at the trailing edge of a row; it selects its own id. */
export type AppMenuSecondaryAction = {
  id: string;
  label: string;
  icon: Component;
  disabled?: boolean;
};

export type AppMenuActionItem = AppMenuItemBase & {
  type: 'action';
  danger?: boolean;
  leadingColor?: string;
  secondaryAction?: AppMenuSecondaryAction;
};

export type AppMenuCheckboxItem = AppMenuItemBase & {
  type: 'checkbox';
  accessory?: 'check' | 'switch';
  checked: boolean;
};

export type AppMenuRadioItem = AppMenuItemBase & {
  type: 'radio';
  checked: boolean;
};

export type AppMenuSubmenuItem = AppMenuItemBase & {
  type: 'submenu';
  /** Marks the submenu's own entry as the current choice (shown as a check). */
  checked?: boolean;
  items: AppMenuItem[];
  submenuWidth?: 'default' | 'wide';
};

/** A read-only row: a heading or a figure the user can see but not choose. */
export type AppMenuInfoItem = AppMenuItemBase & {
  type: 'info';
  leadingColor?: string;
};

export type AppMenuSeparatorItem = {
  id: string;
  type: 'separator';
};

export type AppMenuItem =
  | AppMenuActionItem
  | AppMenuInfoItem
  | AppMenuCheckboxItem
  | AppMenuRadioItem
  | AppMenuSeparatorItem
  | AppMenuSubmenuItem;
