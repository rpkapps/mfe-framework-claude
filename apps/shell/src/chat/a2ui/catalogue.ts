/**
 * The A2UI catalogue the shell renders with Tecton: a subset of A2UI's basic catalogue (v0.9),
 * with its component names and properties, drawn by Tecton components. It has an id of its own
 * because it is trimmed; the host stamps it on every surface, never the model.
 */

export const TECTON_CATALOGUE_ID = 'tecton-basic-v0.9'

/** Each component, as the agent is told of it: its properties, with the required ones marked. */
export const CATALOGUE: Readonly<Record<string, string>> = {
  Text: 'text* (a value), variant: h1|h2|h3|h4|h5|caption|body',
  Column: 'children* (ids, or a template {componentId, path}), justify, align',
  Row: 'children* (ids, or a template {componentId, path}), justify, align',
  List: 'children* (ids, or a template {componentId, path}), direction: vertical|horizontal',
  Card: 'child* (one id; wrap several in a Column)',
  Divider: 'axis: horizontal|vertical',
  Button:
    'child* (the id of its Text), action* ({event: {name, context}} sent to you, or {functionCall: {call: "openUrl", args: {url}}}), variant: default|primary|borderless, checks',
  TextField:
    'label*, value (bind with {path}), variant: shortText|longText|number|obscured, checks',
  CheckBox: 'label*, value* (bind with {path})',
  ChoicePicker:
    'options* ([{label, value}]), value* (bind with {path}; always an array), label, variant: mutuallyExclusive|multipleSelection',
  Image: 'url* (https only), description',
  Icon: 'name*: check|close|warning|error|info|search|settings|delete|edit|add|download|upload|refresh|star|person|home|mail|calendarToday|locationOn|lock',
}

export const CATALOGUE_NAMES: ReadonlySet<string> = new Set(Object.keys(CATALOGUE))
