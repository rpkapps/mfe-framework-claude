/**
 * The one file in this package that names `localStorage`.
 *
 * Mount-scoped storage is the right answer for anything a definition owns, and
 * neither of the two keys this package touches is one: the devtools flag and
 * the override map both belong to the page's own bootstrap, which is read
 * before a store exists and has to outlive a sign-out. That is the same reason
 * the shell's own theme and override files are named in the storage rule's
 * allowed scopes, and it is why this accessor is here rather than in the two
 * modules that use it — one file to allow, one place to read.
 *
 * Reading the property throws outright when storage is blocked for an origin,
 * so the access is wrapped and a refusal reads as "no storage". A developer
 * tool is not worth taking the page down for.
 */

export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}
