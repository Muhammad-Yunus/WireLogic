import { eq } from 'drizzle-orm';
import cron, { type ScheduledTask } from 'node-cron';
import type { Server as SocketIOServer } from 'socket.io';
import { db } from '../db/index.js';
import { workflows } from '../db/schema.js';
import type { TriggerType, WorkflowRecord } from '../shared/types.js';
import { runWorkflow } from './engine.js';

const scheduledTasks = new Map<string, ScheduledTask>();
let ioInstance: SocketIOServer | undefined;

export function setSchedulerIO(io: SocketIOServer): void {
  ioInstance = io;
}

export function syncWorkflowSchedule(workflow: WorkflowRecord): void {
  const existing = scheduledTasks.get(workflow.id);
  if (existing) {
    existing.stop();
    scheduledTasks.delete(workflow.id);
  }

  if (workflow.triggerType !== 'schedule' || !workflow.isActive) {
    return;
  }

  const expr = (workflow.triggerConfig?.cronExpression || '').trim();
  if (!expr || !cron.validate(expr)) {
    return;
  }

  const workflowId = workflow.id;
  const task = cron.schedule(expr, () => {
    void (async () => {
      const [latest] = await db
        .select()
        .from(workflows)
        .where(eq(workflows.id, workflowId))
        .limit(1);
      if (!latest || !latest.isActive || latest.triggerType !== 'schedule') {
        return;
      }
      const record: WorkflowRecord = {
        ...latest,
        triggerType: latest.triggerType as TriggerType,
        triggerConfig: latest.triggerConfig || {},
        nodes: latest.nodes || [],
        edges: latest.edges || [],
        updatedAt: latest.updatedAt.toISOString(),
        createdAt: latest.createdAt.toISOString(),
      };
      await runWorkflow({
        workflow: record,
        userId: record.userId,
        triggerType: 'schedule',
        triggerPayload: {
          scheduledAt: new Date().toISOString(),
          cronExpression: expr,
        },
        io: ioInstance,
      });
    })().catch((err) => {
      console.error(`Scheduled workflow ${workflowId} error:`, err);
    });
  });

  scheduledTasks.set(workflow.id, task);
}

export function removeWorkflowSchedule(workflowId: string): void {
  const existing = scheduledTasks.get(workflowId);
  if (existing) {
    existing.stop();
    scheduledTasks.delete(workflowId);
  }
}

export async function initializeAllSchedules(): Promise<void> {
  const rows = await db
    .select()
    .from(workflows)
    .where(eq(workflows.triggerType, 'schedule'));

  for (const row of rows) {
    syncWorkflowSchedule({
      ...row,
      triggerType: row.triggerType as TriggerType,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    });
  }
}
