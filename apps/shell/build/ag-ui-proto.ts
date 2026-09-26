/**
 * What the shell bundles in place of `@ag-ui/proto` (the alias is in rsbuild.config.ts). The AG-UI
 * client imports the protobuf codec for one case: a run whose response is
 * `application/vnd.ag-ui.event+proto`. `HttpAgent` always asks for `text/event-stream`, and the
 * client decodes protobuf only when the response says it is that media type, so the codec and
 * `@bufbuild/protobuf` under it were 100 kB of the chat's chunk (49 → 33 kB gzipped) that never ran.
 *
 * These are the three names the client reads. Should the shell ever ask for protobuf, or an agent
 * answer with it regardless, the run fails with the error below rather than decoding nothing; the
 * fix then is to drop the alias, not to extend this file.
 */

export const AGUI_MEDIA_TYPE = 'application/vnd.ag-ui.event+proto'

/** The client tells an event it does not know from a broken frame by this class. */
export class AGUIUnknownEventTypeError extends Error {}

export function decode(): never {
  throw new Error(
    `The agent answered with ${AGUI_MEDIA_TYPE}, but the shell bundles no protobuf codec: it asks for text/event-stream (apps/shell/build/ag-ui-proto.ts).`,
  )
}
