import type { AppCommand } from '@workspace/core/contracts';
import { product } from '@workspace/core/product';

export const appDeepLinkScheme = product.protocolScheme;
const appDeepLinkProtocol = `${appDeepLinkScheme}:`;
const MAX_DEEP_LINK_PROMPT_LENGTH = 100_000;

export function appCommandFromDeepLink(value: string, developmentScheme?: string): AppCommand | null {
  if (developmentScheme && value.startsWith(`${developmentScheme}://`)) value = `${appDeepLinkScheme}:${value.slice(developmentScheme.length + 1)}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === appDeepLinkProtocol && url.hostname === 'share' && !url.username && !url.password && !url.port && value.length <= 2048) {
    return { type: 'open-shared-conversation', link: value };
  }
  if (
    url.protocol !== appDeepLinkProtocol
    || url.username
    || url.password
    || url.port
    || url.hash
  ) {
    return null;
  }

  const prompt = url.searchParams.get('prompt');
  if (prompt !== null && prompt.length > MAX_DEEP_LINK_PROMPT_LENGTH) return null;
  const submitParam = url.searchParams.get('submit');
  if (submitParam !== null && submitParam !== 'true' && submitParam !== 'false') return null;
  const submit = submitParam !== 'false';
  if (url.hostname === 'new' && (url.pathname === '' || url.pathname === '/')) {
    return prompt === null ? null : { type: 'open-agent-composer', prompt, submit };
  }
  if (url.hostname !== 'agents') return null;
  const pathSegments = url.pathname.split('/').filter(Boolean);
  if (pathSegments.length !== 1) return null;
  let agentId: string;
  try {
    agentId = decodeURIComponent(pathSegments[0]!).trim();
  } catch {
    return null;
  }
  if (!agentId || agentId.includes('/')) return null;
  return {
    type: 'open-agent-composer',
    agentId,
    ...(prompt === null ? {} : { prompt, submit }),
  };
}

export function deepLinksFromArgv(argv: readonly string[], developmentScheme?: string): string[] {
  return argv.filter((value) => value.startsWith(`${appDeepLinkProtocol}//`) || Boolean(developmentScheme && value.startsWith(`${developmentScheme}://`)));
}
