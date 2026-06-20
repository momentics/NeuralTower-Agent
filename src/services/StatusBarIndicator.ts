import * as vscode from "vscode"

/**
 * Базовый класс для индикаторов в строке состояния.
 *
 * Инкапсулирует создание, обновление и удаление StatusBarItem,
 * чтобы избежать дублирования кода в IndexingStatusBar и BackendHealthMonitor.
 */
export abstract class StatusBarIndicator {
  protected readonly statusBar: vscode.StatusBarItem

  constructor(
    alignment: vscode.StatusBarAlignment,
    priority: number,
    command?: string,
    tooltip?: string,
  ) {
    this.statusBar = vscode.window.createStatusBarItem(alignment, priority)
    if (command) {
      this.statusBar.command = command
    }
    if (tooltip) {
      this.statusBar.tooltip = tooltip
    }
  }

  /** Обновить текст индикатора. */
  protected setText(text: string): void {
    this.statusBar.text = text
  }

  /** Обновить цвет индикатора. */
  protected setColor(color: vscode.ThemeColor | string | undefined): void {
    this.statusBar.color = color
  }

  /** Обновить всплывающую подсказку. */
  protected setTooltip(tooltip: string | vscode.MarkdownString): void {
    this.statusBar.tooltip = tooltip
  }

  /** Показать индикатор. */
  protected show(): void {
    this.statusBar.show()
  }

  /** Скрыть индикатор. */
  protected hide(): void {
    this.statusBar.hide()
  }

  /** Удалить индикатор. */
  public dispose(): void {
    this.statusBar.dispose()
  }
}
