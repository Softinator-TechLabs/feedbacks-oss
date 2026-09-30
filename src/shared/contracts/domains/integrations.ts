import { z } from "zod";
export const integrationProvider = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  name: z.string().max(100),
  description: z.string().max(300),
  managePath: z.string().regex(/^\/[a-z0-9/-]+$/),
  capabilities: z.array(z.enum(["issue_create", "issue_link", "issue_status_sync"])),
  configuredConnections: z.number().int().nonnegative(),
  activeConnections: z.number().int().nonnegative(),
  storage: z.object({
    feedbacks: z.number().int().nonnegative(),
    environment: z.number().int().nonnegative(),
  }),
});
export type IntegrationProvider = z.infer<typeof integrationProvider>;
export const integrationsInputs = { "integrations.catalog": z.object({}) };
export const integrationsOutputs = {
  "integrations.catalog": z.object({ providers: z.array(integrationProvider).max(50) }),
};
