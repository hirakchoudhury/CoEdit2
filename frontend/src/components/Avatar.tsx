import { colorForUser } from './RemoteCursors';

/**
 * Presence avatar. The colour comes from the same hash the cursor overlay
 * uses, so the circle beside someone's name matches their caret in the
 * document. That link is the whole point - without it the colours would be
 * two unrelated sets and mean nothing.
 */
export function initialFor(email: string): string {
  const trimmed = email.trim();
  return (trimmed[0] || '?').toUpperCase();
}

interface Props {
  userId: string;
  email: string;
  size?: number;
}

export default function Avatar({ userId, email, size = 28 }: Props) {
  return (
    <span
      className="avatar"
      title={email}
      style={{
        background: colorForUser(userId),
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
      }}
    >
      {initialFor(email)}
    </span>
  );
}
