import { AsyncLocalStorage } from "node:async_hooks";
import { context, trace, SpanStatusCode, type Span } from "@opentelemetry/api";
import { TracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
const address = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
const provider = new TracerProvider({
  spanProcessors: address
    ? [
        new SimpleSpanProcessor({
          exporter: new OTLPTraceExporter({ url: address }),
        }),
      ]
    : [],
});
const tracer = provider.getTracer("shadowlab");
const parents = new AsyncLocalStorage<Span>();
export async function span<T>(
  name: string,
  attributes: Record<string, string>,
  work: () => Promise<T>,
) {
  const parent = parents.getStore();
  const current = tracer.startSpan(
    name,
    { attributes },
    parent ? trace.setSpan(context.active(), parent) : undefined,
  );
  try {
    return await parents.run(current, work);
  } catch (e) {
    current.setStatus({ code: SpanStatusCode.ERROR });
    throw e;
  } finally {
    current.end();
  }
}
export const flushTraces = () => provider.forceFlush();
