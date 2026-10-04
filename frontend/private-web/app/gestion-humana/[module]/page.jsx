import HRModulePage from '../../../src/features/human-resources/HRModulePage';

export function generateStaticParams() {
  return ['dashboard', 'users', 'certifications', 'permits', 'schedules', 'reports', 'audit', 'notifications']
    .map(module => ({ module }));
}

export default async function Page({ params }) {
  const { module } = await params;
  return <HRModulePage moduleId={module} />;
}
