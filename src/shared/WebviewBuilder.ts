import * as crypto from "crypto"
import * as vscode from "vscode"

/**
 * Конфигурация для сборки HTML веб-представления.
 */
export interface IWebviewConfig {
  /** CSS-файл (относительно resources/), undefined — без CSS */
  css?: string
  /** JS-файл (относительно resources/), undefined — без внешнего JS */
  js?: string
  /** Встроенный CSS-блок, undefined — без встроенного CSS */
  inlineCss?: string
  /** Встроенный JS-блок (без тегов script), undefined — без встроенного JS */
  inlineJs?: string
  /** Тело HTML (без head/body) */
  body: string
  /** Язык страницы */
  lang?: string
}

/**
 * Собрать HTML для VS Code webview с единой логикой CSP и nonce.
 * Устраняет дублирование паттерна nonce + CSP между провайдерами.
 */
export function buildWebviewHtml(
  webview: vscode.Webview,
  extUri: vscode.Uri,
  config: IWebviewConfig,
): string {
  const nonce = crypto.randomBytes(16).toString("hex")
  const cspSource = webview.cspSource

  const lang = config.lang ?? "ru"

  let cssLink = ""
  if (config.css) {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extUri, "resources", config.css),
    )
    cssLink = `<link rel="stylesheet" href="${cssUri}">`
  }

  let jsScript = ""
  if (config.js) {
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extUri, "resources", config.js),
    )
    jsScript = `<script nonce="${nonce}" src="${jsUri}"></script>`
  }

  let inlineCssBlock = ""
  if (config.inlineCss) {
    inlineCssBlock = `<style>${config.inlineCss}</style>`
  }

  let inlineJsBlock = ""
  if (config.inlineJs) {
    inlineJsBlock = `<script nonce="${nonce}">${config.inlineJs}</script>`
  }

  const scriptCsp = config.inlineJs || config.js ? `script-src 'nonce-${nonce}';` : `script-src ${cspSource};`
  const styleCsp = config.inlineCss ? `style-src ${cspSource} 'unsafe-inline';` : `style-src ${cspSource};`

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; ${styleCsp} ${scriptCsp}">
  ${cssLink}
  ${inlineCssBlock}
</head>
<body>
  ${config.body}
  ${jsScript}
  ${inlineJsBlock}
</body>
</html>`
}
