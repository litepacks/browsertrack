/** @type {import('docboot').DocbootConfig} */
export default {
  title: "BrowserTrack",
  description: "Local browser diagnostics shared with coding agents through MCP",
  docs: "./docs",
  out: "./dist-docs",
  theme: {
    preset: "zinc",
    defaultMode: "dark"
  },
  search: {
    fuzzy: 0.2,
    prefix: true,
    maxResults: 10
  }
};
