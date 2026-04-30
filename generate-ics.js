const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const INPUT_FILE = path.join(ROOT, 'holidayAPI.json');
const OUTPUT_FILES = {
  all: path.join(ROOT, 'holidayCal.ics'),
  holiday: path.join(ROOT, 'holidayCal-HO.ics'),
  compensateday: path.join(ROOT, 'holidayCal-CO.ics'),
};

const TIMEZONE_BLOCK = [
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Shanghai',
  'X-LIC-LOCATION:Asia/Shanghai',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0800',
  'TZOFFSETTO:+0800',
  'TZNAME:CST',
  'DTSTART:19700101T000000',
  'END:STANDARD',
  'END:VTIMEZONE',
];

function pad(value) {
  return String(value).padStart(2, '0');
}

function parseDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDate(value) {
  const date = typeof value === 'string' ? parseDate(value) : value;
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join('');
}

function formatDateTime(value) {
  return [
    value.getUTCFullYear(),
    pad(value.getUTCMonth() + 1),
    pad(value.getUTCDate()),
    'T',
    pad(value.getUTCHours()),
    pad(value.getUTCMinutes()),
    pad(value.getUTCSeconds()),
    'Z',
  ].join('');
}

function formatLocalDateTime(dateString, timeString) {
  return `${formatDate(dateString)}T${timeString}`;
}

function escapeText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldLine(line) {
  const limit = 75;
  if (line.length <= limit) {
    return [line];
  }

  const lines = [];
  let remaining = line;
  while (remaining.length > limit) {
    lines.push(remaining.slice(0, limit));
    remaining = ` ${remaining.slice(limit)}`;
  }
  lines.push(remaining);
  return lines;
}

function createCalendarHeader(name, description) {
  return [
    'BEGIN:VCALENDAR',
    'PRODID:-//ShuYZ.com//China Public Holidays 2.1//CN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    'X-WR-TIMEZONE:Asia/Shanghai',
    `X-WR-CALDESC:${escapeText(description)}`,
    ...TIMEZONE_BLOCK,
  ];
}

function createHolidayEvent(holiday, stamp) {
  const start = parseDate(holiday.StartDate);
  const endExclusive = addDays(parseDate(holiday.EndDate), 1);
  const description = `${holiday.Memo}\n\n放假通知: ${holiday.URL}`;
  const summary = holiday.Duration > 1
    ? `${holiday.Name} 假期 (${holiday.Duration}天)`
    : `${holiday.Name} 假期`;

  return [
    'BEGIN:VEVENT',
    `DTSTART;VALUE=DATE:${formatDate(start)}`,
    `DTEND;VALUE=DATE:${formatDate(endExclusive)}`,
    `DTSTAMP:${stamp}`,
    `UID:${formatDate(start)}_${holiday.Duration}d_holiday@shuyz.com`,
    `CREATED:${stamp}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LAST-MODIFIED:${stamp}`,
    'SEQUENCE:0',
    'STATUS:CONFIRMED',
    `SUMMARY:${escapeText(summary)}`,
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ];
}

function createCompensatedayEvent(holiday, dateString, index, stamp) {
  const description = `${holiday.Memo}\n\n放假通知: ${holiday.URL}`;
  const summary = holiday.CompDays.length > 1
    ? `${holiday.Name} 补班 第${index + 1}天/共${holiday.CompDays.length}天`
    : `${holiday.Name} 补班`;
  const alarmDescription = holiday.CompDays.length > 1
    ? `补班提醒：${holiday.Name} 补班 第${index + 1}天/共${holiday.CompDays.length}天`
    : `补班提醒：${holiday.Name} 补班`;

  return [
    'BEGIN:VEVENT',
    `DTSTART:${formatLocalDateTime(dateString, '090000')}`,
    `DTEND:${formatLocalDateTime(dateString, '180000')}`,
    `DTSTAMP:${stamp}`,
    `UID:${formatDate(dateString)}_${index + 1}_compensateday@shuyz.com`,
    `CREATED:${stamp}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LAST-MODIFIED:${stamp}`,
    'SEQUENCE:0',
    'STATUS:TENTATIVE',
    `SUMMARY:${escapeText(summary)}`,
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'TRIGGER:-PT60M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(alarmDescription)}`,
    'END:VALARM',
    'END:VEVENT',
  ];
}

function buildHolidayEvents(data, stamp) {
  const events = [];
  for (const year of Object.keys(data.Years).sort((a, b) => Number(b) - Number(a))) {
    for (const holiday of data.Years[year]) {
      events.push(createHolidayEvent(holiday, stamp));
    }
  }
  return events;
}

function buildCompensatedayEvents(data, stamp) {
  const events = [];
  for (const year of Object.keys(data.Years).sort((a, b) => Number(b) - Number(a))) {
    for (const holiday of data.Years[year]) {
      holiday.CompDays.forEach((dateString, index) => {
        events.push(createCompensatedayEvent(holiday, dateString, index, stamp));
      });
    }
  }
  return events;
}

function flattenCalendar(lines, events) {
  const output = [...lines];
  for (const event of events) {
    for (const line of event) {
      output.push(...foldLine(line));
    }
  }
  output.push('END:VCALENDAR');
  return `${output.join('\r\n')}\r\n`;
}

function main() {
  const data = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const stamp = formatDateTime(new Date());
  const years = Object.keys(data.Years).sort();
  const yearRange = `${years[0]}~${years[years.length - 1]}年`;

  const holidayEvents = buildHolidayEvents(data, stamp);
  const compensatedayEvents = buildCompensatedayEvents(data, stamp);

  const combinedHeader = createCalendarHeader(
    data.Name,
    `${yearRange}中国放假、调休和补班日历`
  );
  const holidayHeader = createCalendarHeader(
    `${data.Name}(放假)`,
    `${yearRange}中国节假日(放假)`
  );
  const compensatedayHeader = createCalendarHeader(
    `${data.Name}(补班)`,
    `${yearRange}中国节假日(补班)`
  );

  fs.writeFileSync(
    OUTPUT_FILES.all,
    flattenCalendar(combinedHeader, [...holidayEvents, ...compensatedayEvents]),
    'utf8'
  );
  fs.writeFileSync(
    OUTPUT_FILES.holiday,
    flattenCalendar(holidayHeader, holidayEvents),
    'utf8'
  );
  fs.writeFileSync(
    OUTPUT_FILES.compensateday,
    flattenCalendar(compensatedayHeader, compensatedayEvents),
    'utf8'
  );

  console.log('Generated merged ICS files.');
}

main();