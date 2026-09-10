/**
 * R2 key convention (AGENTS.md, Data conventions #6): `{userId}/{yyyy}/{mm}/{receiptUuid}`,
 * used identically at upload and at export — a diverging path on either
 * side breaks the link silently.
 *
 * `yyyy/mm` is the *upload* month, not the purchase month: the purchase
 * date does not exist yet at upload time (extraction has not run), and
 * this key is minted once, at upload, and never recomputed. `receipts`
 * carries no `user_id` column in `0001`/`0002` (v1 is single-tenant, no
 * `users` table until STON-4's `0003`), so this key is the only place a
 * receipt's owner is recorded until then.
 */
export function receiptR2Key(userId: string, uploadedAt: Date, receiptUuid: string): string {
  const yyyy = String(uploadedAt.getUTCFullYear()).padStart(4, "0");
  const mm = String(uploadedAt.getUTCMonth() + 1).padStart(2, "0");
  return `${userId}/${yyyy}/${mm}/${receiptUuid}`;
}
