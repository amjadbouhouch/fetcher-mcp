import { browserInstall, browserInstallTool } from './browserInstall.js';
import { fetchUrl, fetchUrlTool } from './fetchUrl.js';
import { getLinks, getLinksTool } from './getLink.js';
import { extract, extractTool } from './extract.js';

// Export tool definitions
export const tools = [
  fetchUrlTool,
  browserInstallTool,
  getLinksTool,
  extractTool
];

// Export tool implementations
export const toolHandlers = {
  [fetchUrlTool.name]: fetchUrl,
  [browserInstallTool.name]: browserInstall,
  [getLinksTool.name]: getLinks,
  [extractTool.name]: extract
};