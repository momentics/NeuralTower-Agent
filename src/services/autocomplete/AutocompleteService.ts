import type { Plugin } from "../../shared/types"

/** Заглушка: сервис автозавершения. */
export class AutocompleteService implements Plugin {
  name = "autocomplete"
  version = "0.1.0"

  async init(): Promise<void> {}
  dispose(): void {}
}
