/**
 * On/off switch (role="switch") for a boolean setting: a label and a pill track. Styles: theme.css `.switch`.
 * Used by the popup ("Animate") and the profile page top bar ("Tailor pages automatically").
 */
export function Switch(props: { label: string; checked: boolean; onChange: (on: boolean) => void; title?: string }) {
  return (
    <label className="switch" title={props.title}>
      <span className="switch-text">{props.label}</span>
      <input type="checkbox" role="switch" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
    </label>
  )
}
