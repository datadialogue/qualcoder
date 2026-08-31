/** Shared return shape for server actions, so one form component can render
 *  success and failure for all of them. */
export type ActionResult = { error?: string; ok?: string } | null;
