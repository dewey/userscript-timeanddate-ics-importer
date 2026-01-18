# userscript-timeanddate-ics-importer

A Tampermonkey userscript (Safari-friendly) that imports events from an `.ics` (iCalendar) file into **timeanddate.com → Calendar Events**.

It runs **in the browser** (same-origin), using your logged-in session and the same endpoints as the UI.

<img width="1058" height="632" alt="Screenshot 2026-01-18 at 22 29 45@2x" src="https://github.com/user-attachments/assets/ba424f21-527b-430f-a59b-d5c9c37566db" />


## Features

- Lists calendars
- Lets you pick a target calendar (labels calendars with `anniversary: true` as **(Birthday)**)

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

## License

MIT
