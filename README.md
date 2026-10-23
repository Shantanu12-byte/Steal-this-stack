# ⚡ StealThisStack (`steal-this-stack`)

> **Live DOM & Computed CSS Reverse-Engineering Engine for AI Coding Agents and Developers.**  
> Extract exact computed CSS tokens, typography, @keyframes animations, WebGL shaders, 3D assets, SVGs, and interactive UI components from any live URL into a ready-to-code Tailwind starter—or feed them directly to **Claude Code**, **Cursor**, and **Antigravity** via MCP.

---

## 💡 Why StealThisStack?

When you paste a URL into standard LLM chatbots or AI coding tools, **they cannot see the compiled CSS or interactive layout**:
1. **Raw HTML scrapers miss compiled CSS:** Modern sites compile styles with CSS Modules, Tailwind, Emotion, or styled-components. Standard AI web fetchers only see unstyled HTML class names and guess generic colors.
2. **Screenshots lack mathematical accuracy:** Visual screenshots hide cubic-bezier timing functions, font weights, letter spacing, backdrop-filter blurs, and vector SVG data.
3. **Bot protection & JS hydration:** `StealThisStack` runs a stealth headless Chromium instance directly on your machine (`window.getComputedStyle()`), capturing **100% ground-truth computed design tokens and DOM blueprints**.

---

## ✨ Key Capabilities

- 🎨 **Ground-Truth Design Token Extraction:** Inspects rendered DOM nodes and CSSOM `:root` variables to extract `#HEX` palettes, gradients, shadows, and border radii.
- 🔤 **Typography Hierarchy:** Resolves exact font families, weights, font sizes, line heights, and letter spacings.
- 🎬 **Runtime Keyframe & Physics Capture:** Extracts active CSS `@keyframes` animations, transitions, and timing functions.
- 🎯 **Interactive Visual Component Picker (`--pick`):** Launches a live browser overlay. Hover over any navbar, card, or hero section and click it once to isolate its exact DOM, computed styles, and AI prompt.
- 🔮 **WebGL Shaders & 3D Asset Interception:** Hooks canvas contexts and intercepts `.glb`, `.gltf`, `.hdr`, and `.splinecode` assets.
- ⚡ **Tailwind Starter Generator:** Generates a ready-to-run project with `tailwind.config.js`, `design-system.json`, and an interactive preview.
- 🤖 **Built-in Model Context Protocol (MCP) Server (`--mcp`):** Provides a direct tool (`steal_design_tokens`) for Claude Code, Cursor, Windsurf, and Antigravity.

---

## 🚀 Quick Start

Run instantly without installation using `npx`:

```bash
# Whole-page design system extraction into a Tailwind starter:
npx steal-this-stack https://linear.app -o ./stolen-stack

# Launch the visual click-to-steal component picker:
npx steal-this-stack https://outsiders-agency.com/ --pick -o ./stolen-stack
```

### Global CLI Installation

```bash
npm install -g steal-this-stack
```

Then run from anywhere:
```bash
steal-this-stack https://stripe.com
steal-this-stack https://linear.app --pick
```

> **Note:** On first run, ensure Playwright Chromium is installed:
> ```bash
> npx playwright install chromium
> ```

---

## 🛠️ CLI Reference

```text
Usage: steal-this-stack [options] [url]

Extract exact computed CSS tokens, fonts, animations, SVGs, and components from any live URL.

Arguments:
  url                  Target website URL to reverse-engineer (e.g., https://linear.app)

Options:
  -o, --output <dir>   Output directory for generated starter repo (default: "./stolen-stack")
  -p, --pick           Launch interactive browser overlay to click and extract a single UI component
  --mcp                Run as a Model Context Protocol (MCP) server for Cursor / Claude Code / Antigravity
  -h, --help           Display help for command
```

---

## 🤖 MCP Integration (Claude Code, Cursor, Antigravity)

Connect `steal-this-stack` directly as an MCP server to let AI coding agents inspect live websites on demand.

### Cursor (`.cursor/mcp.json` or Global Settings)
```json
{
  "mcpServers": {
    "steal-this-stack": {
      "command": "npx",
      "args": ["-y", "steal-this-stack", "--mcp"]
    }
  }
}
```

### Claude Desktop / Claude Code (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "steal-this-stack": {
      "command": "npx",
      "args": ["-y", "steal-this-stack", "--mcp"]
    }
  }
}
```

### Antigravity (`mcp_config.json`)
```json
{
  "mcpServers": {
    "steal-this-stack": {
      "command": "npx",
      "args": ["-y", "steal-this-stack", "--mcp"]
    }
  }
}
```

Now you can instruct your agent:
> *"Use `steal_design_tokens` on `https://linear.app` and build me a landing page hero using its exact typography, colors, and button transitions."*

---

## 📁 Generated Project Structure

When running `steal-this-stack <url> -o ./stolen-stack`:

```text
stolen-stack/
├── tailwind.config.js       # Pre-configured Tailwind theme with live extracted tokens
├── design-system.json       # Complete machine-readable JSON schema (colors, fonts, SVGs)
└── index.html               # Live preview showcase using the extracted tokens
```

When running `steal-this-stack <url> --pick -o ./stolen-stack`:

```text
stolen-stack/
├── picked-component.html    # Studio viewer with responsive stage toggles & multi-agent prompt hub
├── isolated-stage.html      # Sandboxed visual iframe with strict CSS scoping & overflow guards
├── ShaderCanvas.jsx         # Auto-generated React Three Fiber component if WebGL shaders detected
└── assets/                  # Extracted fonts (.woff2) and 3D models (.glb/.gltf)
```

---

## 📄 License

MIT © 2026 StealThisStack Contributors
