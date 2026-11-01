import {
  isPlanReview,
  isPlanReviewDraft,
  type PlanReview,
  type PlanReviewDraft,
} from '@workspace/core/plan-review';

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
// Legacy fields were literal text, so they must not introduce Markdown structure.
const literal = (v: unknown): string => text(v).replace(/[\\`*_{}\[\]()#+.!<>|~-]/gu, '\\$&');
/** Read-only compatibility for saved structured plans. Never creates approval authority. */
export function restorePlanReview(
  agent: Record<string, unknown>,
  conversationId: string | null,
): PlanReview | undefined {
  const native = isPlanReview(agent.planReview) ? structuredClone(agent.planReview) : undefined;
  const old = agent.interactivePlan;
  if (
    !object(old) ||
    old.agentId !== agent.id ||
    old.conversationId !== conversationId ||
    !object(old.document) ||
    !Array.isArray(old.document.sections) ||
    !text(old.id)
  )
    return native;
  let draft: PlanReviewDraft = { comments: [], choices: [] };
  const answers = object(old.answers) ? old.answers : {};
  const comments = object(answers.comments) ? answers.comments : {};
  const choices = object(answers.choices) ? answers.choices : {};
  let index = 0;
  let groups = 0;
  const lines = [`# ${literal(text(old.document.title).replace(/\s+/gu, ' '))}`];
  function render(sections: unknown[], depth: number) {
    if (depth > 3) return;
    for (const section of sections.slice(0, 50)) {
      if (!object(section)) continue;
      const id = `s${++index}`;
      const claim = text(section.claim);
      lines.push(
        '',
        `${'#'.repeat(depth + 1)} ${literal(claim.replace(/\s+/gu, ' '))}`,
        '',
        literal(section.detail),
      );
      if (object(section.exhibit)) {
        lines.push('', literal(section.exhibit.title), '', literal(section.exhibit.text));
        if (Array.isArray(section.exhibit.screens))
          for (const screen of section.exhibit.screens) {
            if (!object(screen)) continue;
            lines.push('', `**${literal(screen.label)} — ${literal(screen.title)}**`);
            for (const key of ['navigation', 'content', 'actions'])
              if (Array.isArray(screen[key]))
                lines.push(...screen[key].map((v) => `- ${literal(v)}`));
            for (const key of ['fields', 'items'])
              if (Array.isArray(screen[key]))
                for (const item of screen[key])
                  if (object(item))
                    lines.push(
                      `- ${literal(item.label ?? item.title)}: ${literal(item.value ?? item.detail)}`,
                    );
          }
      }
      if (object(section.decision) && Array.isArray(section.decision.options)) {
        const decision = section.decision;
        const options = section.decision.options.filter(object);
        lines.push(
          '',
          literal(section.decision.question),
          '',
          ...options.map(
            (o) => `- (${o.id === decision.proposed ? 'x' : ' '}) ${literal(o.label)}`,
          ),
        );
        const selected = options.find((o) => o.id === choices[text(section.id)]);
        if (selected)
          draft.choices.push({
            id: `${id}-g${groups}`,
            quote: `${claim}\n${options.map((o) => text(o.label)).join('\n')}`,
            selected: [text(selected.label)],
          });
        groups++;
      }
      const body = text(comments[text(section.id)]);
      if (body) draft.comments.push({ id, sectionId: id, quote: claim, body });
      if (Array.isArray(section.children)) render(section.children, depth + 1);
    }
  }
  render(old.document.sections, 1);
  if (!isPlanReviewDraft(draft)) {
    lines.push('', '## Saved feedback', '', '```json', JSON.stringify(old.answers, null, 2), '```');
    draft = { comments: [], choices: [] };
  }
  const markdown = lines.join('\n');
  // An existing independent native proposal remains authoritative. Preserve the old
  // document and decisions as review history rather than approving unrelated text.
  const linked =
    native?.conversationId === conversationId &&
    native.markdown.startsWith(
      `# ${text(old.document.title)}\n\nPlan ${old.id} · revision ${old.revision}\n`,
    );
  const migrated: PlanReview = {
    ...(linked
      ? native!
      : {
          id: `saved:${old.id}:${old.revision}`,
          conversationId,
          turnId: `saved:${old.id}`,
          canApprove: false,
        }),
    markdown,
    status: old.submitted ? 'revise' : 'pending',
    draft,
    draftVersion: 0,
    ...(old.deliveryPending === true ? { deliveryPending: true } : {}),
    history: Array.isArray(old.history)
      ? old.history
          .slice(-19)
          .filter(object)
          .map((h) => ({
            reviewId: `saved:${old.id}:${h.revision}`,
            status: h.submitted ? ('revise' as const) : ('pending' as const),
            draft: { comments: [], choices: [] },
            markdown: JSON.stringify(h.answers, null, 2),
          }))
      : [],
  };
  return native && !linked
    ? {
        ...native,
        history: [
          ...(native.history ?? []),
          ...(migrated.history ?? []),
          { reviewId: migrated.id, draft, status: migrated.status, markdown },
        ].slice(-20),
      }
    : migrated;
}
