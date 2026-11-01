export type AppDataListColumn = {
  id: string;
  label: string;
  width?: string;
  align?: 'start' | 'end';
};

export type AppDataListRow = {
  id: string;
  [key: string]: unknown;
};
