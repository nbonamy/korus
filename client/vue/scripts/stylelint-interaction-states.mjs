import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseSfc } from '@vue/compiler-sfc';
import { parse as parseTemplate } from '@vue/compiler-dom';
import ts from 'typescript';
import selectorParser from 'postcss-selector-parser';
import stylelint from 'stylelint';

const ruleName = 'app/interaction-state-owner';
const renderer = fileURLToPath(new URL('../src/', import.meta.url));
let classes;
function controlClasses() {
  if (classes) return classes;
  classes = new Set(['app-button', 'app-icon-button', 'el-button', 'repository-backlog__item-actions']);
  for (const entry of fs.readdirSync(renderer, { recursive: true })) {
    if (!entry.endsWith('.vue') || entry.includes('__tests__')) continue;
    const { descriptor } = parseSfc(fs.readFileSync(path.join(renderer, entry), 'utf8'));
    if (!descriptor.template) continue;
    function visit(node) {
      if (node.type !== 1) return;
      const classAttr = node.props.find(prop => prop.type === 6 && prop.name === 'class')?.value?.content ?? '';
      if (classAttr.split(/\s+/).includes('agent-ui-interactive')) {
        classAttr.split(/\s+/).forEach(value => classes.add(value));
        const expression = node.props.find(prop => prop.type === 7 && prop.name === 'bind' && prop.arg?.content === 'class')?.exp?.content;
        if (expression) {
          const ast = ts.createSourceFile('classes.ts', `(${expression})`, ts.ScriptTarget.Latest);
          function strings(child) {
            if (ts.isStringLiteral(child)) child.text.split(/\s+/).forEach(value => classes.add(value));
            ts.forEachChild(child, strings);
          }
          strings(ast);
        }
      }
      node.children.forEach(visit);
    }
    parseTemplate(descriptor.template.content).children.forEach(visit);
  }
  return classes;
}
function targetsControl(selector) {
  const nodes = selector.nodes ?? [];
  const last = nodes.findLastIndex(node => node.type === 'combinator');
  const compound = nodes.slice(last + 1);
  if (compound.some(node => node.type === 'pseudo' && node.value.startsWith('::'))) return false;
  return compound.some(node => node.type === 'tag' && node.value === 'button'
    || node.type === 'class' && controlClasses().has(node.value) && !['is-active', 'is-selected', 'is-disabled'].includes(node.value)
    || node.type === 'pseudo' && [':deep', ':global', ':is', ':where'].includes(node.value) && node.nodes?.some(targetsControl));
}
export default stylelint.createPlugin(ruleName, enabled => (root, result) => {
  if (!enabled || !root.source?.input.file?.startsWith(renderer)) return;
  root.walkRules(rule => {
    let controls;
    try { controls = selectorParser().astSync(rule.selector).nodes.some(targetsControl); } catch { return; }
    if (!controls) return;
    rule.walkDecls(declaration => {
      if (declaration.parent !== rule || declaration.value === 'revert-layer') return;
      const paint = /^(?:background(?:-color)?|color|outline(?:-color|-style|-width|-offset)?)$/.test(declaration.prop);
      const disabled = /:disabled|aria-disabled|\[disabled/.test(rule.selector.replaceAll(':not(:disabled)', ''))
        && /^(?:opacity|cursor|box-shadow)$/.test(declaration.prop);
      if (paint || disabled || declaration.prop === 'cursor' && declaration.value === 'pointer') {
        stylelint.utils.report({ruleName, result, node: declaration,
          message: 'Interaction paint belongs to agent-ui-interactive; configure its tokens instead.'});
      }
    });
  });
});
