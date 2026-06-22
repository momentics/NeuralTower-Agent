/**
 * Абстракции над VS Code API для тестируемости.
 */

import * as vscode from "vscode"

// ── Команды ────────────────────────────────────────────────

/**
 * Выполнение VS Code-команд.
 */
export interface ICommandExecutor {
  /** Выполнить команду с аргументами. */
  executeCommand<T>(command: string, ...args: unknown[]): Promise<T | undefined>
}

/**
 * Реализация ICommandExecutor через реальный VS Code API.
 */
export class VscodeCommandExecutor implements ICommandExecutor {
  async executeCommand<T>(command: string, ...args: unknown[]): Promise<T | undefined> {
    return vscode.commands.executeCommand(command, ...args)
  }
}

// ── Конфигурация ───────────────────────────────────────────

/**
 * Чтение и изменение VS Code settings.
 */
export interface IWorkspaceConfiguration {
  /** Получить секцию конфигурации. */
  getSection(section: string): IWorkspaceConfigurationSection
  /** Обновить значение в настройках. */
  update(section: string, key: string, value: unknown, global?: boolean): Promise<void>
}

/**
 * Секция конфигурации.
 */
export interface IWorkspaceConfigurationSection {
  /** Получить значение из секции. */
  get<T>(key: string, defaultValue?: T): T | undefined
  /** Обновить значение в секции. */
  update(key: string, value: unknown, global?: boolean): Promise<void>
}

/**
 * Реализация IWorkspaceConfiguration через реальный VS Code API.
 */
export class VscodeWorkspaceConfiguration implements IWorkspaceConfiguration {
  getSection(section: string): IWorkspaceConfigurationSection {
    return new VscodeConfigurationSection(vscode.workspace.getConfiguration(section))
  }

  async update(section: string, key: string, value: unknown, global?: boolean): Promise<void> {
    await vscode.workspace.getConfiguration(section).update(key, value, global)
  }
}

/**
 * Реализация IWorkspaceConfigurationSection.
 */
class VscodeConfigurationSection implements IWorkspaceConfigurationSection {
  constructor(private readonly cfg: vscode.WorkspaceConfiguration) {}

  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.cfg.get(key, defaultValue)
  }

  async update(key: string, value: unknown, global?: boolean): Promise<void> {
    await this.cfg.update(key, value, global)
  }
}

// ── Документы ──────────────────────────────────────────────

/**
 * Открытие и управление документами.
 */
export interface IDocumentService {
  /** Открыть текстовый документ. */
  openTextDocument(uri: vscode.Uri): Promise<vscode.TextDocument>
  /** Открыть текстовый документ по пути. */
  openTextDocumentByPath(filePath: string): Promise<vscode.TextDocument>
}

/**
 * Реализация IDocumentService через реальный VS Code API.
 */
export class VscodeDocumentService implements IDocumentService {
  async openTextDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument(uri)
  }

  async openTextDocumentByPath(filePath: string): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument(vscode.Uri.file(filePath))
  }
}

// ── Окна ───────────────────────────────────────────────────

/**
 * Отображение сообщений и диалогов.
 */
export interface IWindowService {
  /** Показать информационное сообщение. */
  showInformationMessage(message: string, ...args: (string | vscode.MessageOptions)[]): Thenable<string | undefined>
  /** Показать предупреждение. */
  showWarningMessage(message: string, ...args: (string | vscode.MessageOptions)[]): Thenable<string | undefined>
  /** Показать ошибку. */
  showErrorMessage(message: string, ...args: (string | vscode.MessageOptions)[]): Thenable<string | undefined>
  /** Показать поле ввода. */
  showInputBox(options?: vscode.InputBoxOptions): Thenable<string | undefined>
  /** Показать быстрый выбор. */
  showQuickPick<T extends vscode.QuickPickItem>(items: T[] | Thenable<T[]>, options?: vscode.QuickPickOptions): Thenable<T | undefined>
}

/**
 * Реализация IWindowService через реальный VS Code API.
 */
export class VscodeWindowService implements IWindowService {
  showInformationMessage(message: string, ...args: (string | vscode.MessageOptions)[]): Thenable<string | undefined> {
    return (vscode.window.showInformationMessage as any)(message, ...args)
  }

  showWarningMessage(message: string, ...args: (string | vscode.MessageOptions)[]): Thenable<string | undefined> {
    return (vscode.window.showWarningMessage as any)(message, ...args)
  }

  showErrorMessage(message: string, ...args: (string | vscode.MessageOptions)[]): Thenable<string | undefined> {
    return (vscode.window.showErrorMessage as any)(message, ...args)
  }

  showInputBox(options?: vscode.InputBoxOptions): Thenable<string | undefined> {
    return vscode.window.showInputBox(options)
  }

  showQuickPick<T extends vscode.QuickPickItem>(items: T[] | Thenable<T[]>, options?: vscode.QuickPickOptions): Thenable<T | undefined> {
    return vscode.window.showQuickPick(items, options)
  }
}


