import { Browser, Page } from "playwright";
import * as cheerio from "cheerio";
import { BrowserService } from "../services/browserService.js";
import { FetchOptions } from "../types/index.js";
import { logger } from "../utils/logger.js";

/**
 * Tool definition for get_links
 */
export const getLinksTool = {
  name: "get_links",
  description:
    "Extract clickable links from a specified web page, returning up to 100 absolute URLs sorted alphabetically at a time. Supports pagination via offset parameter.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "URL to fetch. Make sure to include the schema (http:// or https:// if not defined, preferring https for most cases)",
      },
      timeout: {
        type: "number",
        description:
          "Page loading timeout in milliseconds, default is 30000 (30 seconds)",
      },
      // waitUntil: {
      //   type: "string",
      //   description:
      //     "Specifies when navigation is considered complete, options: 'load', 'domcontentloaded', 'networkidle', 'commit', default is 'networkidle'",
      // },
      offset: {
        type: "number",
        description:
          "Starting position for results (0-based). Use to fetch next batch of links. Default: 0",
      },
      search: {
        type: "string",
        description:
          "Optional regex pattern to filter links. Returns links where the pattern matches the URL. Case-insensitive by default.",
      },
    },
    required: ["url"],
  },
};

/**
 * Implementation of the get_links tool
 */
export async function getLinks(args: any) {
  const rawUrl = String(args?.url || "").trim();
  if (!rawUrl) {
    logger.error(`[GetLinks] URL parameter missing`);
    throw new Error("URL parameter is required");
  }

  // Ensure URL has a scheme; prefer https
  const normalizedUrl = /^(https?:)\/\//i.test(rawUrl)
    ? rawUrl
    : `https://${rawUrl}`;

  const offset = Number(args?.offset) || 0;
  const searchPattern = args?.search ? String(args.search).trim() : "";

  // Validate regex pattern if provided
  let searchRegex: RegExp | null = null;
  if (searchPattern) {
    try {
      searchRegex = new RegExp(searchPattern, 'i'); // case-insensitive
      logger.info(`[GetLinks] Using search filter: ${searchPattern}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GetLinks] Invalid regex pattern: ${errorMsg}`);
      throw new Error(`Invalid search regex pattern: ${errorMsg}`);
    }
  }

  const options: FetchOptions = {
    timeout: Number(args?.timeout) || 30000,
    waitUntil: "networkidle",
    // Unused in this tool but required by BrowserService options
    format: "html" as "html" | "markdown",
    onlyMainContent: true, // Not used for link extraction
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
    logger.debug(`[GetLinks] Debug mode enabled for URL: ${normalizedUrl}`);
  }

  try {
    browser = await browserService.createBrowser();
    const { context, viewport } = await browserService.createContext(browser);
    page = await browserService.createPage(context, viewport);

    // Navigate
    page.setDefaultTimeout(options.timeout);
    try {
      await page.goto(normalizedUrl, {
        timeout: options.timeout,
        waitUntil: options.waitUntil,
      });
    } catch (gotoError: any) {
      // If timeout occurs, attempt to proceed to extract whatever is available
      if (
        (gotoError?.message || "").toLowerCase().includes("timeout")
      ) {
        logger.warn(
          `[GetLinks] Navigation timeout; attempting to extract links from current DOM...`
        );
      } else {
        throw gotoError;
      }
    }

    // Small delay to allow late DOM updates
    await page.waitForTimeout(300);

    // Get page HTML content
    const html = await page.content();

    // Parse HTML with Cheerio
    const $ = cheerio.load(html);

    // Extract clickable link targets
    const rawLinks: string[] = [];

    const cleanup = (s: string | null | undefined) =>
      (s || "").replace(/\s+/g, " ").trim();

    // Skip protocols that don't navigate to a web page
    const isSkippable = (href: string) => {
      const h = href.trim().toLowerCase();
      return (
        !h ||
        h === "#" ||
        h.startsWith("#") ||
        h.startsWith("javascript:") ||
        h.startsWith("mailto:") ||
        h.startsWith("tel:") ||
        h.startsWith("data:")
      );
    };

    // Skip media files and assets - only return navigation URLs
    const isAsset = (url: string) => {
      const u = url.toLowerCase();

      // Image extensions
      const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff', '.tif', '.avif', '.heic'];

      // Video extensions
      const videoExts = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v', '.mpg', '.mpeg', '.3gp'];

      // Audio extensions
      const audioExts = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.wma'];

      // Document/Asset extensions
      const assetExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar', '.7z', '.tar', '.gz'];

      // Font extensions
      const fontExts = ['.woff', '.woff2', '.ttf', '.eot', '.otf'];

      // Stylesheet and script files
      const codeExts = ['.css', '.js', '.map', '.json', '.xml'];

      const allExts = [...imageExts, ...videoExts, ...audioExts, ...assetExts, ...fontExts, ...codeExts];

      // Check if URL ends with any asset extension (including query params)
      return allExts.some(ext => {
        const urlPath = u.split('?')[0].split('#')[0]; // Remove query params and fragments
        return urlPath.endsWith(ext);
      });
    };

    const pushLink = (href: string | null | undefined) => {
      const h = cleanup(href);
      if (!h || isSkippable(h)) return;
      rawLinks.push(h);
    };

    // 1) Standard anchors
    $('a[href]').each((_, el) => {
      const $el = $(el);
      pushLink($el.attr('href'));
    });

    // 2) SVG anchors (xlink:href or href)
    $('a[href], a[xlink\\:href]').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href') || $el.attr('xlink:href');
      if (!href) return;
      pushLink(href);
    });

    // 3) Image map areas
    $('area[href]').each((_, el) => {
      const $el = $(el);
      pushLink($el.attr('href'));
    });

    // 4) Elements with data-href
    $('[data-href]').each((_, el) => {
      const $el = $(el);
      pushLink($el.attr('data-href'));
    });

    // 5) Elements with onclick that navigates
    const extractFromOnclick = (s: string): string | null => {
      const str = s || '';
      // window.open('...'), location='...', location.href='...'
      const m1 = str.match(/window\.open\(\s*['"]([^'"]+)['"]/i);
      if (m1) return m1[1];
      const m2 = str.match(/location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i);
      if (m2) return m2[1];
      return null;
    };
    $('[onclick]').each((_, el) => {
      const $el = $(el);
      const href = extractFromOnclick($el.attr('onclick') || '');
      if (!href) return;
      pushLink(href);
    });

    // Resolve to absolute URLs when possible
    const base = new URL(normalizedUrl);

    const toAbsolute = (href: string): string => {
      try {
        // URL with base correctly resolves relative paths
        return new URL(href, base).toString();
      } catch {
        // Fallback conservative handling
        if (/^\/\//.test(href)) {
          return `${base.protocol}${href}`;
        }
        if (/^\//.test(href)) {
          return `${base.origin}${href}`;
        }
        return href; // leave as-is
      }
    };

    // Deduplicate by final URL and filter out assets
    const seen = new Set<string>();
    let allLinks = rawLinks
      .map((href) => toAbsolute(href))
      .filter((url) => {
        // Skip if already seen
        if (seen.has(url)) return false;
        // Skip if it's an asset/media file
        if (isAsset(url)) return false;
        seen.add(url);
        return true;
      });

    // Apply search filter if provided
    if (searchRegex) {
      allLinks = allLinks.filter((url) => searchRegex.test(url));
      logger.info(`[GetLinks] Filter applied: ${allLinks.length} links match the pattern`);
    }

    // Sort links alphabetically
    allLinks.sort();

    // Apply pagination
    const limit = 100;
    const paginatedLinks = allLinks.slice(offset, offset + limit);
    const hasMore = offset + limit < allLinks.length;

    const resultText = JSON.stringify(
      {
        origin: base.origin,
        count: paginatedLinks.length,
        has_more: hasMore,
        links: paginatedLinks
      },
      null,
      2
    );

    return {
      content: [{ type: "text", text: resultText }],
    };
  } finally {
    await browserService.cleanup(browser, page);
    if (browserService.isInDebugMode()) {
      logger.debug(`[GetLinks] Browser and page kept open for debugging. URL: ${normalizedUrl}`);
    }
  }
}
