export const SESSION_SCOPE_VALUES = ['standalone', 'classroom', 'assignment'] as const;

export type SessionScope = (typeof SESSION_SCOPE_VALUES)[number];
