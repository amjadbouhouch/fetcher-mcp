export type ContentFormat = 'html' | 'markdown';

export interface FetchOptions {
    timeout: number;
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
    format: ContentFormat;
    onlyMainContent: boolean;
    maxLength: number;
    waitForNavigation: boolean;
    navigationTimeout: number;
    disableMedia: boolean;
    debug?: boolean;
    search?: string;
  }
  
  export interface FetchResult {
    success: boolean;
    content: string;
    error?: string;
    index?: number;
  }