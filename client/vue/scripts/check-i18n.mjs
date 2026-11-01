import product from '../../../core/src/product.json' with { type: 'json' };
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeTypes, parse as parseTemplate } from '@vue/compiler-dom';
import { parse as parseSfc } from '@vue/compiler-sfc';
import ts from 'typescript';

const appTextPrefixes = ['backend.', 'panels.', 'permissions.', 'workProvider.'];
const presentationAttributes = new Set([
  'alt',
  'aria-label',
  'ariaLabel',
  'description',
  'label',
  'placeholder',
  'title',
]);

export function appTextDescriptorKeys(source, fileName = 'source.ts') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const keys = [];
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node)
      && propertyName(node.name) === 'key'
      && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))
      && appTextPrefixes.some((prefix) => node.initializer.text.startsWith(prefix))
    ) {
      keys.push(node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return keys;
}

export function messagePaths(source, fileName = 'messages.ts') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  let messages;
  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === 'messages' && declaration.initializer) {
        messages = objectLiteral(declaration.initializer);
      }
    }
  });
  const english = messages && childObject(messages, 'en');
  if (!english) throw new Error(`Could not find the messages.en object in ${fileName}.`);
  return new Set(flattenObjectPaths(english));
}

export function missingAppTextMessages(sources, catalog) {
  return sources.flatMap(({ file, source }) => (
    appTextDescriptorKeys(source, file)
      .filter((key) => !catalog.has(key))
      .map((key) => ({ file, key }))
  ));
}

export function literalTemplateCopy(source, fileName = 'component.vue') {
  const template = parseSfc(source, { filename: fileName }).descriptor.template?.content ?? '';
  const text = [];
  const attributes = [];
  const visit = (node) => {
    if (node.type === NodeTypes.TEXT) {
      const value = node.content.trim();
      if (/[A-Za-z]/u.test(value)) text.push(value);
      return;
    }
    if (node.type === NodeTypes.ELEMENT) {
      for (const prop of node.props) {
        if (
          prop.type === NodeTypes.ATTRIBUTE
          && presentationAttributes.has(prop.name)
          && prop.value
          && /[A-Za-z]/u.test(prop.value.content)
          && prop.value.content !== product.name
        ) {
          attributes.push(prop.value.content);
        }
      }
    }
    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children) visit(child);
    }
  };
  visit(parseTemplate(template));
  return { text, attributes };
}

export function checkVueI18n(repoRoot) {
  const messagesFile = join(repoRoot, 'client/vue/src/i18n/messages.ts');
  const catalog = messagePaths(readFileSync(messagesFile, 'utf8'), messagesFile);
  const descriptorSources = ['core/src', 'client/backend/src', 'client/electron/src/main'].flatMap((root) => (
    sourceFiles(join(repoRoot, root), '.ts').map((path) => ({
      file: relative(repoRoot, path),
      source: readFileSync(path, 'utf8'),
    }))
  ));
  const missingMessages = missingAppTextMessages(descriptorSources, catalog);

  const literalCopy = [];
  const vueRoot = join(repoRoot, 'client/vue/src');
  for (const path of sourceFiles(vueRoot, '.vue')) {
    const result = literalTemplateCopy(readFileSync(path, 'utf8'), path);
    if (result.text.length > 0 || result.attributes.length > 0) {
      literalCopy.push({ file: relative(repoRoot, path), ...result });
    }
  }
  return { missingMessages, literalCopy };
}

function sourceFiles(directory, extension) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path, extension);
    return entry.isFile() && entry.name.endsWith(extension) ? [path] : [];
  });
}

function objectLiteral(expression) {
  while (
    ts.isAsExpression(expression)
    || ts.isSatisfiesExpression(expression)
    || ts.isParenthesizedExpression(expression)
  ) {
    expression = expression.expression;
  }
  return ts.isObjectLiteralExpression(expression) ? expression : undefined;
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function childObject(object, name) {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(property.name) === name) {
      return objectLiteral(property.initializer);
    }
  }
  return undefined;
}

function flattenObjectPaths(object, prefix = '') {
  return object.properties.flatMap((property) => {
    if (!ts.isPropertyAssignment(property)) return [];
    const name = propertyName(property.name);
    if (!name) return [];
    const path = prefix ? `${prefix}.${name}` : name;
    const nested = objectLiteral(property.initializer);
    return nested ? flattenObjectPaths(nested, path) : [path];
  });
}

function printFailures(result) {
  for (const failure of result.missingMessages) {
    console.error(`${failure.file}: missing renderer message for ${failure.key}`);
  }
  for (const failure of result.literalCopy) {
    for (const value of failure.text) console.error(`${failure.file}: literal template text: ${JSON.stringify(value)}`);
    for (const value of failure.attributes) console.error(`${failure.file}: literal presentation attribute: ${JSON.stringify(value)}`);
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && scriptPath === resolve(process.argv[1])) {
  const result = checkVueI18n(resolve(dirname(scriptPath), '../../..'));
  printFailures(result);
  if (result.missingMessages.length > 0 || result.literalCopy.length > 0) process.exitCode = 1;
}
