/**
 * Статические схемы действий — данные без логики (SRP).
 */
export interface IActionSchema {
  name: string
  editorCommandId: string
  codeActionCommandId: string
  noSelectionMessage: string
  requireSelection: boolean
}

export const EDITOR_ACTION_SCHEMAS: IActionSchema[] = [
  {
    name: "explainCode",
    editorCommandId: "neuralTowerAgent.explainCode",
    codeActionCommandId: "neuralTowerAgent.codeAction.explain",
    noSelectionMessage: "Выберите код для объяснения",
    requireSelection: true,
  },
  {
    name: "fixCode",
    editorCommandId: "neuralTowerAgent.fixCode",
    codeActionCommandId: "neuralTowerAgent.codeAction.fix",
    noSelectionMessage: "Выберите код для исправления",
    requireSelection: true,
  },
  {
    name: "improveCode",
    editorCommandId: "neuralTowerAgent.improveCode",
    codeActionCommandId: "neuralTowerAgent.codeAction.improve",
    noSelectionMessage: "Выберите код для улучшения",
    requireSelection: true,
  },
  {
    name: "addToContext",
    editorCommandId: "neuralTowerAgent.addToContext",
    codeActionCommandId: "neuralTowerAgent.codeAction.addToContext",
    noSelectionMessage: "",
    requireSelection: false,
  },
]
