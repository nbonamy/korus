/** Raised only before provider dispatch: retrying with a new command cannot duplicate a turn. */
export class PromptRejectedError extends Error {}
