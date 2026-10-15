/**
 * Words that mark an action as destructive: deleting files, push, deploy, merge, dropping data. Deliberately broad:
 * a false alarm costs one click, a miss costs the user's files (golden rule 5). A human reads the action anyway.
 */
const DESTRUCTIVE = [
  /\brm\b/i,
  /\bdel(ete|etar|etando)?\b/i,
  /\b(apag\w*|remov\w*|exclu\w*|delet\w*|destr\w*|wip\w*)\b/i,
  /\bunlink\b/i,
  /\bdrop\b/i,
  /\btruncate\b/i,
  /\bpush\b/i,
  /\bdeploy\w*\b/i,
  /\bpubli(car|sh)\w*\b/i,
  /\bmerge\b/i,
  /\bmesclar\b/i,
  /\breset\s+--hard\b/i,
  /\bforce\b/i,
  /\bsobrescrev\w*\b/i,
  /\boverwrite\b/i,
  /\brebase\b/i,
  /\brmdir\b/i,
  /\bshred\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bgit\s+clean\b/i,
  /\bbranch\s+-D\b/,
  /\bchmod\s+-R\b/i,
  /\bchown\s+-R\b/i,
  /\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/i,
];

export function isDestructive(action: string): boolean {
  return DESTRUCTIVE.some((re) => re.test(action));
}
