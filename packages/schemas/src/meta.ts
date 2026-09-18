import { z } from 'zod';

/**
 * Shared Kubernetes metadata.
 *
 * Every field here is optional on purpose. The API server omits empty maps,
 * CRDs invent their own conventions, and `kubectl get -o json` on an old
 * cluster will surprise you. Optional-by-default costs a few null checks and
 * buys us a viewer that does not blank out on an unfamiliar object.
 */

export const OwnerReferenceSchema = z.looseObject({
  apiVersion: z.string().optional(),
  kind: z.string().optional(),
  name: z.string().optional(),
  uid: z.string().optional(),
  controller: z.boolean().optional(),
  blockOwnerDeletion: z.boolean().optional(),
});

export const ObjectMetaSchema = z.looseObject({
  name: z.string().optional(),
  generateName: z.string().optional(),
  namespace: z.string().optional(),
  uid: z.string().optional(),
  resourceVersion: z.string().optional(),
  generation: z.number().optional(),
  creationTimestamp: z.string().optional(),
  deletionTimestamp: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  annotations: z.record(z.string(), z.string()).optional(),
  ownerReferences: z.array(OwnerReferenceSchema).optional(),
  finalizers: z.array(z.string()).optional(),
});

export const ConditionSchema = z.looseObject({
  type: z.string().optional(),
  status: z.string().optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
  lastTransitionTime: z.string().optional(),
  lastProbeTime: z.string().optional(),
  lastUpdateTime: z.string().optional(),
});

export const LabelSelectorSchema = z.looseObject({
  matchLabels: z.record(z.string(), z.string()).optional(),
  matchExpressions: z
    .array(
      z.looseObject({
        key: z.string().optional(),
        operator: z.string().optional(),
        values: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

/** Any object we can identify well enough to render a row for. */
export const KubeObjectSchema = z.looseObject({
  apiVersion: z.string().optional(),
  kind: z.string().optional(),
  metadata: ObjectMetaSchema.optional(),
});

export type OwnerReference = z.infer<typeof OwnerReferenceSchema>;
export type ObjectMeta = z.infer<typeof ObjectMetaSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type LabelSelector = z.infer<typeof LabelSelectorSchema>;
export type KubeObject = z.infer<typeof KubeObjectSchema>;
