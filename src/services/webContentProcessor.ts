import { JSDOM } from "jsdom";
import * as cheerio from "cheerio";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { FetchOptions, FetchResult } from "../types/index.js";
import { logger } from "../utils/logger.js";

// Firecrawl-inspired tag exclusion list for aggressive HTML cleaning
const EXCLUDE_SELECTORS: string[] = [
  'header', 'footer', 'nav', 
  'aside',
  '.header', '.footer', '.sidebar', '#sidebar',
  '.sidebar-section', '.sidebar-content',
  '.sidebar-right', '.sidebar-wrapper',
  '.aside', 
  '.widget', '.widget-area',
  '.modal', '.popup', '.overlay',
  'dialog', 'p-dialog', 'mat-dialog', 'v-dialog', '[role="dialog"]',
  '.ad', '.ads', '.adsbygoogle',
  '.advertisement', '.banner',
  '.social', '.social-media', '.share',
  // '.breadcrumb', '.breadcrumbs',
  '.related', '.related-posts',
  '.comments', '#comments',
  '.cookie', '.cookie-banner',
  '#cookie-notice', '.gdpr',
  '[id*="cookie"]', '[id*="popup"]', '[id*="dialog"]',
  '.newsletter', '.subscription',
  '.search', '#search',
  '.menu', '.navigation',
  // '.promo', '.promotion',
  // Forms and inputs
  // 'form',
  'button',
  'input', 'textarea', 'select',
  // Pagination
  '.pager', '.pagination', '[role="navigation"]',
  // Icons
  'i[class*="icon-"]', '.fa', '[class*="material-icons"]',
  // Dynamic empty containers
  '[id*="messages"]', '[id*="promotions"]',
  // Social sharing
  '.tweet', '.facebook', '.twitter',
  // SVG elements (inline graphics)
  'svg'
];

export class WebContentProcessor {
  private options: FetchOptions;
  private logPrefix: string;

  constructor(options: FetchOptions, logPrefix: string = "") {
    this.options = options;
    this.logPrefix = logPrefix;
  }

  /**
   * Aggressively clean HTML by removing scripts, styles, and unwanted elements
   * Based on Firecrawl's optimization strategy
   * Uses Cheerio for fast HTML parsing and manipulation
   */
  public cleanHtml(html: string, url: string): string {
    try {
      // Remove HTML comments before parsing
      html = html.replace(/<!--[\s\S]*?-->/g, '');

      const $ = cheerio.load(html);
      const sizeBefore = html.length;

      // Remove unwanted tags completely
      ['script', 'style', 'meta', 'noscript', 'link', 'head'].forEach(tag => {
        $(tag).remove();
      });

      // Remove unwanted elements by selector
      EXCLUDE_SELECTORS.forEach(selector => {
        try {
          $(selector).remove();
        } catch (e) {
          // Invalid selector, skip
        }
      });

      // Remove hidden elements
      $('[style*="display:none"], [style*="visibility:hidden"], [aria-hidden="true"]').remove();

      // Remove empty elements
      ['div', 'span', 'p', 'section'].forEach(tag => {
        $(tag).each((_, el) => {
          const $el = $(el);
          if (!$el.text()?.trim() && $el.children().length === 0) {
            $el.remove();
          }
        });
      });

      // Remove base64 encoded images (data:image/...)
      $('img[src^="data:image"]').remove();

      let cleanedHtml = $('body').html() || $.html();

      // Normalize whitespace: remove excessive spaces, tabs, and newlines between tags
      cleanedHtml = cleanedHtml
        // Remove whitespace between tags
        .replace(/>\s+</g, '><')
        // Collapse multiple newlines into single newline
        .replace(/\n\s*\n/g, '\n')
        // Remove tabs
        .replace(/\t/g, '')
        // Trim leading and trailing whitespace
        .trim();

      const sizeAfter = cleanedHtml.length;
      const reduction = sizeBefore > 0 ? Math.round((1 - sizeAfter / sizeBefore) * 100) : 0;

      logger.info(
        `${this.logPrefix} HTML cleaned: ${sizeBefore} → ${sizeAfter} chars (${reduction}% reduction)`
      );

      return cleanedHtml;
    } catch (error) {
      logger.warn(`${this.logPrefix} HTML cleaning failed: ${error}, using original HTML`);
      return html;
    }
  }

  async processPageContent(page: any, url: string): Promise<FetchResult> {
    try {
      // Set timeout
      page.setDefaultTimeout(this.options.timeout);

      // Navigate to URL
      logger.info(`${this.logPrefix} Navigating to URL: ${url}`);
      try {
        await page.goto(url, {
          timeout: this.options.timeout,
          waitUntil: this.options.waitUntil,
        });
      } catch (gotoError: any) {
        // If it's a timeout error, try to retrieve page content
        if (gotoError.message.includes("Timeout") || gotoError.message.includes("timeout")) {
          logger.warn(`${this.logPrefix} Navigation timeout: ${gotoError.message}. Attempting to retrieve content anyway...`);
          
          // Try to retrieve page content
          try {
            // Directly get page information without waiting for page stability
            const { pageTitle, html } = await this.safelyGetPageInfo(page, url);
            
            // If content is retrieved, process and return it
            if (html && html.trim().length > 0) {
              logger.info(`${this.logPrefix} Successfully retrieved content despite timeout, length: ${html.length}`);

              const processedContent = await this.processContent(html, url, page);
              const formattedContent = processedContent;

              return {
                success: true,
                content: formattedContent,
              };
            }
          } catch (retrieveError: any) {
            logger.error(`${this.logPrefix} Failed to retrieve content after timeout: ${retrieveError.message}`);
          }
        }
        
        // If unable to retrieve content or it's not a timeout error, continue to throw the original error
        throw gotoError;
      }

      // Handle possible anti-bot verification and redirection
      if (this.options.waitForNavigation) {
        logger.info(
          `${this.logPrefix} Waiting for possible navigation/redirection...`
        );

        try {
          // Create a promise to wait for page navigation events
          const navigationPromise = page.waitForNavigation({
            timeout: this.options.navigationTimeout,
            waitUntil: this.options.waitUntil,
          });

          // Set a timeout
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error("Navigation timeout"));
            }, this.options.navigationTimeout);
          });

          // Wait for navigation event or timeout, whichever occurs first
          await Promise.race([navigationPromise, timeoutPromise])
            .then(() => {
              logger.info(
                `${this.logPrefix} Page navigated/redirected successfully`
              );
            })
            .catch((e) => {
              // If timeout occurs but page may have already loaded, we can continue
              logger.warn(
                `${this.logPrefix} No navigation occurred or navigation timeout: ${e.message}`
              );
            });
        } catch (navError: any) {
          logger.error(
            `${this.logPrefix} Error waiting for navigation: ${navError.message}`
          );
          // Continue processing the page even if there are navigation issues
        }
      }

      // Wait for the page to stabilize before getting content
      await this.ensurePageStability(page);

      // Safely retrieve page title and content
      const { pageTitle, html } = await this.safelyGetPageInfo(page, url);

      if (!html) {
        logger.warn(`${this.logPrefix} Browser returned empty content`);
        return {
          success: false,
          content: `Title: Error\nURL: ${url}\nContent:\n\n<error>Failed to retrieve web page content: Browser returned empty content</error>`,
          error: "Browser returned empty content",
        };
      }

      logger.info(
        `${this.logPrefix} Successfully retrieved web page content, length: ${html.length}`
      );

      const processedContent = await this.processContent(html, url, page);

      // Format the response
      const formattedContent = processedContent;

      return {
        success: true,
        content: formattedContent,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error(`${this.logPrefix} Error: ${errorMessage}`);

      return {
        success: false,
        content: `Title: Error\nURL: ${url}\nContent:\n\n<error>Failed to retrieve web page content: ${errorMessage}</error>`,
        error: errorMessage,
      };
    }
  }

  // Added method: Ensure page stability
  private async ensurePageStability(page: any): Promise<void> {
    try {
      // Check if there are ongoing network requests or navigation
      await page.waitForFunction(
        () => {
          return window.document.readyState === 'complete';
        },
        { timeout: this.options.timeout }
      );

      // Wait an extra short time to ensure page stability
      await page.waitForTimeout(500);

      logger.info(`${this.logPrefix} Page has stabilized`);
    } catch (error) {
      logger.warn(`${this.logPrefix} Error ensuring page stability: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Added method: Dismiss modals/dialogs by simulating Escape key
  private async dismissModals(page: any): Promise<void> {
    try {
      logger.info(`${this.logPrefix} Attempting to dismiss any modals/dialogs`);

      // Press Escape key multiple times to handle nested modals
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Escape');
        // Wait a bit for modal to close and any animations to complete
        await page.waitForTimeout(500);
      }

      // Wait for any transitions/animations to complete
      await page.waitForTimeout(1000);

      logger.info(`${this.logPrefix} Modal dismissal attempt completed`);
    } catch (error) {
      logger.warn(`${this.logPrefix} Error dismissing modals: ${error instanceof Error ? error.message : String(error)}`);
      // Continue even if modal dismissal fails - content might still be accessible
    }
  }

  // Added method: Safely get page information (title and HTML content)
  private async safelyGetPageInfo(page: any, _url: string, retries = 3): Promise<{pageTitle: string, html: string}> {
    let pageTitle = "Untitled";
    let html = "";
    let attempt = 0;
    
    while (attempt < retries) {
      try {
        attempt++;
        
        // Get page title
        pageTitle = await page.title();
        logger.info(`${this.logPrefix} Page title: ${pageTitle}`);
        
        // Get HTML content
        html = await page.content();
        
        // If successfully retrieved, exit the loop
        return { pageTitle, html };
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Check if it's an "execution context was destroyed" error
        if (errorMessage.includes("Execution context was destroyed") && attempt < retries) {
          logger.warn(`${this.logPrefix} Context destroyed, waiting for navigation to complete (attempt ${attempt}/${retries})...`);
          
          // Wait for page to stabilize
          await new Promise(resolve => setTimeout(resolve, 1000));
          await this.ensurePageStability(page);
          
          // If it's the last retry attempt, log the error but continue
          if (attempt === retries) {
            logger.error(`${this.logPrefix} Failed to get page info after ${retries} attempts`);
          }
        } else {
          // Other errors, log and rethrow
          logger.error(`${this.logPrefix} Error getting page info: ${errorMessage}`);
          throw error;
        }
      }
    }
    
    return { pageTitle, html };
  }

  private async processContent(html: string, url: string, page?: any): Promise<string> {
    let contentToProcess = html;

    // Apply aggressive HTML cleaning if enabled
    if (this.options.onlyMainContent) {
      contentToProcess = this.cleanHtml(contentToProcess, url);

      // If cleanup resulted in empty or very small content, try dismissing modals and retry
      const MIN_CONTENT_LENGTH = 100;
      if (contentToProcess.trim().length < MIN_CONTENT_LENGTH && page) {
        logger.warn(
          `${this.logPrefix} Cleaned content is too small (${contentToProcess.trim().length} chars), attempting to dismiss modals and retry`
        );

        // Dismiss modals
        await this.dismissModals(page);

        // Get fresh HTML after modal dismissal
        const { html: freshHtml } = await this.safelyGetPageInfo(page, url);

        if (freshHtml && freshHtml.length > 0) {
          logger.info(`${this.logPrefix} Re-extracted content after modal dismissal, length: ${freshHtml.length}`);
          // Clean the fresh HTML
          contentToProcess = this.cleanHtml(freshHtml, url);
          logger.info(`${this.logPrefix} Re-cleaned content length: ${contentToProcess.length}`);
        }
      }
    }

    // For markdown format, extract main content and convert to markdown
    if (this.options.format === 'markdown') {
      // Extract main content using Readability
      // NOTE: jsdom is retained here because @mozilla/readability requires a real DOM Document object.
      // Cheerio cannot be used as it doesn't provide the standard DOM API that Readability expects.
      logger.info(`${this.logPrefix} Extracting main content`);
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (!article) {
        logger.warn(
          `${this.logPrefix} Could not extract main content, will use full HTML`
        );
      } else {
        contentToProcess = article.content;
        logger.info(
          `${this.logPrefix} Successfully extracted main content, length: ${contentToProcess.length}`
        );
      }

      // Convert to markdown
      logger.info(`${this.logPrefix} Converting to Markdown`);
      const turndownService = new TurndownService();
      contentToProcess = turndownService.turndown(contentToProcess);
      logger.info(
        `${this.logPrefix} Successfully converted to Markdown, length: ${contentToProcess.length}`
      );

      // Apply search filter if provided
      if (this.options.search) {
        try {
          const searchRegex = new RegExp(this.options.search, 'i');
          const lines = contentToProcess.split('\n');
          const filteredLines = lines.filter((line) => searchRegex.test(line));
          const linesBefore = lines.length;
          contentToProcess = filteredLines.join('\n');
          logger.info(
            `${this.logPrefix} Search filter applied: ${linesBefore} lines → ${filteredLines.length} lines matching pattern`
          );
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error(`${this.logPrefix} Error applying search filter: ${errorMsg}`);
          // Continue with unfiltered content if regex fails
        }
      }
    }
    // For html format, return the HTML as-is (already cleaned if onlyMainContent was true)

    // Truncate if needed
    if (
      this.options.maxLength > 0 &&
      contentToProcess.length > this.options.maxLength
    ) {
      logger.info(
        `${this.logPrefix} Content exceeds maximum length, will truncate to ${this.options.maxLength} characters`
      );
      contentToProcess = contentToProcess.substring(0, this.options.maxLength);
    }

    return contentToProcess;
  }
}
