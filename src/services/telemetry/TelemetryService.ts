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
  private events: Array<{ name: TelemetryEventName; props: TelemetryProps }> = []

  async init(): Promise<void> {}

  capture(name: TelemetryEventName, props: TelemetryProps = {}): void {
    this.events.push({ name, props })
  }

  dispose(): void {
    this.events = []
  }
}
