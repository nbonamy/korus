import { product } from '@workspace/core/product';
import * as z from 'zod/v4';
import type { DurableTaskService } from '../agents/durable-task-service';
import { taskResultSchema } from '../persistence/task-schema';
import { loggedToolResult, type AppMcpToolModuleProvider } from './tool-modules';

export function createTaskToolModuleProvider(tasks: DurableTaskService, externalWorker: (agentId: string) => boolean = () => false, access: Pick<DurableTaskService, 'wait' | 'cancel'> = tasks): AppMcpToolModuleProvider {
  return {
    id: 'tasks',
    resolve: ({ agentId }) => ({
      id: 'tasks',
      register(server) {
        server.registerTool('wait-tasks', {
          description: 'Read your durable assignments/results or wait up to 30 seconds for any/all tasks to finish or require attention. Timeout never cancels work. Results remain discoverable even when automatic delivery is blocked or uncertain. No acknowledgment messages are needed.',
          inputSchema: {
            taskIds: z.array(z.string().min(1)).max(100).optional(),
            mode: z.enum(['any', 'all']).optional(),
            timeoutMs: z.number().int().min(0).max(30000).optional(),
          },
        }, input => loggedToolResult('wait-tasks', { agentId }, () => access.wait(agentId, input)));
        server.registerTool('cancel-task', {
          description: 'Cancel a task you assigned or are executing. Persists cancellation before interrupting; preserves the worker, workspace, conversation and results.',
          inputSchema: { taskId: z.string().min(1) },
        }, ({ taskId }) => loggedToolResult('cancel-task', { agentId, taskId }, () => access.cancel(agentId, taskId)));
        if (tasks.instructions(agentId) || externalWorker(agentId)) server.registerTool('complete-task', {
          description: `Save your assigned task result before finish_turn. Finish all foreground tools and background work first. ${product.name} finalizes only after this exact provider turn succeeds, then delivers the result to the parent. Do not also send a completion message. This does not authorize merging or publication.`,
          inputSchema: taskResultSchema.shape,
        }, input => loggedToolResult('complete-task', { agentId }, () => tasks.complete(agentId, input)));
      },
    }),
  };
}
