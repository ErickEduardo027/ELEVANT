import Link from 'next/link';

// Small navigation adapter that preserves the feature components' `to` prop
// while delegating all route handling to Next.js App Router.
export default function AppLink({ to, href, ...props }) {
  return <Link href={href ?? to} {...props} />;
}
