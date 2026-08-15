import { readFileSync } from 'node:fs';

const tagPattern =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parseTag(tag) {
  const match = tag.match(tagPattern);
  if (!match) return null;

  return {
    tag,
    core: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split('.') ?? [],
  };
}

function compareIdentifiers(left, right) {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : null;

  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  return left.localeCompare(right);
}

function compareVersions(left, right) {
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] - right.core[index];
    }
  }

  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;

    const comparison = compareIdentifiers(leftIdentifier, rightIdentifier);
    if (comparison !== 0) return comparison;
  }

  return 0;
}

const requested = parseTag(process.argv[2] ?? '');
if (!requested) {
  console.error(
    'Usage: git tag --list "v*" | node scripts/check-release-tag.mjs <vX.Y.Z>',
  );
  process.exit(1);
}

const existing = readFileSync(0, 'utf8')
  .split(/\r?\n/)
  .map((tag) => tag.trim())
  .filter((tag) => tag && tag !== requested.tag)
  .map(parseTag)
  .filter(Boolean);

const newest = existing.reduce(
  (current, candidate) =>
    !current || compareVersions(candidate, current) > 0 ? candidate : current,
  null,
);

if (newest && compareVersions(requested, newest) <= 0) {
  console.error(
    `Release tag ${requested.tag} must be newer than the highest existing tag ${newest.tag}`,
  );
  process.exit(1);
}

console.log(
  newest
    ? `Release tag order passed: ${requested.tag} > ${newest.tag}`
    : `Release tag order passed: ${requested.tag} is the first SemVer tag`,
);
