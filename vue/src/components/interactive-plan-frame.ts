import {
  isPlanAnswers,
  type InteractivePlan,
  type PlanAnswers,
  type PlanSection,
} from '@workspace/core/interactive-plan';

export type PlanFrameTheme = {
  background: string;
  foreground: string;
  border: string;
  primary: string;
};
export type PlanFrameLabels = {
  comment: string;
  proposed: string;
  clear: string;
};
const escape = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
/** Only app-authored markup and script execute. Every agent/user string is escaped. */
export function interactivePlanFrame(
  plan: InteractivePlan,
  nonce: string,
  theme: PlanFrameTheme,
  labels: PlanFrameLabels,
): string {
  const render = (sections: PlanSection[], depth: number): string =>
    sections
      .map(
        (s) =>
          `<details${depth === 1 ? ' open' : ''}><summary>${escape(s.claim)}</summary><div class="section">` +
          (s.detail ? `<p>${escape(s.detail)}</p>` : '') +
          (s.exhibit
            ? `<figure><figcaption>${escape(s.exhibit.title)}</figcaption><pre>${escape(s.exhibit.text)}</pre></figure>`
            : '') +
          (s.decision
            ? `<fieldset><legend>${escape(s.decision.question)}</legend>${s.decision.options.map((o) => `<label><input type="radio" name="${escape(s.id)}" value="${escape(o.id)}"${plan.answers.choices[s.id] === o.id ? ' checked' : ''}${plan.submitted ? ' disabled' : ''}>${escape(o.label)}${s.decision?.proposed === o.id ? ` <small>(${escape(labels.proposed)})</small>` : ''}</label>`).join('')}<button type="button" data-clear="${escape(s.id)}"${plan.submitted ? ' disabled' : ''}>${escape(labels.clear)}</button></fieldset>`
            : '') +
          `<label class="comment">${escape(labels.comment)}<textarea data-section="${escape(s.id)}" maxlength="4000"${plan.submitted ? ' disabled' : ''}>${escape(plan.answers.comments[s.id] ?? '')}</textarea></label>` +
          render(s.children ?? [], depth + 1) +
          '</div></details>',
      )
      .join('');
  const identity = JSON.stringify({
    agentId: plan.agentId,
    conversationId: plan.conversationId,
    planId: plan.id,
    revision: plan.revision,
    nonce,
  }).replace(/</g, '\\u003c');
  const color = (value: string) =>
    /^(#[\da-f]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]+)$/i.test(value)
      ? value
      : 'initial';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${escape(nonce)}'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><style>
:root{--bg:${color(theme.background)};--fg:${color(theme.foreground)};--border:${color(theme.border)};--primary:${color(theme.primary)};color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:16px;font:14px system-ui;color:var(--fg);background:var(--bg);overflow-wrap:anywhere}h1{font-size:20px;margin:0 0 16px}details{border-top:1px solid var(--border);padding:10px 0}summary{cursor:pointer;font-weight:600}summary:focus-visible,input:focus-visible,textarea:focus-visible,button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}.section{padding:8px 0 0 12px}p{white-space:pre-wrap}figure{margin:12px 0}figcaption,small{opacity:.8}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--border);padding:10px;max-height:320px;overflow:auto}fieldset{border:1px solid var(--border);margin:12px 0;padding:10px;min-width:0}fieldset label{display:flex;gap:8px;align-items:baseline;padding:6px 0}input{accent-color:var(--primary)}.comment{display:block;margin:12px 0}textarea{display:block;width:100%;min-height:64px;resize:vertical;max-height:240px;color:var(--fg);background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:8px;font:inherit}button{font:inherit;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:4px 8px}@media(max-width:400px){body{padding:10px}.section{padding-left:6px}}
</style></head><body><h1>${escape(plan.document.title)}</h1>${render(plan.document.sections, 1)}<script nonce="${escape(nonce)}">
const identity=${identity};
function changed(){const choices={},comments={};document.querySelectorAll('input:checked').forEach(el=>{choices[el.name]=el.value});document.querySelectorAll('textarea').forEach(el=>{if(el.value)comments[el.dataset.section]=el.value});parent.postMessage({...identity,type:'plan-answers',answers:{choices,comments}},'*')}
document.addEventListener('input',changed);document.addEventListener('change',event=>{if(event.target.matches('input'))changed()});document.addEventListener('click',event=>{const id=event.target.dataset.clear;if(id){document.querySelectorAll('input').forEach(el=>{if(el.name===id)el.checked=false});changed()}});
</script></body></html>`;
}
/** Opaque sandbox origin plus exact WindowProxy, nonce and revision; no arbitrary commands. */
export function planFrameAnswers(
  event: MessageEvent,
  source: Window | null,
  plan: InteractivePlan,
  nonce: string,
): PlanAnswers | null {
  if (
    !source ||
    event.source !== source ||
    event.origin !== 'null' ||
    !event.data ||
    typeof event.data !== 'object'
  )
    return null;
  const data = event.data as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) =>
        !['type', 'agentId', 'conversationId', 'planId', 'revision', 'nonce', 'answers'].includes(
          key,
        ),
    ) ||
    data.type !== 'plan-answers' ||
    data.agentId !== plan.agentId ||
    data.conversationId !== plan.conversationId ||
    data.planId !== plan.id ||
    data.revision !== plan.revision ||
    data.nonce !== nonce ||
    !isPlanAnswers(data.answers, plan.document) ||
    plan.submitted
  )
    return null;
  return structuredClone(data.answers);
}
