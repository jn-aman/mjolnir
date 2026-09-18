import { z } from 'zod';
import { ConditionSchema, LabelSelectorSchema, ObjectMetaSchema } from './meta.js';
import { PodSpecSchema } from './pod.js';

const PodTemplateSchema = z.looseObject({
  metadata: ObjectMetaSchema.optional(),
  spec: PodSpecSchema.optional(),
});

const workload = <S extends z.ZodTypeAny>(spec: S, status: z.ZodTypeAny) =>
  z.looseObject({
    apiVersion: z.string().optional(),
    kind: z.string().optional(),
    metadata: ObjectMetaSchema.optional(),
    spec: spec.optional(),
    status: status.optional(),
  });

export const DeploymentSchema = workload(
  z.looseObject({
    replicas: z.number().optional(),
    selector: LabelSelectorSchema.optional(),
    strategy: z.looseObject({ type: z.string().optional() }).optional(),
    template: PodTemplateSchema.optional(),
  }),
  z.looseObject({
    replicas: z.number().optional(),
    readyReplicas: z.number().optional(),
    availableReplicas: z.number().optional(),
    updatedReplicas: z.number().optional(),
    unavailableReplicas: z.number().optional(),
    observedGeneration: z.number().optional(),
    conditions: z.array(ConditionSchema).optional(),
  }),
);

export const StatefulSetSchema = workload(
  z.looseObject({
    replicas: z.number().optional(),
    serviceName: z.string().optional(),
    selector: LabelSelectorSchema.optional(),
    template: PodTemplateSchema.optional(),
  }),
  z.looseObject({
    replicas: z.number().optional(),
    readyReplicas: z.number().optional(),
    currentReplicas: z.number().optional(),
    updatedReplicas: z.number().optional(),
  }),
);

export const DaemonSetSchema = workload(
  z.looseObject({ selector: LabelSelectorSchema.optional(), template: PodTemplateSchema.optional() }),
  z.looseObject({
    desiredNumberScheduled: z.number().optional(),
    currentNumberScheduled: z.number().optional(),
    numberReady: z.number().optional(),
    numberAvailable: z.number().optional(),
    updatedNumberScheduled: z.number().optional(),
  }),
);

export const ReplicaSetSchema = workload(
  z.looseObject({ replicas: z.number().optional(), selector: LabelSelectorSchema.optional() }),
  z.looseObject({ replicas: z.number().optional(), readyReplicas: z.number().optional() }),
);

export const JobSchema = workload(
  z.looseObject({
    parallelism: z.number().optional(),
    completions: z.number().optional(),
    backoffLimit: z.number().optional(),
    template: PodTemplateSchema.optional(),
  }),
  z.looseObject({
    active: z.number().optional(),
    succeeded: z.number().optional(),
    failed: z.number().optional(),
    startTime: z.string().optional(),
    completionTime: z.string().optional(),
  }),
);

export const CronJobSchema = workload(
  z.looseObject({
    schedule: z.string().optional(),
    suspend: z.boolean().optional(),
    concurrencyPolicy: z.string().optional(),
  }),
  z.looseObject({ lastScheduleTime: z.string().optional(), active: z.array(z.looseObject({})).optional() }),
);

export type Deployment = z.infer<typeof DeploymentSchema>;
export type StatefulSet = z.infer<typeof StatefulSetSchema>;
export type DaemonSet = z.infer<typeof DaemonSetSchema>;
export type ReplicaSet = z.infer<typeof ReplicaSetSchema>;
export type Job = z.infer<typeof JobSchema>;
export type CronJob = z.infer<typeof CronJobSchema>;
