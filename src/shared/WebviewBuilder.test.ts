import { describe, it, expect } from "vitest"
import { buildWebviewHtml } from "./WebviewBuilder"

function createMockWebview() {
  return {
    cspSource: "https://csp.test",
    asWebviewUri: (uri: { fsPath: string }) => `webview-uri:${uri.fsPath}`,
  }
}

describe("buildWebviewHtml", () => {
  it("resolves js relative to extension root", () => {
    const html = buildWebviewHtml(createMockWebview() as never, { fsPath: "/ext" } as never, {
      body: "<div>test</div>",
      js: "out/webview/chat.js",
    })
    expect(html).toContain("out/webview/chat.js")
    expect(html).toMatch(/script nonce="[a-f0-9]+"/)
    expect(html).toContain("script-src 'nonce-")
  })

  it("resolves css relative to resources", () => {
    const html = buildWebviewHtml(createMockWebview() as never, { fsPath: "/ext" } as never, {
      body: "<div>test</div>",
      css: "chat.css",
    })
    expect(html).toContain("resources/chat.css")
  })

  it("does not emit inline-unsafe script policy when external js is used", () => {
    const html = buildWebviewHtml(createMockWebview() as never, { fsPath: "/ext" } as never, {
      body: "<div>test</div>",
      js: "out/webview/chat.js",
    })
    expect(html).not.toContain("script-src 'unsafe-inline'")
  })
})
