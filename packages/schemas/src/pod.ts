import { z } from 'zod';
import { ConditionSchema, ObjectMetaSchema } from './meta.ts';

/** A quantity as the API sends it, string or number, validated on read. */
const QuantityString = z.union([z.string(), z.number()]);

export const ResourceRequirementsSchema = z.looseObject({
  limits: z.record(z.string(), QuantityString).optional(),
  requests: z.record(z.string(), QuantityString).optional(),
});

export const ContainerSchema = z.looseObject({
  name: z.string().optional(),
  image: z.string().optional(),
  imagePullPolicy: z.string().optional(),
  command: z.array(z.string()).optional(),
  args: z.array(z.string()).optional(),
  ports: z
    .array(
      z.looseObject({
        name: z.string().optional(),
        containerPort: z.number().optional(),
        protocol: z.string().optional(),
        hostPort: z.number().optional(),
      }),
    )
    .optional(),
  resources: ResourceRequirementsSchema.optional(),
  volumeMounts: z
    .array(
      z.looseObject({
        name: z.string().optional(),
        mountPath: z.string().optional(),
        readOnly: z.boolean().optional(),
        subPath: z.string().optional(),
      }),
    )
    .optional(),
});

/**
 * Container state. Exactly one of the three keys is normally set, but we do not
 * enforce that: a container caught mid-transition can briefly report two, and a
 * viewer that throws on it is worse than one that shows the first it finds.
 */
export const ContainerStateSchema = z.looseObject({
  running: z.looseObject({ startedAt: z.string().optional() }).optional(),
  waiting: z
    .looseObject({ reason: z.string().optional(), message: z.string().optional() })
    .optional(),
  terminated: z
    .looseObject({
      exitCode: z.number().optional(),
      signal: z.number().optional(),
      reason: z.string().optional(),
      message: z.string().optional(),
      startedAt: z.string().optional(),
      finishedAt: z.string().optional(),
      containerID: z.string().optional(),
    })
    .optional(),
});

export const ContainerStatusSchema = z.looseObject({
  name: z.string().optional(),
  image: z.string().optional(),
  imageID: z.string().optional(),
  containerID: z.string().optional(),
  ready: z.boolean().optional(),
  started: z.boolean().optional(),
  restartCount: z.number().optional(),
  state: ContainerStateSchema.optional(),
  lastState: ContainerStateSchema.optional(),
});

export const PodSpecSchema = z.looseObject({
  nodeName: z.string().optional(),
  serviceAccountName: z.string().optional(),
  restartPolicy: z.string().optional(),
  priorityClassName: z.string().optional(),
  containers: z.array(ContainerSchema).optional(),
  initContainers: z.array(ContainerSchema).optional(),
  ephemeralContainers: z.array(ContainerSchema).optional(),
  nodeSelector: z.record(z.string(), z.string()).optional(),
  tolerations: z.array(z.looseObject({})).optional(),
  volumes: z.array(z.looseObject({ name: z.string().optional() })).optional(),
});

export const PodStatusSchema = z.looseObject({
  phase: z.string().optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
  podIP: z.string().optional(),
  hostIP: z.string().optional(),
  qosClass: z.string().optional(),
  startTime: z.string().optional(),
  conditions: z.array(ConditionSchema).optional(),
  containerStatuses: z.array(ContainerStatusSchema).optional(),
  initContainerStatuses: z.array(ContainerStatusSchema).optional(),
  ephemeralContainerStatuses: z.array(ContainerStatusSchema).optional(),
});

export const PodSchema = z.looseObject({
  apiVersion: z.string().optional(),
  kind: z.string().optional(),
  metadata: ObjectMetaSchema.optional(),
  spec: PodSpecSchema.optional(),
  status: PodStatusSchema.optional(),
});

export type ResourceRequirements = z.infer<typeof ResourceRequirementsSchema>;
export type Container = z.infer<typeof ContainerSchema>;
export type ContainerState = z.infer<typeof ContainerStateSchema>;
export type ContainerStatus = z.infer<typeof ContainerStatusSchema>;
export type PodSpec = z.infer<typeof PodSpecSchema>;
export type PodStatus = z.infer<typeof PodStatusSchema>;
export type Pod = z.infer<typeof PodSchema>;
