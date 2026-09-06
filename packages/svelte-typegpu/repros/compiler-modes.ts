// Dev SSR output reads metadata that the production runtime does not retain.
export const compilerModes = process.env.NODE_ENV === 'production' ? [false] : [false, true];
