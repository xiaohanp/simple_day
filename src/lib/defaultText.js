// The schedule you start with — edit freely, it's just text.
// A sample week starting today, so the example never shows stale dates.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SAMPLE_DAYS = [
  ['getting started', ['09:00 Plan the week 30m !10', 'Deep work 2h', 'Walk 30m']],
  ['', ['09:00 Deep work 3h !15', '13:00 Team meeting 1h !10', 'Reply to emails 30m']],
  ['', ['09:00 Deep work 3h !15', 'Groceries 45m', 'Read 30m']],
  ['', ['10:00 Dentist 1h !30', 'Deep work 2h', 'Walk 30m']],
  ['light day', ['Tidy up notes 1h', 'Call a friend 30m']],
  ['', ['Exercise 1h', 'Rest']],
  ['', ['Weekly review 30m', 'Rest']],
];

function heading(d) {
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

function buildDefaultText(today = new Date()) {
  return SAMPLE_DAYS.map(([note, items], i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    return `## ${heading(d)}${note ? ` — ${note}` : ''}\n${items.join('\n')}\n`;
  }).join('\n');
}

export const DEFAULT_TEXT = buildDefaultText();
