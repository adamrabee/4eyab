// Teachers sign in with a simple username instead of an email address.
// Supabase Auth needs an email-shaped identifier, so each username maps to an
// address on the reserved ".invalid" domain (RFC 2606): it can never receive
// mail and never reaches a real mailbox. Teachers never see it.

export const LOGIN_DOMAIN = "hissati.invalid";

/** Lower-case, trim, and convert Arabic-Indic digits so "٠٥٥..." works too. */
export function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}

/** 3–30 chars: English letters, digits, dot, dash, underscore; starts with a letter or digit. */
export function isValidUsername(u: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(u);
}

export function usernameToEmail(u: string): string {
  return `${u}@${LOGIN_DOMAIN}`;
}
