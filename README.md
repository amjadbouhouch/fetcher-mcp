<div align="center">
  <img src="https://raw.githubusercontent.com/jae-jae/fetcher-mcp/refs/heads/main/icon.svg" width="100" height="100" alt="Fetcher MCP Icon" />
</div>

[中文](https://www.readme-i18n.com/jae-jae/fetcher-mcp?lang=zh) |
[Deutsch](https://www.readme-i18n.com/jae-jae/fetcher-mcp?lang=de) |
[Español](https://www.readme-i18n.com/jae-jae/fetcher-mcp?lang=es) |
[français](https://www.readme-i18n.com/jae-jae/fetcher-mcp?lang=fr) |
[日本語](https://www.readme-i18n.com/jae-jae/fetcher-mcp?lang=ja) |
[한국어](https://www.readme-i18n.com/jae-jae/fetcher-mcp?lang=ko) |
[Português](https://www.readme-i18n.com/jae-jae/fetcher-mcp?lang=pt) |
[Русский](https://www.readme-i18n.com/jae-jae/fetcher-mcp?lang=ru)

# Fetcher MCP

MCP server for fetch web page content using Playwright headless browser.

> 🍴 **This is an enhanced fork of [jae-jae/fetcher-mcp](https://github.com/jae-jae/fetcher-mcp)** with significantly improved HTML cleaning and a simplified API.

## What's Better in This Fork

### 🚀 Enhanced HTML Cleaning (96% Size Reduction)
- **Aggressive content extraction** that reduces HTML from 1MB to ~42KB while preserving essential content
- **Removes bloat**: HTML comments, forms, buttons, pagination, icons, inline SVG, base64 images, hidden elements, empty containers
- **Smart whitespace normalization** for cleaner, more compact output
- **Preserves CSS classes** - Perfect for web scraping workflows that need class selectors
- **Keeps external images** - Maintains `<img>` tags with http/https URLs

### 🎯 Simplified API
- **Cleaner format parameter**: Replaced `extractContent` and `returnHtml` booleans with a single `format` enum (`'html'` | `'markdown'`)
- **Better defaults**: `format: 'markdown'` automatically extracts main content and converts to markdown
- **More intuitive**: Clear intent with `format: 'html'` for raw HTML or `format: 'markdown'` for processed content

### ✨ New Features
- **`get_links` tool**: Extract all clickable links from a webpage with pagination support, regex filtering, and deduplication
- **Better performance**: Faster processing with optimized cleaning pipeline

### 📊 Performance Comparison
| Metric | Original | This Fork | Improvement |
|--------|----------|-----------|-------------|
| HTML Size | ~200KB | ~42KB | 78-96% reduction |
| Noise Removal | Basic | Aggressive | +12 selector patterns |
| Whitespace | Preserved | Normalized | Cleaner output |
| API Parameters | 2 booleans | 1 enum | Simpler |

> 🌟 **Recommended**: [OllaMan](https://ollaman.com/) - Powerful Ollama AI Model Manager.

## Advantages

- **JavaScript Support**: Unlike traditional web scrapers, Fetcher MCP uses Playwright to execute JavaScript, making it capable of handling dynamic web content and modern web applications.

- **Intelligent Content Extraction**: Built-in Readability algorithm automatically extracts the main content from web pages, removing ads, navigation, and other non-essential elements.

- **Flexible Output Format**: Supports both HTML and Markdown output formats, making it easy to integrate with various downstream applications.

- **Parallel Processing**: The `fetch_urls` tool enables concurrent fetching of multiple URLs, significantly improving efficiency for batch operations.

- **Resource Optimization**: Automatically blocks unnecessary resources (images, stylesheets, fonts, media) to reduce bandwidth usage and improve performance.

- **Robust Error Handling**: Comprehensive error handling and logging ensure reliable operation even when dealing with problematic web pages.

- **Configurable Parameters**: Fine-grained control over timeouts, content extraction, and output formatting to suit different use cases.

## Quick Start

Run directly with npx:

```bash
npx -y fetcher-mcp
```

First time setup - install the required browser by running the following command in your terminal:

```bash
npx playwright install chromium
```

### HTTP and SSE Transport

Use the `--transport=http` parameter to start both Streamable HTTP endpoint and SSE endpoint services simultaneously:

```bash
npx -y fetcher-mcp --log --transport=http --host=0.0.0.0 --port=3000
```

After startup, the server provides the following endpoints:

- `/mcp` - Streamable HTTP endpoint (modern MCP protocol)
- `/sse` - SSE endpoint (legacy MCP protocol)

Clients can choose which method to connect based on their needs.

### Debug Mode

Run with the `--debug` option to show the browser window for debugging:

```bash
npx -y fetcher-mcp --debug
```

## Configuration MCP

Configure this MCP server in Claude Desktop:

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "fetcher": {
      "command": "npx",
      "args": ["-y", "fetcher-mcp"]
    }
  }
}
```

## Docker Deployment

### Running with Docker

```bash
docker run -p 3000:3000 ghcr.io/jae-jae/fetcher-mcp:latest
```

### Deploying with Docker Compose

Create a `docker-compose.yml` file:

```yaml
version: "3.8"

services:
  fetcher-mcp:
    image: ghcr.io/jae-jae/fetcher-mcp:latest
    container_name: fetcher-mcp
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    # Using host network mode on Linux hosts can improve browser access efficiency
    # network_mode: "host"
    volumes:
      # For Playwright, may need to share certain system paths
      - /tmp:/tmp
    # Health check
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000"]
      interval: 30s
      timeout: 10s
      retries: 3
```

Then run:

```bash
docker-compose up -d
```

## Features

- `fetch_url` - Retrieve web page content from a specified URL

  - Uses Playwright headless browser to parse JavaScript
  - Supports intelligent extraction of main content and conversion to Markdown
  - Supports the following parameters:
    - `url`: The URL of the web page to fetch (required parameter)
    - `timeout`: Page loading timeout in milliseconds, default is 30000 (30 seconds)
    - `waitUntil`: Specifies when navigation is considered complete, options: 'load', 'domcontentloaded', 'networkidle', 'commit', default is 'networkidle'
    - `format`: Output format - 'markdown' (default, extracts main content and converts to markdown) or 'html' (returns cleaned HTML)
    - `maxLength`: Maximum length of returned content (in characters), default is no limit
    - `waitForNavigation`: Whether to wait for additional navigation after initial page load (useful for sites with anti-bot verification), default is false
    - `navigationTimeout`: Maximum time to wait for additional navigation in milliseconds, default is 10000 (10 seconds)
    - `disableMedia`: Whether to disable media resources (images, stylesheets, fonts, media), default is true
    - `debug`: Whether to enable debug mode (showing browser window), overrides the --debug command line flag if specified

- `get_links` - Extract all clickable links from a specified web page
  - Returns up to 100 links at a time with pagination support
  - Extracts links from anchors, image maps, data-href attributes, and onclick handlers
  - Deduplicates and converts to absolute URLs
  - Supports the following parameters:
    - `url`: The URL of the web page to fetch (required parameter)
    - `timeout`: Page loading timeout in milliseconds, default is 30000 (30 seconds)
    - `waitUntil`: When navigation is considered complete, default is 'networkidle'
    - `offset`: Starting position for results (0-based), use to fetch next batch, default is 0
    - `search`: Optional regex pattern to filter links by URL or title (case-insensitive)

- `browser_install` - Install Playwright Chromium browser binary automatically

  - Installs required Chromium browser binary when not available
  - Automatically suggested when browser installation errors occur
  - Supports the following parameters:
    - `withDeps`: Install system dependencies required by Chromium browser, default is false
    - `force`: Force installation even if Chromium is already installed, default is false

## Tips

### Handling Special Website Scenarios

#### Dealing with Anti-Crawler Mechanisms

- **Wait for Complete Loading**: For websites using CAPTCHA, redirects, or other verification mechanisms, include in your prompt:

  ```
  Please wait for the page to fully load
  ```

  This will use the `waitForNavigation: true` parameter.

- **Increase Timeout Duration**: For websites that load slowly:
  ```
  Please set the page loading timeout to 60 seconds
  ```
  This adjusts both `timeout` and `navigationTimeout` parameters accordingly.

#### Content Retrieval Adjustments

- **Return Content as HTML**: When HTML format is needed instead of default Markdown:

  ```
  Please return the content in HTML format
  ```

  Sets `format: 'html'` to return cleaned HTML without markdown conversion.

- **Return Content as Markdown**: Default behavior, but can be explicitly requested:
  ```
  Please return the content in Markdown format
  ```
  Sets `format: 'markdown'` to extract main content and convert to markdown.

### Debugging and Authentication

#### Enabling Debug Mode

- **Dynamic Debug Activation**: To display the browser window during a specific fetch operation:
  ```
  Please enable debug mode for this fetch operation
  ```
  This sets `debug: true` even if the server was started without the `--debug` flag.

#### Using Custom Cookies for Authentication

- **Manual Login**: To login using your own credentials:

  ```
  Please run in debug mode so I can manually log in to the website
  ```

  Sets `debug: true` or uses the `--debug` flag, keeping the browser window open for manual login.

- **Interacting with Debug Browser**: When debug mode is enabled:

  1. The browser window remains open
  2. You can manually log into the website using your credentials
  3. After login is complete, content will be fetched with your authenticated session

- **Enable Debug for Specific Requests**: Even if the server is already running, you can enable debug mode for a specific request:
  ```
  Please enable debug mode for this authentication step
  ```
  Sets `debug: true` for this specific request only, opening the browser window for manual login.

## Development

### Install Dependencies

```bash
npm install
```

### Install Playwright Browser

Install the browsers needed for Playwright:

```bash
npm run install-browser
```

### Build the Server

```bash
npm run build
```

## Debugging

Use MCP Inspector for debugging:

```bash
npm run inspector
```

You can also enable visible browser mode for debugging:

```bash
node build/index.js --debug
```

## Related Projects

- [g-search-mcp](https://github.com/jae-jae/g-search-mcp): A powerful MCP server for Google search that enables parallel searching with multiple keywords simultaneously. Perfect for batch search operations and data collection.

## License

Licensed under the [MIT License](https://choosealicense.com/licenses/mit/)

[![Powered by DartNode](https://dartnode.com/branding/DN-Open-Source-sm.png)](https://dartnode.com "Powered by DartNode - Free VPS for Open Source")
