import { OpenDartError, OpenDartErrorCode } from '../errors.js';

export interface DecodedFilingXml {
  readonly encoding: 'utf-8';
  readonly text: string;
  readonly hadBom: boolean;
}

export interface FilingXmlCompatibilityResult {
  readonly text: string;
  readonly repairs: {
    readonly bareAmpersandCount: number;
    readonly literalAngleBracketCount: number;
  };
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16_LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16_BE_BOM = Buffer.from([0xfe, 0xff]);
const XML_DECLARATION_PREFIX_BYTES = 512;

function xmlError(code: OpenDartErrorCode, cause?: unknown): OpenDartError {
  return new OpenDartError(
    code,
    'filing-document',
    false,
    undefined,
    cause instanceof Error ? { cause } : undefined,
  );
}

function declaredEncoding(bytes: Buffer, offset: number): string | null {
  const prefix = bytes.subarray(offset, offset + XML_DECLARATION_PREFIX_BYTES).toString('latin1');
  const declaration = /^\s*<\?xml\b([\s\S]*?)\?>/i.exec(prefix);
  if (!declaration) return null;
  return /\bencoding\s*=\s*(['"])([^'"]+)\1/i.exec(declaration[1] ?? '')?.[2]
    ?.trim()
    .toLowerCase() ?? null;
}

function isUtf8Name(value: string): boolean {
  return value === 'utf-8' || value === 'utf8';
}

function hasUnsafeXmlDeclaration(text: string): boolean {
  let cursor = 0;
  while (cursor < text.length) {
    const opening = text.indexOf('<!', cursor);
    if (opening < 0) return false;
    if (text.startsWith('<!--', opening)) {
      const closing = text.indexOf('-->', opening + 4);
      if (closing < 0) return false;
      cursor = closing + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', opening)) {
      const closing = text.indexOf(']]>', opening + 9);
      if (closing < 0) return false;
      cursor = closing + 3;
      continue;
    }
    const declaration = text.slice(opening + 2, opening + 32).trimStart();
    if (/^(?:DOCTYPE|ENTITY)(?:\s|\[|>)/i.test(declaration)) return true;
    cursor = opening + 2;
  }
  return false;
}

function isXml10CodePoint(value: number): boolean {
  return value === 0x09
    || value === 0x0a
    || value === 0x0d
    || (value >= 0x20 && value <= 0xd7ff)
    || (value >= 0xe000 && value <= 0xfffd)
    || (value >= 0x10000 && value <= 0x10ffff);
}

function xmlSafeNumericReplacement(value: number): string {
  switch (value) {
    case 0x22: return '&quot;';
    case 0x26: return '&amp;';
    case 0x27: return '&apos;';
    case 0x3c: return '&lt;';
    case 0x3e: return '&gt;';
    default: return String.fromCodePoint(value);
  }
}

interface EntityReference {
  readonly length: number;
  readonly replacement?: string;
}

function entityReference(text: string, offset: number): EntityReference | null {
  const candidate = text.slice(offset);
  const builtIn = /^&(amp|apos|gt|lt|quot);/.exec(candidate);
  if (builtIn) return { length: builtIn[0].length };

  const numeric = /^&#(x[0-9A-Fa-f]+|[0-9]+);/.exec(candidate);
  if (numeric) {
    const raw = numeric[1]!;
    const value = Number.parseInt(raw.startsWith('x') ? raw.slice(1) : raw, raw.startsWith('x') ? 16 : 10);
    if (!Number.isSafeInteger(value) || !isXml10CodePoint(value)) {
      throw xmlError('OPENDART_DOCUMENT_MALFORMED_XML');
    }
    return {
      length: numeric[0].length,
      replacement: xmlSafeNumericReplacement(value),
    };
  }

  if (/^&#/.test(candidate)) {
    throw xmlError('OPENDART_DOCUMENT_MALFORMED_XML');
  }
  if (/^&[A-Za-z_][A-Za-z0-9_.:-]*;/.test(candidate)) {
    throw xmlError('OPENDART_DOCUMENT_MALFORMED_XML');
  }
  if (/^&[^&<>\s;]+;/.test(candidate)) {
    throw xmlError('OPENDART_DOCUMENT_MALFORMED_XML');
  }
  if (/^&(amp|apos|gt|lt|quot)(?:\s|<|$)/.test(candidate)) {
    throw xmlError('OPENDART_DOCUMENT_MALFORMED_XML');
  }
  return null;
}

export function normalizeOpenDartXmlCompatibility(
  text: string,
): FilingXmlCompatibilityResult {
  type State = 'text' | 'markup' | 'comment' | 'cdata' | 'pi';
  let state: State = 'text';
  let quote: '"' | "'" | null = null;
  let markupStart = -1;
  let cursor = 0;
  let copiedUntil = 0;
  let bareAmpersandCount = 0;
  let literalAngleBracketCount = 0;
  const elementStack: string[] = [];
  const output: string[] = [];

  const escapeBareAmpersand = (): void => {
    const reference = entityReference(text, cursor);
    if (reference) {
      if (reference.replacement !== undefined) {
        output.push(text.slice(copiedUntil, cursor), reference.replacement);
        cursor += reference.length;
        copiedUntil = cursor;
        return;
      }
      cursor += reference.length;
      return;
    }
    output.push(text.slice(copiedUntil, cursor), '&amp;');
    cursor += 1;
    copiedUntil = cursor;
    bareAmpersandCount += 1;
  };

  while (cursor < text.length) {
    if (state === 'text') {
      const spacedAngleLabel = /^<[ \t]+[^<>=/"'\r\n]*\S[ \t]+>/.exec(
        text.slice(cursor),
      );
      const parentTag = elementStack[elementStack.length - 1];
      const compactAngleLabel = parentTag === 'P' || parentTag === 'TD'
        ? /^<([^<>=/"'\r\n]+)>/.exec(text.slice(cursor))
        : null;
      const compactInner = compactAngleLabel?.[1] ?? '';
      const compactEnd = compactAngleLabel ? cursor + compactAngleLabel[0].length : cursor;
      const compactIsObservedTextLabel = Boolean(
        compactAngleLabel
        && /\s/.test(compactInner)
        && /[^\x00-\x7f]/.test(compactInner)
        && new RegExp(`^<\\/${parentTag}\\s*>`, 'i').test(text.slice(compactEnd)),
      );
      const literalAngleLabel = spacedAngleLabel
        ?? (compactIsObservedTextLabel ? compactAngleLabel : null);
      if (literalAngleLabel) {
        output.push(text.slice(copiedUntil, cursor), '&lt;');
        cursor += 1;
        copiedUntil = cursor;
        literalAngleBracketCount += 1;
        continue;
      }
      if (text.startsWith('<!--', cursor)) {
        state = 'comment';
        cursor += 4;
        continue;
      }
      if (text.startsWith('<![CDATA[', cursor)) {
        state = 'cdata';
        cursor += 9;
        continue;
      }
      if (text.startsWith('<?', cursor)) {
        state = 'pi';
        cursor += 2;
        continue;
      }
      if (text[cursor] === '<') {
        state = 'markup';
        markupStart = cursor;
        cursor += 1;
        continue;
      }
      if (text[cursor] === '&') {
        escapeBareAmpersand();
        continue;
      }
      cursor += 1;
      continue;
    }

    if (state === 'comment') {
      if (text.startsWith('-->', cursor)) {
        state = 'text';
        cursor += 3;
      } else {
        cursor += 1;
      }
      continue;
    }
    if (state === 'cdata') {
      if (text.startsWith(']]>', cursor)) {
        state = 'text';
        cursor += 3;
      } else {
        cursor += 1;
      }
      continue;
    }
    if (state === 'pi') {
      if (text.startsWith('?>', cursor)) {
        state = 'text';
        cursor += 2;
      } else {
        cursor += 1;
      }
      continue;
    }

    if (quote) {
      if (text[cursor] === quote) {
        quote = null;
        cursor += 1;
      } else if (text[cursor] === '&') {
        escapeBareAmpersand();
      } else {
        cursor += 1;
      }
      continue;
    }
    if (text[cursor] === '"' || text[cursor] === "'") {
      quote = text[cursor] as '"' | "'";
      cursor += 1;
      continue;
    }
    if (text[cursor] === '>') {
      const markup = text.slice(markupStart + 1, cursor).trim();
      const closing = /^\/\s*([A-Za-z_][A-Za-z0-9:_.-]*)\s*$/.exec(markup);
      const opening = /^([A-Za-z_][A-Za-z0-9:_.-]*)\b/.exec(markup);
      if (closing) {
        const tag = closing[1]!.toUpperCase();
        if (elementStack[elementStack.length - 1] === tag) elementStack.pop();
      } else if (opening && !/\/\s*$/.test(markup)) {
        elementStack.push(opening[1]!.toUpperCase());
      }
      state = 'text';
      markupStart = -1;
      cursor += 1;
      continue;
    }
    if (text[cursor] === '&') {
      throw xmlError('OPENDART_DOCUMENT_MALFORMED_XML');
    }
    cursor += 1;
  }

  if (output.length === 0) {
    return { text, repairs: { bareAmpersandCount: 0, literalAngleBracketCount: 0 } };
  }
  output.push(text.slice(copiedUntil));
  return {
    text: output.join(''),
    repairs: { bareAmpersandCount, literalAngleBracketCount },
  };
}

export function decodeSafeFilingXml(bytes: Buffer): DecodedFilingXml {
  if (bytes.length === 0) {
    throw xmlError('OPENDART_DOCUMENT_INVALID_XML_ENCODING');
  }

  const hasUtf8Bom = bytes.subarray(0, 3).equals(UTF8_BOM);
  const hasUtf16Bom = bytes.subarray(0, 2).equals(UTF16_LE_BOM)
    || bytes.subarray(0, 2).equals(UTF16_BE_BOM);
  const encoding = declaredEncoding(bytes, hasUtf8Bom ? 3 : hasUtf16Bom ? 2 : 0);

  if (hasUtf16Bom) {
    if (encoding && !/^utf-?16(?:le|be)?$/.test(encoding)) {
      throw xmlError('OPENDART_DOCUMENT_INVALID_XML_ENCODING');
    }
    throw xmlError('OPENDART_DOCUMENT_UNSUPPORTED_XML_ENCODING');
  }
  if (bytes.includes(0)) {
    throw xmlError('OPENDART_DOCUMENT_INVALID_XML_ENCODING');
  }
  if (hasUtf8Bom && encoding && !isUtf8Name(encoding)) {
    throw xmlError('OPENDART_DOCUMENT_INVALID_XML_ENCODING');
  }
  if (encoding && !isUtf8Name(encoding)) {
    throw xmlError('OPENDART_DOCUMENT_UNSUPPORTED_XML_ENCODING');
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(
      hasUtf8Bom ? bytes.subarray(3) : bytes,
    );
  } catch (error) {
    throw xmlError('OPENDART_DOCUMENT_INVALID_XML_ENCODING', error);
  }
  if (text.includes('\0')) {
    throw xmlError('OPENDART_DOCUMENT_INVALID_XML_ENCODING');
  }
  for (const character of text) {
    if (!isXml10CodePoint(character.codePointAt(0)!)) {
      throw xmlError('OPENDART_DOCUMENT_MALFORMED_XML');
    }
  }
  if (hasUnsafeXmlDeclaration(text)) {
    throw xmlError('OPENDART_DOCUMENT_UNSAFE_XML');
  }
  return { encoding: 'utf-8', text, hadBom: hasUtf8Bom };
}
