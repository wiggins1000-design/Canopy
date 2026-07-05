// Children are stored with a full name (e.g. "Isabelle Wiggins") since that's what
// gets typed into the "Add child" field. Everywhere else in the app, only the first
// name should be shown — the full name is for identification when it's being set,
// not for repeated display as a label/tag/badge.
export function firstName(fullName) {
  return (fullName ?? '').trim().split(/\s+/)[0] ?? ''
}
