import { CompanyMarket, CompanyProfileDto, CorpCodeRecord, OpenDartCompanyProfileRaw } from '../contracts.js';
import { OpenDartError } from '../errors.js';

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function mapCompanyMarket(value: unknown): CompanyMarket {
  return value === 'Y' ? 'KOSPI'
    : value === 'K' ? 'KOSDAQ'
      : value === 'N' ? 'KONEX'
        : value === 'E' ? 'OTHER'
          : 'UNKNOWN';
}

function dateOnly(value: unknown): string | null {
  const text = optionalText(value);
  if (!text) return null;
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (!match) return null;
  const formatted = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${formatted}T00:00:00Z`);
  return parsed.toISOString().slice(0, 10) === formatted ? formatted : null;
}

function safeUrl(value: unknown): string | null {
  const text = optionalText(value);
  if (!text) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function mapCompanyProfile(
  symbol: string,
  record: CorpCodeRecord,
  raw: OpenDartCompanyProfileRaw,
): CompanyProfileDto {
  const legalName = optionalText(raw.corp_name);
  const displayName = optionalText(raw.stock_name) ?? legalName;
  if (!legalName || !displayName || raw.stock_code !== symbol) {
    throw new OpenDartError('OPENDART_BAD_RESPONSE', 'company-profile', false);
  }
  return {
    symbol,
    corpCode: record.corpCode,
    legalName,
    englishName: optionalText(raw.corp_name_eng),
    displayName,
    chiefExecutive: optionalText(raw.ceo_nm),
    market: mapCompanyMarket(raw.corp_cls),
    industryCode: optionalText(raw.induty_code),
    establishedDate: dateOnly(raw.est_dt),
    fiscalYearEndMonth: /^(0[1-9]|1[0-2])$/.test(optionalText(raw.acc_mt) ?? '')
      ? optionalText(raw.acc_mt)
      : null,
    websiteUrl: safeUrl(raw.hm_url),
    irUrl: safeUrl(raw.ir_url),
    companyInfoModifiedDate: record.companyInfoModifiedDate,
  };
}
