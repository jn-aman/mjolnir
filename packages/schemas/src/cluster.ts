import { z } from 'zod';
import { ConditionSchema, ObjectMetaSchema } from './meta.ts';

const QuantityString = z.union([z.string(), z.number()]);
const ResourceMap = z.record(z.string(), QuantityString);

export const NodeSchema = z.looseObject({
  apiVersion: z.string().optional(),
  kind: z.string().optional(),
  metadata: ObjectMetaSchema.optional(),
  spec: z
    .looseObject({
      podCIDR: z.string().optional(),
      providerID: z.string().optional(),
      unschedulable: z.boolean().optional(),
      taints: z
        .array(
          z.looseObject({
            key: z.string().optional(),
            value: z.string().optional(),
            effect: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  status: z
    .looseObject({
      capacity: ResourceMap.optional(),
      allocatable: ResourceMap.optional(),
      conditions: z.array(ConditionSchema).optional(),
      addresses: z
        .array(z.looseObject({ type: z.string().optional(), address: z.string().optional() }))
        .optional(),
      nodeInfo: z
        .looseObject({
          architecture: z.string().optional(),
          operatingSystem: z.string().optional(),
          osImage: z.string().optional(),
          kernelVersion: z.string().optional(),
          kubeletVersion: z.string().optional(),
          containerRuntimeVersion: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export const ServiceSchema = z.looseObject({
  apiVersion: z.string().optional(),
  kind: z.string().optional(),
  metadata: ObjectMetaSchema.optional(),
  spec: z
    .looseObject({
      type: z.string().optional(),
      clusterIP: z.string().optional(),
      clusterIPs: z.array(z.string()).optional(),
      externalIPs: z.array(z.string()).optional(),
      selector: z.record(z.string(), z.string()).optional(),
      ports: z
        .array(
          z.looseObject({
            name: z.string().optional(),
            port: z.number().optional(),
            targetPort: z.union([z.string(), z.number()]).optional(),
            nodePort: z.number().optional(),
            protocol: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  status: z.looseObject({}).optional(),
});

export const NamespaceSchema = z.looseObject({
  apiVersion: z.string().optional(),
  kind: z.string().optional(),
  metadata: ObjectMetaSchema.optional(),
  status: z.looseObject({ phase: z.string().optional() }).optional(),
});

export const EventSchema = z.looseObject({
  apiVersion: z.string().optional(),
  kind: z.string().optional(),
  metadata: ObjectMetaSchema.optional(),
  type: z.string().optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
  count: z.number().optional(),
  firstTimestamp: z.string().optional(),
  lastTimestamp: z.string().optional(),
  eventTime: z.string().optional(),
  involvedObject: z
    .looseObject({
      kind: z.string().optional(),
      name: z.string().optional(),
      namespace: z.string().optional(),
      uid: z.string().optional(),
    })
    .optional(),
  source: z
    .looseObject({ component: z.string().optional(), host: z.string().optional() })
    .optional(),
});

/** metrics.k8s.io, absent on clusters without metrics-server, so always optional upstream. */
export const PodMetricsSchema = z.looseObject({
  metadata: ObjectMetaSchema.optional(),
  timestamp: z.string().optional(),
  window: z.string().optional(),
  containers: z
    .array(z.looseObject({ name: z.string().optional(), usage: ResourceMap.optional() }))
    .optional(),
});

export const NodeMetricsSchema = z.looseObject({
  metadata: ObjectMetaSchema.optional(),
  timestamp: z.string().optional(),
  window: z.string().optional(),
  usage: ResourceMap.optional(),
});

export type Node = z.infer<typeof NodeSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type Namespace = z.infer<typeof NamespaceSchema>;
export type Event = z.infer<typeof EventSchema>;
export type PodMetrics = z.infer<typeof PodMetricsSchema>;
export type NodeMetrics = z.infer<typeof NodeMetricsSchema>;
