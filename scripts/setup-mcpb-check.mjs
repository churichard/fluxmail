import { pathToFileURL } from 'node:url';

const [cli, dataDirectory] = process.argv.slice(2);
if (!cli || !dataDirectory) throw new Error('Provide the bundle CLI and temporary data directory.');

process.env.FLUXMAIL_DATA_DIR = dataDirectory;
process.env.FLUXMAIL_TELEMETRY = '0';

const { createCliProgram, shutdownTelemetryAndLogging } = await import(pathToFileURL(cli).href);
await createCliProgram({ passwordPrompt: async () => 'McpbCheckPassword123!' }).parseAsync([
  process.execPath,
  cli,
  'setup',
  '--name',
  'MCPB Check',
  '--email',
  'mcpb-check@example.invalid',
]);
await shutdownTelemetryAndLogging();
