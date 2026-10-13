import frameStyles from "./interactive-plan-frame.css?inline";
import {
  isPlanAnswers,
  type InteractivePlan,
  type PlanAnswers,
  type PlanSection,
} from "@workspace/core/interactive-plan";

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
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
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
  const icon = (name: "comment" | "edit" | "nav") =>
    `<svg aria-hidden="true" viewBox="0 0 24 24">${name === "comment" ? '<path d="M20 11.5a4 4 0 0 1-4 4h-5l-5 4v-4a4 4 0 0 1-3-4v-5a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z"/>' : name === "edit" ? '<path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z"/>' : '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16"/>'}</svg>`;
  const exhibit = (s: PlanSection) => {
    if (!s.exhibit) return "";
    const { title, text, screens } = s.exhibit;
    return `<figure><figcaption>${escape(title)}</figcaption>${
      screens
        ? `<div class="mockup-screens" role="group" aria-label="${escape(text)}">${screens.map((screen) => `<div class="mockup-screen"><div class="mockup-window"><div class="mockup-titlebar"><span class="window-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${escape(screen.title)}</span></div><div class="mockup-body">${screen.navigation ? `<div class="mockup-nav">${screen.navigation.map((item) => `<div${item === screen.activeItem ? ' class="active"' : ""}>${icon("nav")}<span>${escape(item)}</span></div>`).join("")}</div>` : ""}<div class="mockup-content">${screen.content ? screen.content.map((line) => `<p>${escape(line)}</p>`).join("") : screen.fields || screen.items ? "" : '<div aria-hidden="true"><i class="skeleton"></i><i class="skeleton"></i><i class="skeleton"></i><i class="skeleton"></i></div>'}${screen.fields ? `<div class="mockup-fields">${screen.fields.map((field) => `<div class="mockup-field"><span>${escape(field.label)}</span><div>${escape(field.value)}</div></div>`).join("")}</div>` : ""}${screen.items ? `<div class="mockup-list">${screen.items.map((item) => `<div class="mockup-item"><strong>${escape(item.title)}</strong>${item.detail ? `<span>${escape(item.detail)}</span>` : ""}</div>`).join("")}</div>` : ""}${screen.actions ? `<div class="mockup-actions">${screen.actions.map((action) => `<span class="mockup-action">${escape(action)}</span>`).join("")}</div>` : ""}</div></div></div><div class="mockup-label">${escape(screen.label)}</div></div>`).join("")}</div>`
        : `<pre>${escape(text)}</pre>`
    }</figure>`;
  };
  const render = (sections: PlanSection[], depth: number): string =>
    sections
      .map((s, index) => {
        const comment = plan.answers.comments[s.id] ?? "";
        const disabled = plan.submitted ? " disabled" : "";
        return (
          `<details class="claim"${depth === 1 && index < 2 ? " open" : ""}><summary><svg class="chevron" aria-hidden="true" viewBox="0 0 12 12"><path d="m4 2 4 4-4 4"/></svg><span class="claim-title">${escape(s.claim)}</span><button class="icon-button" type="button" data-comment-toggle="${escape(s.id)}" data-has-comment="${Boolean(comment)}" aria-expanded="false" aria-controls="comment-${escape(s.id)}" aria-label="${escape(labels.comment + ": " + s.claim)}"${disabled}>${icon("comment")}</button></summary><div class="section">` +
          (s.detail ? `<p>${escape(s.detail)}</p>` : "") +
          exhibit(s) +
          (s.decision
            ? `<div class="decision" role="group" aria-labelledby="question-${escape(s.id)}"><div class="decision-question" id="question-${escape(s.id)}">${escape(s.decision.question)}</div>${s.decision.options.map((o) => `<label class="option"><input type="radio" name="${escape(s.id)}" value="${escape(o.id)}"${plan.answers.choices[s.id] === o.id ? " checked" : ""}${disabled}><span class="option-text">${escape(o.label)}${s.decision?.proposed === o.id ? ` <span class="proposed">${escape(labels.proposed)}</span>` : ""}</span></label>`).join("")}<button class="clear-choice" type="button" data-clear="${escape(s.id)}"${plan.answers.choices[s.id] ? "" : " hidden"}${disabled}>${escape(labels.clear)}</button></div>`
            : "") +
          `<div class="comment"${comment ? "" : " hidden"}><button class="comment-preview" type="button" data-comment-preview="${escape(s.id)}"${comment ? "" : " hidden"}${disabled}>${icon("comment")}<span>${escape(comment)}</span>${icon("edit")}</button><label class="sr-only" for="comment-${escape(s.id)}">${escape(labels.comment)}</label><textarea hidden id="comment-${escape(s.id)}" data-section="${escape(s.id)}" maxlength="4000" placeholder="${escape(labels.comment)}"${disabled}>${escape(comment)}</textarea></div>` +
          (s.children
            ? `<div class="children">${render(s.children, depth + 1)}</div>`
            : "") +
          "</div></details>"
        );
      })
      .join("");
  const identity = JSON.stringify({
    agentId: plan.agentId,
    conversationId: plan.conversationId,
    planId: plan.id,
    revision: plan.revision,
    nonce,
  }).replace(/</g, "\\u003c");
  const color = (value: string) =>
    /^(#[\da-f]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]+)$/i.test(value)
      ? value
      : "initial";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${escape(nonce)}'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><style>
${frameStyles}
:root{--bg:${color(theme.background)};--fg:${color(theme.foreground)};--border:${color(theme.border)};--primary:${color(theme.primary)}}
</style></head><body><h1>${escape(plan.document.title)}</h1>${render(plan.document.sections, 1)}<script nonce="${escape(nonce)}">
const identity=${identity};
function changed(){const choices={},comments={};document.querySelectorAll('input:checked').forEach(el=>{choices[el.name]=el.value});document.querySelectorAll('textarea').forEach(el=>{if(el.value)comments[el.dataset.section]=el.value});document.querySelectorAll('[data-clear]').forEach(el=>{el.hidden=!choices[el.dataset.clear]});parent.postMessage({...identity,type:'plan-answers',answers:{choices,comments}},'*')}
function editComment(id){const editor=document.getElementById('comment-'+id);if(!editor||editor.disabled)return;editor.closest('details').open=true;editor.parentElement.hidden=false;editor.parentElement.querySelector('[data-comment-preview]').hidden=true;editor.hidden=false;document.querySelectorAll('[data-comment-toggle]').forEach(button=>{if(button.dataset.commentToggle===id)button.setAttribute('aria-expanded','true')});editor.focus()}
function closeComment(editor){editor.hidden=true;const preview=editor.parentElement.querySelector('[data-comment-preview]');preview.querySelector('span').textContent=editor.value;preview.hidden=!editor.value;editor.parentElement.hidden=!editor.value;document.querySelectorAll('[data-comment-toggle]').forEach(button=>{if(button.dataset.commentToggle===editor.dataset.section){button.setAttribute('aria-expanded','false');button.dataset.hasComment=String(Boolean(editor.value))}})}
document.addEventListener('input',event=>{if(event.target.matches('input,textarea'))changed()});
document.addEventListener('change',event=>{if(event.target.matches('input'))changed()});
document.addEventListener('focusout',event=>{if(event.target.matches('textarea')&&event.relatedTarget?.dataset?.commentToggle!==event.target.dataset.section)closeComment(event.target)});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&event.target.matches('textarea')){const id=event.target.dataset.section;event.target.blur();document.querySelectorAll('[data-comment-toggle]').forEach(button=>{if(button.dataset.commentToggle===id)button.focus()})}});
document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button||button.disabled)return;const commentId=button.dataset.commentToggle||button.dataset.commentPreview;if(commentId){event.preventDefault();const editor=document.getElementById('comment-'+commentId);if(button.dataset.commentToggle&&!editor.hidden){closeComment(editor);button.focus()}else editComment(commentId);return}const id=button.dataset.clear;if(id){document.querySelectorAll('input').forEach(el=>{if(el.name===id)el.checked=false});changed()}});
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
    event.origin !== "null" ||
    !event.data ||
    typeof event.data !== "object"
  )
    return null;
  const data = event.data as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) =>
        ![
          "type",
          "agentId",
          "conversationId",
          "planId",
          "revision",
          "nonce",
          "answers",
        ].includes(key),
    ) ||
    data.type !== "plan-answers" ||
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
