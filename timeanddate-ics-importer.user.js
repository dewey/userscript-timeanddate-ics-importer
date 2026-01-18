// ==UserScript==
// @name         timeanddate.com - ICS Importer
// @namespace    notmyhostna.me
// @version      0.0.1
// @description  Import events from .ics into timeanddate "My Events" in-browser (Safari/Tampermonkey).
// @author       Philipp Defner
// @homepageURL  https://github.com/dewey/userscript-timeanddate-ics-importer
// @supportURL   https://github.com/dewey/userscript-timeanddate-ics-importer/issues
// @match        https://www.timeanddate.com/calendar/events/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/dewey/userscript-timeanddate-ics-importer/main/timeanddate-ics-importer.user.js
// @downloadURL  https://raw.githubusercontent.com/dewey/userscript-timeanddate-ics-importer/main/timeanddate-ics-importer.user.js
// @require      https://unpkg.com/ical.js@1.5.0/build/ical.min.js
// @require      https://raw.githubusercontent.com/dewey/userscript-timeanddate-ics-importer/main/timeanddate-ics-importer.user.js
// ==/UserScript==

(function () {
  'use strict';

  // -------- Settings --------
  const THROTTLE_MS = 450;
  const RRULE_FREQ_DEFAULT = '0';
  const DEFAULT_COLOR = ''; // only used if "use calendar color" is off

  // localStorage keys
  const LS_PREFIX = 'tad_ics_importer_';
  const LS_CALID = LS_PREFIX + 'calid';
  const LS_YEAR = LS_PREFIX + 'year';
  const LS_USE_CAL_COLOR = LS_PREFIX + 'useCalColor';

  // -------- Helpers --------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function getCookie(name) {
    const m = document.cookie.match(
      new RegExp('(?:^|; )' + name.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&') + '=([^;]*)')
    );
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getFt() {
    const csrfToken = getCookie('csrfToken');
    if (!csrfToken) throw new Error('csrfToken cookie not found. Are you logged in?');
    return csrfToken;
  }

  function calEndpoint() {
    return `/scripts/ownevents.php/cal/?ft=${encodeURIComponent(getFt())}`;
  }

  function evEndpoint() {
    return `/scripts/ownevents.php/ev/?ft=${encodeURIComponent(getFt())}`;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function isoDate(y, m, d) {
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  function el(tag, cssText) {
    const node = document.createElement(tag);
    if (cssText) node.style.cssText = cssText;
    return node;
  }

  function safeColor(c) {
    if (typeof c !== 'string') return null;
    const v = c.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
    return null;
  }

  function readLS(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function writeLS(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // ignore
    }
  }

  // -------- API --------
  async function fetchCalendars() {
    const res = await fetch(calEndpoint(), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: '*/*' },
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        `Calendar list response was not JSON (HTTP ${res.status}). First 200 chars:\n${text.slice(0, 200)}`
      );
    }

    if (!res.ok) throw new Error(`Calendar list failed (HTTP ${res.status})`);
    if (json?.status && json.status !== 200) throw new Error(`Calendar list returned status=${json.status}`);
    return json;
  }

  function extractCalendars(calJson) {
    // Expected shape:
    // { status: 200, cal: [{ id, name, anniversary, color }, ...] }
    const arr = Array.isArray(calJson?.cal) ? calJson.cal : [];

    return arr
      .map((c) => {
        const calid = c?.id;
        if (calid == null) return null;

        const name = (c?.name || `Calendar ${calid}`).toString();
        const isBirthday = c?.anniversary === true; // deterministic rule
        const color = safeColor(c?.color);

        return { calid: String(calid), name, isBirthday, color, raw: c };
      })
      .filter(Boolean);
  }

  async function postEvent({ day, month, year, summary, calId, color }) {
    const form = new URLSearchParams();
    form.set('p1d', String(day));
    form.set('p1m', String(month));
    form.set('p1y', String(year));
    form.set('p1i', '0');
    form.set('p1s', '0');
    form.set('summary', summary);
    form.set('rrule_freq', RRULE_FREQ_DEFAULT);
    form.set('cal', String(calId));
    form.set('color', color ?? '');

    const res = await fetch(evEndpoint(), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: '*/*',
      },
      body: form.toString(),
    });

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // ignore
    }

    // timeanddate returns JSON with {status:200,...} on success
    const ok = res.ok && (json?.status === 200 || json?.status === undefined);
    return { ok, status: res.status, json, text };
  }

  // -------- ICS parsing (ical.js) --------
  function parseICS(text) {
    const jcalData = ICAL.parse(text);
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents('vevent');

    const events = [];

    for (const vevent of vevents) {
      const ev = new ICAL.Event(vevent);
      const summary = (ev.summary || '').trim();
      const start = ev.startDate; // ICAL.Time
      if (!summary || !start) continue;

      // We only need month/day. (ICAL.Time is 1-based for month/day.)
      events.push({ summary, month: start.month, day: start.day });
    }

    // Deduplicate within ICS: summary + month + day
    const seen = new Set();
    return events.filter((e) => {
      const k = `${e.summary}__${e.month}__${e.day}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // -------- UI --------
  function addPanel() {
    const panel = el(
      'div',
      [
        'position:fixed',
        'right:16px',
        'bottom:16px',
        'z-index:99999',
        'width:420px',
        'max-height:70vh',
        'overflow:auto',
        'padding:12px',
        'border-radius:14px',
        'border:1px solid #ddd',
        'background:rgba(255,255,255,0.96)',
        'box-shadow:0 8px 24px rgba(0,0,0,0.12)',
        'font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
      ].join(';')
    );

    const title = el('div', 'font-weight:600; margin-bottom:8px; font-size:16px;');
    title.textContent = 'Import Calendar Events';
    panel.appendChild(title);

    const status = el('div', 'font-size:12px; white-space:pre-wrap; margin-bottom:10px;');
    status.textContent = 'Loading calendars…';
    panel.appendChild(status);

    // Year
    const yearRow = el('div', 'display:flex; gap:8px; align-items:center; margin:8px 0;');
    const yearLabel = el('div', 'font-size:12px; width:70px; flex-shrink:0;');
    yearLabel.textContent = 'Year:';
    yearRow.appendChild(yearLabel);
    const yearInput = el('input', 'flex:1;');
    yearInput.type = 'number';
    yearInput.value = readLS(LS_YEAR, String(new Date().getFullYear()));
    yearInput.addEventListener('change', () => writeLS(LS_YEAR, yearInput.value));
    yearRow.appendChild(yearInput);
    panel.appendChild(yearRow);

    // Calendar selector + dot
    const calRow = el('div', 'display:flex; gap:8px; align-items:center; margin:8px 0;');
    const calLabel = el('div', 'font-size:12px; width:70px; flex-shrink:0;');
    calLabel.textContent = 'Calendar:';
    calRow.appendChild(calLabel);

    const dot = el(
      'span',
      [
        'display:inline-block',
        'width:12px',
        'height:12px',
        'border-radius:999px',
        'border:1px solid rgba(0,0,0,0.18)',
        'background:#ccc',
        'flex:0 0 auto',
      ].join(';')
    );

    const calSelect = el('select', 'flex:1;');
    calRow.appendChild(dot);
    calRow.appendChild(calSelect);
    panel.appendChild(calRow);

    // Use calendar color checkbox
    const useColorWrap = el('label', 'display:flex; gap:8px; align-items:center; font-size:12px; margin:6px 0;');
    const useCalColorCb = document.createElement('input');
    useCalColorCb.type = 'checkbox';
    useCalColorCb.checked = readLS(LS_USE_CAL_COLOR, 'true') === 'true';
    useCalColorCb.addEventListener('change', () => writeLS(LS_USE_CAL_COLOR, useCalColorCb.checked));
    useColorWrap.appendChild(useCalColorCb);
    useColorWrap.appendChild(document.createElement('span')).textContent = 'Use calendar color for imported events';
    panel.appendChild(useColorWrap);

    // Buttons
    const btnRow = el('div', 'display:flex; gap:8px; margin-top:10px;');
    const reloadBtn = el('button', 'flex:1;');
    reloadBtn.textContent = 'Reload';
    const importBtn = el('button', 'flex:1;');
    importBtn.textContent = 'Import .ics';
    btnRow.appendChild(reloadBtn);
    btnRow.appendChild(importBtn);
    panel.appendChild(btnRow);

    const footer = el('div', 'margin-top:10px; font-size:11px; color:#666; text-align:center;');
    const footerLink = document.createElement('a');
    footerLink.href = 'https://github.com/dewey/userscript-timeanddate-ics-importer';
    footerLink.target = '_blank';
    footerLink.rel = 'noopener noreferrer';
    footerLink.textContent = 'Report issues on GitHub';
    footerLink.style.cssText = 'color:#666; text-decoration:none;';
    footerLink.addEventListener('mouseenter', () => footerLink.style.textDecoration = 'underline');
    footerLink.addEventListener('mouseleave', () => footerLink.style.textDecoration = 'none');
    footer.appendChild(footerLink);
    panel.appendChild(footer);

    document.body.appendChild(panel);

    // State
    let calendars = [];
    let importInProgress = false;

    function selectedCalendar() {
      const calId = calSelect.value;
      return calendars.find((c) => c.calid === calId) || null;
    }

    function updateDot() {
      const cal = selectedCalendar();
      dot.style.background = cal?.color || '#ccc';
    }

    function populateCalendars() {
      calSelect.innerHTML = '';

      for (const c of calendars) {
        const opt = document.createElement('option');
        opt.value = c.calid;
        opt.textContent = `${c.name}${c.isBirthday ? ' (Birthday)' : ''}`;
        if (c.color) opt.style.color = c.color; // Safari supports option text color
        calSelect.appendChild(opt);
      }

      const savedCalId = readLS(LS_CALID, null);
      const savedExists = savedCalId && calendars.some((c) => c.calid === savedCalId);

      if (savedExists) {
        calSelect.value = savedCalId;
      } else {
        const bday = calendars.find((c) => c.isBirthday);
        calSelect.value = (bday ? bday.calid : calendars[0]?.calid || '');
      }

      writeLS(LS_CALID, calSelect.value);
      updateDot();
    }

    calSelect.addEventListener('change', () => {
      writeLS(LS_CALID, calSelect.value);
      updateDot();
    });

    async function loadCalendars() {
      status.textContent = 'Loading calendars…';
      try {
        const json = await fetchCalendars();
        calendars = extractCalendars(json);

        if (!calendars.length) {
          status.textContent = 'No calendars found. Are you logged in?';
          return;
        }

        populateCalendars();
        status.textContent = `Ready. Calendars loaded: ${calendars.length}`;
      } catch (e) {
        status.textContent = `Error loading calendars:\n${e.message}`;
      }
    }

    reloadBtn.addEventListener('click', loadCalendars);

    importBtn.addEventListener('click', () => {
      if (importInProgress) {
        status.textContent = 'Import already running…';
        return;
      }

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.ics,text/calendar';

      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;

        const anchorYear = Number(yearInput.value);
        const cal = selectedCalendar();
        if (!cal) {
          status.textContent = 'No calendar selected.';
          return;
        }

        importInProgress = true;
        importBtn.disabled = true;
        reloadBtn.disabled = true;

        try {
          status.textContent = `Reading ${file.name}…`;
          const icsText = await file.text();

          let events;
          try {
            events = parseICS(icsText);
          } catch (e) {
            status.textContent = `Could not parse ICS:\n${String(e.message || e)}`;
            return;
          }

          if (!events.length) {
            status.textContent = 'No events found in the .ics file.';
            return;
          }

          const eventColor = (useCalColorCb.checked ? cal.color : DEFAULT_COLOR) || '';

          status.textContent =
            `Importing ${events.length} events into:\n` +
            `${cal.name}${cal.isBirthday ? ' (Birthday)' : ''}\n` +
            `Anchor year: ${anchorYear}\n`;

          let ok = 0;
          let fail = 0;

          for (let i = 0; i < events.length; i++) {
            const ev = events[i];

            const res = await postEvent({
              day: ev.day,
              month: ev.month,
              year: anchorYear,
              summary: ev.summary,
              calId: cal.calid,
              color: eventColor,
            });

            if (res.ok && res.json?.status === 200) {
              ok++;
            } else {
              fail++;
              const snippet = (res.text || '').slice(0, 220);
              console.warn('Failed to create event', ev, res.status, res.json, res.text);
              status.textContent =
                `Importing… ${i + 1}/${events.length}\n` +
                `OK: ${ok}  Failed: ${fail}\n` +
                `Last failed: ${ev.summary} (${isoDate(anchorYear, ev.month, ev.day)})\n` +
                `HTTP ${res.status} | ${snippet}`;
              await sleep(THROTTLE_MS);
              continue;
            }

            status.textContent =
              `Importing… ${i + 1}/${events.length}\n` +
              `OK: ${ok}  Failed: ${fail}\n` +
              `Last: ${ev.summary} (${isoDate(anchorYear, ev.month, ev.day)})`;

            await sleep(THROTTLE_MS);
          }

          status.textContent =
            `Done.\nOK: ${ok}\nFailed: ${fail}\n\n` +
            (cal.isBirthday
              ? 'This is a Birthday calendar; entries should recur automatically.'
              : 'This is a normal calendar; entries are one-off unless recurrence is configured separately.');
        } finally {
          importInProgress = false;
          importBtn.disabled = false;
          reloadBtn.disabled = false;
        }
      };

      input.click();
    });

    loadCalendars();
  }

  addPanel();
})();
