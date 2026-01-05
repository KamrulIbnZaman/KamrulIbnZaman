#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const README_PATH = path.join(__dirname, '..', 'README.md');
const PREVIEW_PATH = path.join(__dirname, '..', 'preview.svg');
const START_MARKER = '<!-- GITHUB-STATS:START -->';
const END_MARKER = '<!-- GITHUB-STATS:END -->';
const LOGIN = 'KamrulIbnZaman';

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is required to call the GitHub GraphQL API.');
  }

  const days = await fetchAllContributionDays(token);
  const stats = computeStats(days);
  const svg = renderSvg(stats);
  writePreview(svg);
  const block = renderReadmeBlock();
  injectStats(block);
  console.log(
    `Updated stats for ${LOGIN}: total=${stats.total}, longest=${stats.longestStreak}, current=${stats.currentStreak}`
  );
}

async function fetchAllContributionDays(token) {
  const years = await fetchContributionYears(token);
  if (!years.length) {
    throw new Error('No contribution years found for the user.');
  }

  const today = new Date();
  const sortedYears = [...years].sort((a, b) => a - b);
  const days = [];

  for (const year of sortedYears) {
    const from = new Date(Date.UTC(year, 0, 1)).toISOString();
    const to =
      year === today.getUTCFullYear()
        ? today.toISOString()
        : new Date(Date.UTC(year, 11, 31, 23, 59, 59)).toISOString();

    const calendar = await fetchContributionCalendar(token, from, to);
    days.push(
      ...calendar.weeks.flatMap((week) =>
        week.contributionDays.map((day) => ({
          date: day.date,
          count: Number(day.contributionCount) || 0
        }))
      )
    );
  }

  return days
    .filter((day) => new Date(day.date) <= today)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

async function fetchContributionYears(token) {
  const query = `
    query ($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionYears
        }
      }
    }
  `;

  const data = await graphqlRequest(token, query, { login: LOGIN });
  const years = data?.user?.contributionsCollection?.contributionYears;
  return Array.isArray(years) ? years : [];
}

async function fetchContributionCalendar(token, from, to) {
  const query = `
    query ($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const data = await graphqlRequest(token, query, { login: LOGIN, from, to });
  const calendar = data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) {
    throw new Error('Contribution calendar not found in the API response.');
  }
  return calendar;
}

async function graphqlRequest(token, query, variables) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'github-stats-updater'
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText} - ${text}`);
  }

  const body = await response.json();
  if (body.errors) {
    throw new Error(`GitHub API returned errors: ${JSON.stringify(body.errors)}`);
  }

  return body.data;
}

function computeStats(days) {
  const isBreakDay = (dateStr) => {
    const day = new Date(dateStr).getUTCDay(); // 0=Sun, 5=Fri, 6=Sat
    return day === 5 || day === 6;
  };

  let total = 0;
  let longestStreak = 0;
  let rolling = 0;
  let rollingStart = null;
  let rollingEnd = null;

  let longestStart = null;
  let longestEnd = null;

  for (const day of days) {
    total += day.count;
    const breakDay = isBreakDay(day.date);
    if (day.count > 0) {
      if (rolling === 0) {
        rollingStart = day.date;
      }
      rolling += 1;
      rollingEnd = day.date;
      if (rolling > longestStreak) {
        longestStreak = rolling;
        longestStart = rollingStart;
        longestEnd = rollingEnd;
      }
    } else if (!breakDay) {
      rolling = 0;
      rollingStart = null;
      rollingEnd = null;
    }
  }

  let currentStreak = 0;
  let currentStart = null;
  let currentEnd = null;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    const day = days[i];
    const breakDay = isBreakDay(day.date);
    if (day.count > 0) {
      currentStreak += 1;
      currentStart = day.date;
      if (!currentEnd) {
        currentEnd = day.date;
      }
    } else if (breakDay) {
      continue;
    } else {
      break;
    }
  }

  const contributionStart = days.find((d) => d.count > 0)?.date || days[0]?.date || null;
  const contributionEnd = days[days.length - 1]?.date || null;

  return {
    total,
    longestStreak,
    currentStreak,
    longestRange: { start: longestStart, end: longestEnd },
    currentRange: { start: currentStart, end: currentEnd },
    contributionsRange: { start: contributionStart, end: contributionEnd }
  };
}

function renderSvg(stats) {
  const formatNumber = (value) => Number(value || 0).toLocaleString('en-US');
  const formatDate = (dateStr, opts) =>
    dateStr
      ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(dateStr))
      : '–';

  const formatRange = (range) => {
    if (!range.start || !range.end) return '–';
    const startDate = new Date(range.start);
    const endDate = new Date(range.end);
    const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();
    const start = formatDate(range.start, { month: 'short', day: 'numeric', year: 'numeric' });
    const end = formatDate(
      range.end,
      sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }
    );
    return `${start} - ${end}`;
  };

  const totalLabel = formatNumber(stats.total);
  const currentLabel = formatNumber(stats.currentStreak);
  const longestLabel = formatNumber(stats.longestStreak);

  const contributionRangeLabel = formatRange(stats.contributionsRange);
  const currentRangeLabel = formatRange(stats.currentRange);
  const longestRangeLabel = formatRange(stats.longestRange);

  return `<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'
                style='isolation: isolate' viewBox='0 0 495 195' width='495px' height='195px' direction='ltr'>
        <style>
            @keyframes currstreak {
                0% { font-size: 3px; opacity: 0.2; }
                80% { font-size: 34px; opacity: 1; }
                100% { font-size: 28px; opacity: 1; }
            }
            @keyframes fadein {
                0% { opacity: 0; }
                100% { opacity: 1; }
            }
        </style>
        <defs>
            <clipPath id='outer_rectangle'>
                <rect width='495' height='195' rx='4.5'/>
            </clipPath>
            <mask id='mask_out_ring_behind_fire'>
                <rect width='495' height='195' fill='white'/>
                <ellipse id='mask-ellipse' cx='247.5' cy='32' rx='13' ry='18' fill='black'/>
            </mask>
            
        </defs>
        <g clip-path='url(#outer_rectangle)'>
            <g style='isolation: isolate'>
                <rect stroke='#E4E2E2' fill='#FFFEFE' rx='4.5' x='0.5' y='0.5' width='494' height='194'/>
            </g>
            <g style='isolation: isolate'>
                <line x1='165' y1='28' x2='165' y2='170' vector-effect='non-scaling-stroke' stroke-width='1' stroke='#E4E2E2' stroke-linejoin='miter' stroke-linecap='square' stroke-miterlimit='3'/>
                <line x1='330' y1='28' x2='330' y2='170' vector-effect='non-scaling-stroke' stroke-width='1' stroke='#E4E2E2' stroke-linejoin='miter' stroke-linecap='square' stroke-miterlimit='3'/>
            </g>
            <g style='isolation: isolate'>
                <!-- Total Contributions big number -->
                <g transform='translate(82.5, 48)'>
                    <text x='0' y='32' stroke-width='0' text-anchor='middle' fill='#151515' stroke='none' font-family='"Segoe UI", Ubuntu, sans-serif' font-weight='700' font-size='28px' font-style='normal' style='opacity: 0; animation: fadein 0.5s linear forwards 0.6s'>
                        ${totalLabel}
                    </text>
                </g>

                <!-- Total Contributions label -->
                <g transform='translate(82.5, 84)'>
                    <text x='0' y='32' stroke-width='0' text-anchor='middle' fill='#151515' stroke='none' font-family='"Segoe UI", Ubuntu, sans-serif' font-weight='400' font-size='14px' font-style='normal' style='opacity: 0; animation: fadein 0.5s linear forwards 0.7s'>
                        Total Contributions
                    </text>
                </g>

                <!-- Total Contributions range -->
                <g transform='translate(82.5, 114)'>
                    <text x='0' y='32' stroke-width='0' text-anchor='middle' fill='#464646' stroke='none' font-family='"Segoe UI", Ubuntu, sans-serif' font-weight='400' font-size='12px' font-style='normal' style='opacity: 0; animation: fadein 0.5s linear forwards 0.8s'>
                        ${contributionRangeLabel}
                    </text>
                </g>
            </g>
            <g style='isolation: isolate'>
                <!-- Current Streak label -->
                <g transform='translate(247.5, 108)'>
                    <text x='0' y='32' stroke-width='0' text-anchor='middle' fill='#FB8C00' stroke='none' font-family='"Segoe UI", Ubuntu, sans-serif' font-weight='700' font-size='14px' font-style='normal' style='opacity: 0; animation: fadein 0.5s linear forwards 0.9s'>
                        Current Streak
                    </text>
                </g>

                <!-- Current Streak range -->
                <g transform='translate(247.5, 145)'>
                    <text x='0' y='21' stroke-width='0' text-anchor='middle' fill='#464646' stroke='none' font-family='"Segoe UI", Ubuntu, sans-serif' font-weight='400' font-size='12px' font-style='normal' style='opacity: 0; animation: fadein 0.5s linear forwards 0.9s'>
                        ${currentRangeLabel}
                    </text>
                </g>

                <!-- Ring around number -->
                <g mask='url(#mask_out_ring_behind_fire)'>
                    <circle cx='247.5' cy='71' r='40' fill='none' stroke='#FB8C00' stroke-width='5' style='opacity: 0; animation: fadein 0.5s linear forwards 0.4s'></circle>
                </g>
                <!-- Fire icon -->
                <g transform='translate(247.5, 19.5)' stroke-opacity='0' style='opacity: 0; animation: fadein 0.5s linear forwards 0.6s'>
                    <path d='M -12 -0.5 L 15 -0.5 L 15 23.5 L -12 23.5 L -12 -0.5 Z' fill='none'/>
                    <path d='M 1.5 0.67 C 1.5 0.67 2.24 3.32 2.24 5.47 C 2.24 7.53 0.89 9.2 -1.17 9.2 C -3.23 9.2 -4.79 7.53 -4.79 5.47 L -4.76 5.11 C -6.78 7.51 -8 10.62 -8 13.99 C -8 18.41 -4.42 22 0 22 C 4.42 22 8 18.41 8 13.99 C 8 8.6 5.41 3.79 1.5 0.67 Z M -0.29 19 C -2.07 19 -3.51 17.6 -3.51 15.86 C -3.51 14.24 -2.46 13.1 -0.7 12.74 C 1.07 12.38 2.9 11.53 3.92 10.16 C 4.31 11.45 4.51 12.81 4.51 14.2 C 4.51 16.85 2.36 19 -0.29 19 Z' fill='#FB8C00' stroke-opacity='0'/>
                </g>

                <!-- Current Streak big number -->
                <g transform='translate(247.5, 48)'>
                    <text x='0' y='32' stroke-width='0' text-anchor='middle' fill='#151515' stroke='none' font-family='"Segoe UI", Ubuntu, sans-serif' font-weight='700' font-size='28px' font-style='normal' style='animation: currstreak 0.6s linear forwards'>
                        ${currentLabel}
                    </text>
                </g>

            </g>
            <g style='isolation: isolate'>
                <!-- Longest Streak big number -->
                <g transform='translate(412.5, 48)'>
                    <text x='0' y='32' stroke-width='0' text-anchor='middle' fill='#151515' stroke='none' font-family='"Segoe UI", Ubuntu, sans-serif' font-weight='700' font-size='28px' font-style='normal' style='opacity: 0; animation: fadein 0.5s linear forwards 1.2s'>
                        ${longestLabel}
                    </text>
                </g>

                <!-- Longest Streak label -->
                <g transform='translate(412.5, 84)'>
                    <text x='0' y='32' stroke-width='0' text-anchor='middle' fill='#151515' stroke='none' font-family='"Segoe UI", Ubuntu, sans-serif' font-weight='400' font-size='14px' font-style='normal' style='opacity: 0; animation: fadein 0.5s linear forwards 1.3s'>
                        Longest Streak
                    </text>
                </g>

                <!-- Longest Streak range -->
                <g transform='translate(412.5, 114)'>
                    <text x='0' y='32' stroke-width='0' text-anchor='middle' fill='#464646' stroke='none' font-family='"Segoe UI", Ubuntu, sans-serif' font-weight='400' font-size='12px' font-style='normal' style='opacity: 0; animation: fadein 0.5s linear forwards 1.4s'>
                        ${longestRangeLabel}
                    </text>
                </g>
            </g>
            
        </g>
    </svg>`;
}

function writePreview(svgContent) {
  fs.writeFileSync(PREVIEW_PATH, svgContent, 'utf8');
}

function renderReadmeBlock() {
  return `${START_MARKER}
<p align="center">
  <img src="preview.svg" alt="GitHub stats preview" />
</p>
${END_MARKER}`;
}

function injectStats(statsBlock) {
  const content = fs.readFileSync(README_PATH, 'utf8');
  if (!content.includes(START_MARKER) || !content.includes(END_MARKER)) {
    throw new Error('README is missing required GITHUB-STATS markers.');
  }

  const updated = content.replace(
    new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}`),
    statsBlock
  );

  fs.writeFileSync(README_PATH, updated);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
