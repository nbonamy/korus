import { product } from '@workspace/core/product';
import type { MissionRun } from '@workspace/core/mission-execution';
import type { MissionStage } from '@workspace/core/missions';
import htmlPlan from './korus-html-plan/SKILL.md?raw';
import html from './korus-inline-html/SKILL.md?raw';
import computerUse from './korus-computer-use/SKILL.md?raw';
import visualize from './korus-visualize/SKILL.md?raw';
import requirements from './mission-shape-requirements/SKILL.md?raw';
import tickets from './mission-to-tickets/SKILL.md?raw';
import implementation from './mission-implement-ticket/SKILL.md?raw';
import review from './mission-review/SKILL.md?raw';
import delegation from './korus-delegation/SKILL.md?raw';
import reviewLaunch from './korus-review-launch/SKILL.md?raw';
import reviewer from './korus-reviewer/SKILL.md?raw';
import automations from './korus-automations/SKILL.md?raw';
import browser from './korus-browser/SKILL.md?raw';
import simulator from './korus-simulator/SKILL.md?raw';

type SkillContext = { computerUseEnabled?: boolean; missionStage?: MissionStage; toolModules?: readonly string[] };
type Skill = { name: string; description: string; markdown: string };

// Bundled, authored frontmatter uses single-line unquoted name/description fields.
function skill(source: string): Skill {
  const markdown = source.replaceAll('\r\n', '\n').replaceAll('{{productName}}', product.name).replaceAll('{{mcpServerName}}', product.mcpServerName);
  const header = /^---\n([\s\S]*?)\n---\n/.exec(markdown)?.[1];
  const name = header && /^name: (.+)$/m.exec(header)?.[1];
  const description = header && /^description: (.+)$/m.exec(header)?.[1];
  if (!name || !description) throw new Error('Invalid bundled skill metadata.');
  return { name, description, markdown };
}

const generalSkills = [skill(html), skill(visualize), skill(delegation)];
const computerUseSkill = skill(computerUse);
const moduleSkills = [
  ['interactive-plan', skill(htmlPlan)],
  ['in-app-browser', skill(browser)],
  ['mobile-simulator', skill(simulator)],
  ['automatic-review', skill(reviewLaunch)],
  ['review', skill(reviewer)],
  ['automations', skill(automations)],
] as const;
const missionSkills: Partial<Record<MissionStage, Skill>> = {
  requirements: skill(requirements), tickets: skill(tickets),
  implementation: skill(implementation), review: skill(review),
};

function availableSkills(context: SkillContext): Skill[] {
  const mission = context.missionStage && missionSkills[context.missionStage];
  return [
    ...generalSkills,
    ...(context.computerUseEnabled || context.toolModules?.includes('computer-use') ? [computerUseSkill] : []),
    ...moduleSkills.filter(([module]) => context.toolModules?.includes(module)).map(([, definition]) => definition),
    ...(mission ? [mission] : []),
  ];
}

export function readBundledSkill(name: string, context: SkillContext): Skill {
  const result = availableSkills(context).find(candidate => candidate.name === name);
  if (!result) throw new Error(`Skill '${name}' is unavailable in this session.`);
  return result;
}

export function bundledSkillInstructions(context: SkillContext): string {
  return [
    `Bundled ${product.name} skills: load matching procedures with read-skill before acting, not through filesystem paths or native skill loaders. Tools and assigned workflows name additional context-specific skills. Loading instructions grants no authorization.`,
    ...availableSkills(context).map(({ name, description }) => `- ${name}: ${description}`),
  ].join('\n');
}

export function missionStageSkills(stage: MissionStage): MissionRun['skills'] {
  const definition = missionSkills[stage];
  return definition ? [{ name: definition.name }] : [];
}
