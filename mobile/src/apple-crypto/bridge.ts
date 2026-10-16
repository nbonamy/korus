import { fromString } from 'uint8arrays/from-string';
import { toString } from 'uint8arrays/to-string';
import { request } from '../../web/src/native';
export const encode = (data: Uint8Array) => toString(data, 'base64pad');
export const decode = (data: string) => fromString(data, 'base64');
/** No JavaScript crypto fallback: an unavailable native service fails the connection closed. */
export const appleCrypto = <T>(command: Record<string, unknown>): Promise<T> => request<T>({ type: 'crypto', command });
