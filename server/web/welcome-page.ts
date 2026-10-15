import { product } from "@workspace/core/product";
import { operatorStyles } from "./operator-styles";
export { default as operatorLogo } from "../../electron/assets/icon.svg?raw";

export const welcomePage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light dark"><link rel="icon" href="/assets/logo.svg" type="image/svg+xml"><title>Sign in · ${product.name} Console</title><style>${operatorStyles}</style></head>
<body class="welcome"><main class="welcome-main">
<a class="welcome-brand" href="${product.websiteUrl}"><img src="/assets/logo.svg" width="44" height="44" alt=""><span>${product.name}<span class="console-label">Console</span></span></a>
<section class="sign-in-panel" aria-labelledby="welcome-title"><div class="welcome-icon"><img src="/assets/logo.svg" width="64" height="64" alt="${product.name}"></div><h1 id="welcome-title">Welcome to ${product.name} Console</h1><p class="subtitle">A clear view of product usage and model performance.</p>
<form id="sign-in" method="post" action="/v1/operator/session"><input type="text" name="username" value="operator" autocomplete="username" hidden><label for="password">Operator password</label><input id="password" type="password" name="password" autocomplete="current-password" required maxlength="1024" autofocus><p id="sign-in-error" class="sign-in-error" role="alert" aria-live="polite"></p><button class="primary" type="submit">Sign in</button></form>
<p class="sign-in-note">Private access for the ${product.name} team.</p></section>
<p class="welcome-footer">${product.name} · Your agents, one workspace.</p>
</main><script src="/assets/sign-in.js"></script></body></html>`;

export const signInScript = String.raw`
(() => {
 let opened=false;
 async function openConsole(){
  if(opened)return true;
  const response=await fetch('/v1/operator/page',{credentials:'same-origin'});
  if(!response.ok)return false;
  const html=await response.text();if(opened)return true;
  const next=new DOMParser().parseFromString(html,'text/html');opened=true;
  for(const script of next.querySelectorAll('script'))script.remove();
  document.title=next.title;document.body.replaceWith(next.body);
  const script=document.createElement('script');script.src='/assets/operator.js';document.body.append(script);
  return true;
 }
 const form=document.querySelector('#sign-in'),button=form.querySelector('button'),error=document.querySelector('#sign-in-error');
 void openConsole().catch(()=>undefined);
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled)return;
  button.disabled=true;button.textContent='Signing in…';form.setAttribute('aria-busy','true');error.textContent='';
  try{
   const response=await fetch('/v1/operator/session',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({password:form.elements.password.value})});
   if(!response.ok)throw Error(response.status===429?'Too many attempts. Please wait a minute and try again.':'Could not sign in. Check your password and try again.');
   form.elements.password.value='';if(!await openConsole())throw Error('Could not open the console. Please try again.');
  }catch(failure){error.textContent=failure.message==='Failed to fetch'?'Could not connect. Please try again.':failure.message;}
  finally{button.disabled=false;button.textContent='Sign in';form.setAttribute('aria-busy','false');}
 });
})();
`;
