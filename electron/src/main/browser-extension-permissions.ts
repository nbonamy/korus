/** Human-readable consent; the original permission list remains available in details. */
export function extensionPermissionSummary(permissions: readonly string[]): string {
  const remaining = new Set(permissions);
  const lines: string[] = [];
  const take = (names: string[], description: string): void => {
    if (names.some((name) => remaining.has(name))) lines.push(description);
    for (const name of names) remaining.delete(name);
  };
  const hosts = permissions.filter((permission) => permission === '<all_urls>' || permission.includes('://'));
  if (hosts.length) {
    const allWebsites =
      hosts.includes('<all_urls>') ||
      hosts.includes('*://*/*') ||
      (hosts.includes('https://*/*') && hosts.includes('http://*/*'));
    lines.push(
      allWebsites
        ? 'Read and change data on all websites'
        : `Read and change data on these websites: ${hosts.join(', ')}`,
    );
    for (const host of hosts) remaining.delete(host);
    remaining.delete('activeTab');
    remaining.delete('scripting');
  }
  if (remaining.has('clipboardRead') && remaining.has('clipboardWrite')) {
    take(['clipboardRead', 'clipboardWrite'], 'Read and change your clipboard');
  } else {
    take(['clipboardRead'], 'Read your clipboard');
    take(['clipboardWrite'], 'Change your clipboard');
  }
  take(['tabs', 'webNavigation'], 'See open tabs and browsing activity');
  take(['activeTab'], 'Access a page when you use the extension');
  take(['scripting'], 'Run scripts on websites you allow');
  take(
    [
      'webRequest',
      'webRequestAuthProvider',
      'webRequestBlocking',
      'declarativeNetRequest',
      'declarativeNetRequestWithHostAccess',
    ],
    'Read and manage website requests, including sign-ins',
  );
  take(['downloads'], 'Manage downloads');
  take(['history'], 'Read and change browsing history');
  take(['bookmarks'], 'Read and change bookmarks');
  take(['cookies'], 'Access website cookies');
  take(['notifications'], 'Show notifications');
  take(['idle'], 'Detect when your device is inactive');
  take(['management'], 'Manage installed extensions');
  take(['privacy'], 'Access browser privacy settings');
  take(['nativeMessaging'], 'Request a connection to a desktop app (unavailable in this browser)');
  take(['contextMenus', 'sidePanel'], 'Add browser menus and extension controls');
  take(
    ['storage', 'unlimitedStorage', 'alarms', 'offscreen', 'background'],
    'Store extension data and run background tasks',
  );
  for (const permission of remaining) lines.push(`Additional permission: ${permission}`);
  return lines.length ? lines.map((line) => `• ${line}`).join('\n') : 'No additional permissions.';
}
