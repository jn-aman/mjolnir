/**
 * The running build's version, in one place.
 *
 * The updater, the flag context and the telemetry envelope all need to agree
 * on what "this version" means, and a packaged app learns it from Electron
 * while a checkout learns it from the environment or the VERSION file.
 */
export const APP_VERSION = process.env['MJOLNIR_VERSION'] ?? '0.1.0';
