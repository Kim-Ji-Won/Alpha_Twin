import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { requireEvidence } from './contracts.js';

const parser = new XMLParser({ ignoreAttributes: false, parseAttributeValue: false,
  allowBooleanAttributes: true, processEntities: true, htmlEntities: true });
type Container = { index: number; contentStart: number; end: number };

// Static, already-masked viewer HTML only. Track raw div boundaries; never repair truncated markup.
export function warningContainers(html: string): Container[] {
  const stack: { index: number; contentStart: number; warning: boolean }[] = [];
  const result: Container[] = [];
  for (let cursor = 0; cursor < html.length;) {
    const start = html.indexOf('<', cursor);
    if (start < 0) break;
    let end = start + 1, quote = '';
    for (; end < html.length; end++) {
      const char = html[end]!;
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    requireEvidence(end < html.length, 'SOURCE_STRUCTURE_UNSUPPORTED');
    const tag = html.slice(start, end + 1);
    cursor = end + 1;
    if (/^<\/div\s*>$/i.test(tag)) {
      const opened = stack.pop();
      requireEvidence(opened !== undefined, 'SOURCE_STRUCTURE_UNSUPPORTED');
      if (opened.warning) result.push({ index: opened.index, contentStart: opened.contentStart, end: cursor });
      continue;
    }
    if (!/^<\/?div\b/i.test(tag)) continue;
    requireEvidence(/^<div\b/i.test(tag) && !/\/\s*>$/.test(tag), 'SOURCE_STRUCTURE_UNSUPPORTED');
    const attrs = tag.replace(/^<div\b/i, '').slice(0, -1);
    const names = new Set<string>();
    let offset = 0;
    while (offset < attrs.length) {
      if (!attrs.slice(offset).trim()) break;
      const match = /^\s+([A-Za-z_:][\w:.-]*)(?:\s*=\s*("[^"]*"|'[^']*'))?/.exec(attrs.slice(offset));
      requireEvidence(match !== null, 'SOURCE_STRUCTURE_UNSUPPORTED');
      const name = match[1]!.toLowerCase();
      requireEvidence(!names.has(name), 'SOURCE_STRUCTURE_UNSUPPORTED');
      names.add(name); offset += match[0].length;
    }
    const xml = `<div${attrs}></div>`;
    requireEvidence(XMLValidator.validate(xml, { allowBooleanAttributes: true }) === true, 'SOURCE_STRUCTURE_UNSUPPORTED');
    const parsed = parser.parse(xml) as { div: Record<string, unknown> | string };
    const entries = typeof parsed.div === 'object' ? Object.entries(parsed.div) : [];
    const classValue = entries.find(([key]) => key.toLowerCase() === '@_class')?.[1];
    requireEvidence(classValue === undefined || typeof classValue === 'string', 'SOURCE_STRUCTURE_UNSUPPORTED');
    const warning = typeof classValue === 'string' && classValue.split(/\s+/).includes('warning');
    stack.push({ index: start, contentStart: cursor, warning });
  }
  requireEvidence(stack.length === 0, 'SOURCE_STRUCTURE_UNSUPPORTED');
  requireEvidence(result.length <= 1, 'DUPLICATE_SOURCE_STRUCTURE');
  return result;
}
