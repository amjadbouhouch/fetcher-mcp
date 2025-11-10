import { Browser, Page } from "playwright";
import { JSDOM } from "jsdom";
import { BrowserService } from "../services/browserService.js";
import { WebContentProcessor } from "../services/webContentProcessor.js";
import { FetchOptions } from "../types/index.js";
import { logger } from "../utils/logger.js";

/**
 * Tool definition for extract
 */
/**
 * Tool definition for extract
 */
export const extractTool = {
  name: "extract",
  description:
    "Extract structured data from a web page using CSS selectors. Supports optional 'attr' to extract specific attributes (e.g. src, href). Automatically detects element types otherwise.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "URL to fetch. Must include http(s):// prefix.",
      },
      fields: {
        type: "object",
        description: "Object mapping field names to { selector, attr?, regex?, regexFlags?, allMatches? }. Examples: {\"image\": {\"selector\": \"img.main\", \"attr\": \"src\"}, \"sku\": {\"selector\": \"body\", \"regex\": \"/([0-9]+)-\"}, \"tags\": {\"selector\": \".tags\", \"regex\": \"#(\\\\w+)\", \"regexFlags\": \"g\", \"allMatches\": true}}",
        additionalProperties: {
          type: "object",
          properties: {
            selector: { type: "string" },
            attr: { type: "string", description: "Attribute name to extract (e.g. 'src', 'href')" },
            regex: { type: "string", description: "Regex pattern to extract specific value. Use capture groups to specify what to extract." },
            regexFlags: { type: "string", description: "Regex flags like 'i' (case-insensitive), 'g' (global), 'm' (multiline)" },
            allMatches: { type: "boolean", description: "If true, return array of all matches instead of just the first match" },
          },
          required: ["selector"],
        },
      },
      timeout: { type: "number", description: "Timeout in ms, default 30000" },
      waitUntil: {
        type: "string",
        description: "When navigation completes: 'load', 'domcontentloaded', 'networkidle', or 'commit'",
      },
      debug: { type: "boolean", description: "Enable debug mode" },
    },
    required: ["url", "fields"],
  },
};


/**
 * Apply regex pattern to extract specific value from text
 */
function applyRegex(
  text: string,
  pattern: string,
  flags?: string,
  allMatches?: boolean
): string | string[] | null {
  try {
    const regex = new RegExp(pattern, flags);

    if (allMatches) {
      // Return all matches as array
      const matches = Array.from(text.matchAll(new RegExp(pattern, flags + (flags?.includes('g') ? '' : 'g'))));
      if (matches.length === 0) return null;

      // Return first capture group if exists, otherwise full match
      return matches.map(match => match[1] !== undefined ? match[1] : match[0]);
    } else {
      // Return first match only
      const match = text.match(regex);
      if (!match) return null;

      // Return first capture group if exists, otherwise full match
      return match[1] !== undefined ? match[1] : match[0];
    }
  } catch (error) {
    logger.error(`[Extract] Invalid regex pattern: ${pattern}`);
    return null;
  }
}

/**
 * Extract text content from element
 */
function extractElementContent(
  element: Element,
  regexPattern?: string,
  regexFlags?: string,
  allMatches?: boolean
): string | string[] | null {
  const textContent = element.textContent?.trim();
  if (!textContent) return null;

  // Apply regex if provided
  if (regexPattern) {
    return applyRegex(textContent, regexPattern, regexFlags, allMatches);
  }

  return textContent;
}

/**
 * Extract attribute value from element as plain text
 */
function extractAttribute(
  element: Element,
  attrName: string,
  regexPattern?: string,
  regexFlags?: string,
  allMatches?: boolean
): string | string[] | null {
  const value = element.getAttribute(attrName);
  if (!value?.trim()) return null;

  const trimmedValue = value.trim();

  // Apply regex if provided
  if (regexPattern) {
    return applyRegex(trimmedValue, regexPattern, regexFlags, allMatches);
  }

  return trimmedValue;
}

/**
 * Implementation of the extract tool
 */
export async function extract(args: any) {
  const rawUrl = String(args?.url || "").trim();
  if (!rawUrl) {
    logger.error(`[Extract] URL parameter missing`);
    throw new Error("URL parameter is required");
  }

  // Ensure URL has a scheme; prefer https
  const url = /^(https?:)\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  const fields = args?.fields;
  if (!fields || typeof fields !== "object" || Object.keys(fields).length === 0) {
    logger.error(`[Extract] fields parameter missing or empty`);
    throw new Error("fields parameter is required and must be a non-empty object");
  }

  const options: FetchOptions = {
    timeout: Number(args?.timeout) || 30000,
    waitUntil: String(args?.waitUntil || "networkidle") as
      | "load"
      | "domcontentloaded"
      | "networkidle"
      | "commit",
    format: "html",
    onlyMainContent: true, // Apply aggressive HTML cleaning
    maxLength: 0,
    waitForNavigation: false,
    navigationTimeout: 10000,
    disableMedia: true,
    debug: args?.debug,
  };

  const browserService = new BrowserService(options);
  let browser: Browser | null = null;
  let page: Page | null = null;

  if (browserService.isInDebugMode()) {
    logger.debug(`[Extract] Debug mode enabled for URL: ${url}`);
  }

  try {
    // Create browser and navigate
    browser = await browserService.createBrowser();
    const { context, viewport } = await browserService.createContext(browser);
    page = await browserService.createPage(context, viewport);

    page.setDefaultTimeout(options.timeout);

    logger.info(`[Extract] Navigating to URL: ${url}`);
    try {
      await page.goto(url, {
        timeout: options.timeout,
        waitUntil: options.waitUntil,
      });
    } catch (gotoError: any) {
      // If timeout occurs, attempt to proceed to extract whatever is available
      if ((gotoError?.message || "").toLowerCase().includes("timeout")) {
        logger.warn(
          `[Extract] Navigation timeout; attempting to extract data from current DOM...`
        );
      } else {
        throw gotoError;
      }
    }

    // Small delay to allow late DOM updates
    await page.waitForTimeout(300);

    // Get page HTML content
    let html = await page.content();

    // Apply aggressive HTML cleaning to improve extraction accuracy
    const processor = new WebContentProcessor(options, "[Extract]");
    html = processor.cleanHtml(html, url);
    logger.info(`[Extract] HTML cleaned before extraction`);

    // Parse cleaned HTML with JSDOM
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;

    // Extract data for each field
    const result: Record<string, string | string[] | null> = {};

    for (const [fieldName, fieldConfig] of Object.entries(fields)) {
      // Parse field configuration: object with {selector, attr?, regex?, regexFlags?, allMatches?}
      if (typeof fieldConfig !== "object" || fieldConfig === null) {
        logger.warn(`[Extract] Invalid field config for '${fieldName}': must be an object with 'selector' property`);
        result[fieldName] = null;
        continue;
      }

      const configObj = fieldConfig as {
        selector?: unknown;
        attr?: unknown;
        regex?: unknown;
        regexFlags?: unknown;
        allMatches?: unknown;
      };

      if (typeof configObj.selector !== "string") {
        logger.warn(`[Extract] Invalid selector for field '${fieldName}': missing or invalid selector property`);
        result[fieldName] = null;
        continue;
      }

      const selector = configObj.selector;
      const attrName = typeof configObj.attr === "string" ? configObj.attr : undefined;
      const regexPattern = typeof configObj.regex === "string" ? configObj.regex : undefined;
      const regexFlags = typeof configObj.regexFlags === "string" ? configObj.regexFlags : undefined;
      const allMatches = typeof configObj.allMatches === "boolean" ? configObj.allMatches : undefined;

      try {
        const matches = document.querySelectorAll(selector);

        if (matches.length === 0) {
          logger.warn(`[Extract] No elements matched selector for field '${fieldName}': ${selector}`);
          result[fieldName] = null;
        } else if (allMatches) {
          // Extract from ALL matching elements and return as array
          const allContents: string[] = [];

          for (const match of Array.from(matches)) {
            let content: string | string[] | null = null;

            if (attrName) {
              // Extract specific attribute (regex allMatches applies to text within single element)
              content = extractAttribute(match, attrName, regexPattern, regexFlags, false);
            } else {
              // Extract text content (regex allMatches applies to text within single element)
              content = extractElementContent(match, regexPattern, regexFlags, false);
            }

            // If content is valid, add to results
            if (content !== null) {
              if (Array.isArray(content)) {
                allContents.push(...content);
              } else {
                allContents.push(content);
              }
            }
          }

          result[fieldName] = allContents.length > 0 ? allContents : null;
          const methodUsed = attrName ? `attribute '${attrName}'` : "auto-detection";
          const regexUsed = regexPattern ? ` with regex '${regexPattern}'${regexFlags ? ` (flags: ${regexFlags})` : ''}` : '';
          logger.info(`[Extract] Field '${fieldName}': extracted from all ${matches.length} match(es) using ${methodUsed}${regexUsed}, got ${allContents.length} values`);
        } else {
          // Return FIRST match only (main product, not related products)
          // This ensures we get the primary element, not "similar products" or variants
          let content: string | string[] | null = null;

          // Try each match until we find one with valid content
          for (const match of Array.from(matches)) {
            if (attrName) {
              // Extract specific attribute
              content = extractAttribute(match, attrName, regexPattern, regexFlags, allMatches);
            } else {
              // Extract text content
              content = extractElementContent(match, regexPattern, regexFlags, allMatches);
            }

            if (content !== null) {
              break; // Found valid content, stop
            }
          }

          result[fieldName] = content;
          const methodUsed = attrName ? `attribute '${attrName}'` : "auto-detection";
          const regexUsed = regexPattern ? ` with regex '${regexPattern}'${regexFlags ? ` (flags: ${regexFlags})` : ''}` : '';
          logger.info(`[Extract] Field '${fieldName}': extracted from first of ${matches.length} match(es) using ${methodUsed}${regexUsed}`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`[Extract] Error processing field '${fieldName}' with selector '${selector}': ${errorMsg}`);
        result[fieldName] = null;
      }
    }

    const resultText = JSON.stringify(result, null, 2);

    return {
      content: [{ type: "text", text: resultText }],
    };
  } finally {
    await browserService.cleanup(browser, page);
    if (browserService.isInDebugMode()) {
      logger.debug(`[Extract] Browser and page kept open for debugging. URL: ${url}`);
    }
  }
}
