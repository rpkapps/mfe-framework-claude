/** Reading `localStorage` throws outright where an origin is blocked, so a refusal reads as "no storage". */
export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}
