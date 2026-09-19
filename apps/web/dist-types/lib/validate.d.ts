/**
 * Validation, in one place, phrased for the person typing.
 *
 * Every rule returns a sentence or null. The sentence says what is wrong and
 * what would be right, because "invalid" is a verdict, not help. Rules follow
 * what the API server would reject, so a value that passes here applies.
 */
export type Validator = (value: string) => string | null;
export declare const required: Validator;
/** Names of namespaced objects: lowercase, digits, dashes; 63 chars at most. */
export declare const dnsLabel: Validator;
/** Names that may contain dots (most kinds, Secrets, ConfigMaps): 253 chars. */
export declare const dnsSubdomain: Validator;
export declare const namespaceName: Validator;
/** Label and annotation keys: optional prefix/, then a name of 63 chars. */
export declare const labelKey: Validator;
export declare const labelValue: Validator;
/** Annotation values can be anything up to 256 KiB across all annotations. */
export declare const annotationValue: Validator;
/** CPU and memory quantities: 500m, 2, 512Mi, 1.5Gi. */
export declare const quantity: Validator;
export declare const cpuQuantity: Validator;
export declare const memoryQuantity: Validator;
/** A container image reference. */
export declare const imageRef: Validator;
export declare const port: Validator;
export declare const nonNegativeInteger: Validator;
export declare const url: Validator;
export declare const optionalUrl: Validator;
export declare const filePath: Validator;
export declare const bucketName: Validator;
export declare const licenceKey: Validator;
export declare const modelName: Validator;
export declare const taintEffect: Validator;
/** Runs several rules; the first sentence wins. */
export declare function all(...rules: Validator[]): Validator;
/**
 * A Mjolnir endpoint.
 *
 * The app contacts mjolnir.sh and its subdomains, and loopback while someone
 * is developing against a stand-in. Checked by parsing rather than by suffix,
 * because `https://mjolnir.sh.example.com` ends with the right letters and is
 * not us.
 */
export declare const mjolnirUrl: Validator;
//# sourceMappingURL=validate.d.ts.map