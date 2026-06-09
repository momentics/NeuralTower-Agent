import type { Plugin } from "../../shared/types"

export type TelemetryEventName =
  | "session_started"
  | "message_sent"
  | "error_occurred"

export interface TelemetryProps {
  [key: string]: string | number | boolean
}

/** Заглушка: собирает события только в памяти. */
export class TelemetryService implements Plugin {
  name = "telemetry"
  version = "0.1.0"
  private static _instance: TelemetryService | undefined
  private events: Array<{ name: TelemetryEventName; props: TelemetryProps }> = []

  static get(): TelemetryService {
    if (!TelemetryService._instance) TelemetryService._instance = new TelemetryService()
    return TelemetryService._instance
  }

  async init(): Promise<void> {}

  capture(name: TelemetryEventName, props: TelemetryProps = {}): void {
    this.events.push({ name, props })
  }

  dispose(): void {
    this.events = []
  }
}
