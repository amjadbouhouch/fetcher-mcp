import { Browser, Page } from "playwright";
import { JSDOM } from "jsdom";
import { BrowserService } from "../services/browserService.js";
import { WebContentProcessor } from "../services/webContentProcessor.js";
import { FetchOptions } from "../types/index.js";
import { logger } from "../utils/logger.js";

/**
 * Tool definition for extract
 */
export const extractTool = {
  name: "extract",
  description:
    "Extract structured data from a web page using CSS selectors. Automatically detects element types: images return src URLs, links return href URLs, text elements return their content.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "URL to fetch. Make sure to include the schema (http:// or https:// if not defined, preferring https for most cases)",
      },
      fields: {
        type: "object",
        description:
          "Object mapping field names to CSS selectors. Example: {\"productName\": \".product-title\", \"imageUrl\": \"img.product-image\", \"price\": \".price\"}",
        additionalProperties: {
          type: "string",
        },
      },
      timeout: {
        type: "number",
        description:
          "Page loading timeout in milliseconds, default is 30000 (30 seconds)",
      },
      waitUntil: {
        type: "string",
        description:
          "Specifies when navigation is considered complete, options: 'load', 'domcontentloaded', 'networkidle', 'commit', default is 'networkidle'",
      },
      debug: {
        type: "boolean",
        description:
          "Whether to enable debug mode (showing browser window), overrides the --debug command line flag if specified",
      },
    },
    required: ["url", "fields"],
  },
};

/**
 * Smart content extraction based on element type
 */
function extractElementContent(
  element: Element,
  baseUrl: string
): string | null {
  const tagName = element.tagName.toUpperCase();

  // For images, return src attribute
  if (tagName === "IMG") {
    let src = element.getAttribute("src");

    // Skip placeholder/data URI images
    if (src && src.startsWith("data:")) {
      // Try srcset as fallback
      const srcset = element.getAttribute("srcset");
      if (srcset) {
        // Parse first URL from srcset (format: "url 100w, url 200w, ...")
        const firstUrl = srcset.split(",")[0].trim().split(" ")[0];
        src = firstUrl || null;
      } else {
        // No srcset, return null to skip this image
        src = null;
      }
    }

    if (src) {
      // Resolve relative URLs to absolute
      try {
        return new URL(src, baseUrl).toString();
      } catch {
        return src;
      }
    }
    return null;
  }

  // For links, return href attribute
  if (tagName === "A") {
    const href = element.getAttribute("href");
    if (href) {
      // Resolve relative URLs to absolute
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        return href;
      }
    }
    return null;
  }

  // For video/audio/source elements, return src
  if (tagName === "VIDEO" || tagName === "AUDIO" || tagName === "SOURCE") {
    const src = element.getAttribute("src");
    if (src) {
      try {
        return new URL(src, baseUrl).toString();
      } catch {
        return src;
      }
    }
    return null;
  }

  // For everything else (text elements), return text content
  const textContent = element.textContent?.trim();
  return textContent || null;
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

    for (const [fieldName, selector] of Object.entries(fields)) {
      if (typeof selector !== "string") {
        logger.warn(`[Extract] Invalid selector for field '${fieldName}': not a string`);
        result[fieldName] = null;
        continue;
      }

      try {
        const matches = document.querySelectorAll(selector);

        if (matches.length === 0) {
          logger.warn(`[Extract] No elements matched selector for field '${fieldName}': ${selector}`);
          result[fieldName] = null;
        } else {
          // Return FIRST match only (main product, not related products)
          // This ensures we get the primary element, not "similar products" or variants
          let content: string | null = null;

          // Try each match until we find one with valid content
          for (const match of Array.from(matches)) {
            content = extractElementContent(match, url);
            if (content !== null) {
              break; // Found valid content, stop
            }
          }

          result[fieldName] = content;
          logger.info(`[Extract] Field '${fieldName}': extracted from first of ${matches.length} match(es)`);
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
