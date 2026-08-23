const FIRST = [
  "Sarah", "Linda", "Emily", "Jessica", "Amber", "Chloe", "Megan", "Nora",
  "Hazel", "Ruby", "Violet", "Ivy", "Luna", "Stella", "Daisy", "Willow",
  "Grace", "Naomi", "Lily", "Zoe", "Aurora", "Scarlett", "Elena", "Maya",
  "Fiona", "Bella", "Nina", "Erica", "Diana", "Kira", "Alice", "Rosie",
];

const SECOND = [
  "Black", "Fire", "Storm", "Frost", "Moon", "Star", "Rose", "Snow",
  "Wolf", "Fox", "Night", "Dawn", "Ash", "Ember", "Silver", "Gold",
  "River", "Stone", "Wilde", "Rain", "Blaze", "Shade", "Vale", "Sky",
  "Bloom", "Winter", "Summer", "Raven", "Hunt", "Lane", "Brooke", "Cross",
];

export function randomGirlName(): string {
  const a = FIRST[Math.floor(Math.random() * FIRST.length)];
  const b = SECOND[Math.floor(Math.random() * SECOND.length)];
  return `${a}${b}`;
}

/** Random name that is not in `used`; falls back to a numeric suffix. */
export function uniqueGirlName(used: Set<string>): string {
  for (let i = 0; i < 60; i++) {
    const name = randomGirlName();
    if (!used.has(name.toLowerCase())) {
      used.add(name.toLowerCase());
      return name;
    }
  }
  let n = 2;
  let base = randomGirlName();
  while (used.has(`${base}${n}`.toLowerCase())) n++;
  const name = `${base}${n}`;
  used.add(name.toLowerCase());
  return name;
}
