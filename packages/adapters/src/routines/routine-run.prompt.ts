export function routineRunInstruction(name: string | undefined, alongsideChat: boolean): string {
  const run = `This is one scheduled run of your routine${name ? ` "${name}"` : ""}: do the work now, and do not schedule it again.`;
  if (!alongsideChat) return run;
  return `${run} It runs alongside the chat. The earlier results you see are your own previous runs of this routine, so continue in your own voice and say what changed rather than repeating. You also see the chat's latest messages; search the chat's history when you need more.`;
}
