const icons: Record<string, string> = {
  nngceckbapebfimnlniiiahkandclblb: new URL('../assets/browser-extensions/bitwarden.svg', import.meta.url).href,
  aeblfdkhhhdcdjpifhhbdiojplfjncoa: new URL('../assets/browser-extensions/1password.png', import.meta.url).href,
};
export const browserExtensionIcon = (id: string) => icons[id];
