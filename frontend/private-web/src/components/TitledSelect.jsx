/**
 * A native select built from its options whose `title` repeats the option it shows, so an option longer than its field
 * still reads whole on hover (N37). Each option is `{ value, label, disabled }`; every other prop is the select's own.
 * A value that matches no option shows, as React does, the first option that can be chosen, and so does the title.
 */
export default function TitledSelect({ options, value, ...props }) {
  const shown = options.find(option => String(option.value) === String(value)) ?? options.find(option => !option.disabled);
  return (
    <select {...props} value={value} title={shown?.label}>
      {options.map(option => (
        <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
      ))}
    </select>
  );
}
