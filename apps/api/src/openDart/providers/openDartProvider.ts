import {
  DisclosureQueryDto,
  OpenDartCompanyProfileRaw,
  OpenDartDisclosurePageRaw,
} from '../contracts.js';
import { OpenDartError } from '../errors.js';
import { DisclosureDocumentProvider } from '../document/documentContracts.js';
import { OpenDartHttpClient } from '../openDartHttpClient.js';
import { compactDate } from '../query.js';

export interface CompanyDisclosureProvider {
  getCompanyProfile(corpCode: string): Promise<OpenDartCompanyProfileRaw>;
  getDisclosures(corpCode: string, query: DisclosureQueryDto): Promise<OpenDartDisclosurePageRaw>;
}

export class OpenDartProvider implements CompanyDisclosureProvider, DisclosureDocumentProvider {
  readonly id = 'opendart-fss';

  constructor(private readonly client: OpenDartHttpClient) {}

  async getCompanyProfile(corpCode: string): Promise<OpenDartCompanyProfileRaw> {
    const response = await this.client.getJson<OpenDartCompanyProfileRaw>(
      'company-profile',
      '/api/company.json',
      { corp_code: corpCode },
    );
    if (response.status === '013') {
      throw new OpenDartError('COMPANY_PROFILE_NOT_FOUND', 'company-profile', false, '013');
    }
    return response;
  }

  async getDisclosures(corpCode: string, query: DisclosureQueryDto): Promise<OpenDartDisclosurePageRaw> {
    return this.client.getJson<OpenDartDisclosurePageRaw & Record<string, unknown>>(
      'disclosures',
      '/api/list.json',
      {
        corp_code: corpCode,
        bgn_de: compactDate(query.from),
        end_de: compactDate(query.to),
        last_reprt_at: query.finalOnly ? 'Y' : 'N',
        ...(query.detailCategory
          ? { pblntf_detail_ty: query.detailCategory }
          : query.category ? { pblntf_ty: query.category } : {}),
        sort: 'date',
        sort_mth: 'desc',
        page_no: String(query.page),
        page_count: String(query.pageSize),
      },
    );
  }

  fetchDocumentArchive(receiptNumber: string, signal?: AbortSignal): Promise<Buffer> {
    return this.client.getDocumentArchive(receiptNumber, signal);
  }
}
