import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';

export interface MarkdownExportResponse {
  destinationPath: string;
}

export interface MarkdownPdfExportOptions {
  orientation?: 'portrait' | 'landscape';
  scale?: number;
  background?: boolean;
  pageWidth?: number;
  pageHeight?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
}

export interface ExportMarkdownHtmlRequest {
  destinationPath: string;
  html: string;
}

export interface ExportMarkdownPdfRequest {
  destinationPath: string;
  html: string;
  options?: MarkdownPdfExportOptions;
}

export class MarkdownExportAPI {
  async exportHtml(request: ExportMarkdownHtmlRequest): Promise<MarkdownExportResponse> {
    try {
      return await api.invoke<MarkdownExportResponse>('export_markdown_html', { request });
    } catch (error) {
      throw createTauriCommandError('export_markdown_html', error, {
        destinationPath: request.destinationPath,
        html: '[redacted]',
      });
    }
  }

  async exportPdf(request: ExportMarkdownPdfRequest): Promise<MarkdownExportResponse> {
    try {
      return await api.invoke<MarkdownExportResponse>('export_markdown_pdf', { request });
    } catch (error) {
      throw createTauriCommandError('export_markdown_pdf', error, {
        destinationPath: request.destinationPath,
        html: '[redacted]',
        options: request.options,
      });
    }
  }
}

export const markdownExportAPI = new MarkdownExportAPI();
