#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const README_PATH = path.join(__dirname, '..', 'README.md');
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
  const block = renderStats(stats);
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

  let total = 0;
  let longestStreak = 0;
  let rolling = 0;

  for (const day of days) {
    total += day.count;
    if (day.count > 0) {
      rolling += 1;
      if (rolling > longestStreak) {
        longestStreak = rolling;
      }
    } else {
      rolling = 0;
    }
  }

  let currentStreak = 0;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (days[i].count > 0) {
      currentStreak += 1;
    } else {
      break;
    }
  }

  return { total, longestStreak, currentStreak };
}

function renderStats(stats) {
  const formatNumber = (value) => Number(value || 0).toLocaleString('en-US');
  const totalLabel = encodeURIComponent(formatNumber(stats.total));
  const longestLabel = encodeURIComponent(
    `${formatNumber(stats.longestStreak)} day${stats.longestStreak === 1 ? '' : 's'}`
  );
  const currentLabel = encodeURIComponent(
    `${formatNumber(stats.currentStreak)} day${stats.currentStreak === 1 ? '' : 's'}`
  );

  return `${START_MARKER}
<p align="center">
  <img src="https://img.shields.io/badge/Total%20Commits-${totalLabel}-2ea44f?style=for-the-badge&logo=github&labelColor=1c1c1c" alt="Total commits badge" />
  <img src="https://img.shields.io/badge/Longest%20Streak-${longestLabel}-1f6feb?style=for-the-badge&logo=github&labelColor=1c1c1c" alt="Longest streak badge" />
  <img src="https://img.shields.io/badge/Current%20Streak-${currentLabel}-bf4b8a?style=for-the-badge&logo=github&labelColor=1c1c1c" alt="Current streak badge" />
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
