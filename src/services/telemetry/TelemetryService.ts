import type { Plugin } from "../../shared/types"

const TELEMETRY_MAX_EVENTS = 1000

export type TelemetryEventName =
  | "session_started"
  | "message_sent"
  | "error_occurred"

export interface TelemetryProps {
  [key: string]: string | number | boolean
}

/** Интерфейс сервиса телеметрии. */
export interface ITelemetryService {
  capture(name: TelemetryEventName, props?: TelemetryProps): void
}

/** Заглушка: собирает события только в памяти с ограничением размера. */
export class TelemetryService implements Plugin, ITelemetryService {
  name = "telemetry"
  private events: Array<{ name: TelemetryEventName; props: TelemetryProps }> = []

  async init(): Promise<void> {}

  capture(name: TelemetryEventName, props: TelemetryProps = {}): void {
    if (this.events.length >= TELEMETRY_MAX_EVENTS) {
      this.events.splice(0, TELEMETRY_MAX_EVENTS / 2)
    }
    this.events.push({ name, props })
  }

  dispose(): void {
    this.events = []
  }
}
