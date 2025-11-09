import { browserInstall, browserInstallTool } from './browserInstall.js';
import { fetchUrl, fetchUrlTool } from './fetchUrl.js';
import { getLinks, getLinksTool } from './getLink.js';

// Export tool definitions
export const tools = [
  fetchUrlTool,
  browserInstallTool,
  getLinksTool
];

// Export tool implementations
export const toolHandlers = {
  [fetchUrlTool.name]: fetchUrl,
  [browserInstallTool.name]: browserInstall,
  [getLinksTool.name]: getLinks
};