# userscript-timeanddate-ics-importer

A Tampermonkey userscript (Safari-friendly) that imports events from an `.ics` (iCalendar) file into **timeanddate.com → Calendar Events**.

It runs **in the browser** (same-origin), using your logged-in session and the same endpoints as the UI.

## Features

- Lists your calendars via `GET /scripts/ownevents.php/cal/?ft=...`
- Lets you pick a target calendar (labels calendars with `anniversary: true` as **(Birthday)**)
- Imports events from an `.ics` file using `POST /scripts/ownevents.php/ev/?ft=...`
- Uses `ical.js` for robust RFC5545 parsing
- Optional: use calendar color for imported events
- Remembers selected calendar + settings via `localStorage`

## Install

1. Install Tampermonkey (Safari).
2. Create a new userscript.
3. Paste the contents of `timeanddate-ics-importer.user.js`.
4. Visit: https://www.timeanddate.com/calendar/events/

## Usage

1. Open https://www.timeanddate.com/calendar/events/
2. Use the floating **timeanddate importer** panel.
3. Choose the target calendar and anchor year.
4. Click **Import .ics** and select your `.ics` file.

### Notes

- Calendars with `anniversary: true` are treated as Birthday calendars; birthdays recur automatically on timeanddate.
- Importing into normal calendars creates one-off events (unless you configure recurrence separately).

## Development

- `@require` pulls `ical.js` from unpkg.
- Settings are stored in the browser via `localStorage` under the `tad_ics_importer_` prefix.

## License

MIT
