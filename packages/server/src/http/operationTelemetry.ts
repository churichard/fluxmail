import type { TelemetryProperties } from '../telemetry.js';

/**
 * Route handlers describe their own operation through a request variable so the
 * REST telemetry middleware can attach the properties to one event.
 */
interface OperationTelemetryContext {
  get(key: 'restTelemetry'): TelemetryProperties | undefined;
  set(key: 'restTelemetry', value: TelemetryProperties): void;
}

/** Add safe, aggregate properties to the telemetry event for the current request. */
export function setOperationProperties(c: OperationTelemetryContext, properties: TelemetryProperties): void {
  c.set('restTelemetry', { ...c.get('restTelemetry'), ...properties });
}

export function operationProperties(c: OperationTelemetryContext): TelemetryProperties | undefined {
  return c.get('restTelemetry');
}
