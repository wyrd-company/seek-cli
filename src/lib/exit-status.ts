/**
 * The exit statuses seek uses. The command line exits only with these codes,
 * and published reference documents them from this table.
 */
export const EXIT_STATUSES = [
  {
    name: "success",
    code: 0,
    meaning: "The command completed.",
  },
  {
    name: "failure",
    code: 1,
    meaning:
      "The command failed: a parse error, an HTTP error, research that did not complete, " +
      "a result requested for an unfinished job, or another error, printed on stderr.",
  },
  {
    name: "missingProviderKey",
    code: 2,
    meaning:
      "A provider key is not set in direct mode. The message names the variable to set " +
      "and lists the other commands of the same group.",
  },
] as const;

export type ExitStatusName = (typeof EXIT_STATUSES)[number]["name"];

export const EXIT = Object.fromEntries(
  EXIT_STATUSES.map((status) => [status.name, status.code]),
) as { readonly [Name in ExitStatusName]: Extract<(typeof EXIT_STATUSES)[number], { name: Name }>["code"] };
