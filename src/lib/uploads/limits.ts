/**
 * En filgräns för kvitton, inbox och verifikationsbilagor.
 * Samma tal som serverActions.bodySizeLimit i next.config.ts.
 * SIE-import (25 MB) och grossistprisfiler har egna tak.
 */
export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
export const UPLOAD_MAX_LABEL = "8 MB";
export const UPLOAD_MAX_FORMATS = `PDF, JPG, PNG, HEIC · max ${UPLOAD_MAX_LABEL}`;
